// FurrPresence: dual presence (App heartbeat + Discord status) for accounts and Discord members.
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { FILE_COLUMNS, base64ToText, getSql, iso, loadMe, requirePermission, toFileDto, type FileRow } from "../core";
import { DISCORD_LOGS, sanitizeSegment } from "../paths";
import { ROLE_LABEL, effectiveRole, isRole } from "../roles";
import type { DiscordMemberOption, DiscordStatus, PresenceLog, PresenceUser } from "../types";

const ONLINE_WINDOW = "90 seconds";

type Row = {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  discord_id: string | null;
  discord_username: string | null;
  nickname: string | null;
  role: string | null;
  highest_privilege: string | null;
  discord_status: string | null;
  platform: string | null;
  app_online: boolean;
  connected_at: unknown;
  last_heartbeat_at: unknown;
  last_seen_at: unknown;
  has_account: boolean;
};

function toDto(r: Row, showEmail: boolean): PresenceUser {
  const role = effectiveRole(r.role, r.highest_privilege);
  const discordStatus = (["online", "idle", "dnd"].includes(r.discord_status ?? "") ? r.discord_status : "offline") as DiscordStatus;
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    email: showEmail ? r.email : null,
    discordId: r.discord_id,
    discordUsername: r.discord_username,
    nickname: r.nickname,
    role,
    roleLabel: ROLE_LABEL[role],
    hasAccount: r.has_account,
    isAppOnline: Boolean(r.app_online),
    isDiscordOnline: discordStatus !== "offline",
    discordStatus,
    platform: r.app_online ? (r.platform === "mobile" ? "mobile" : "desktop") : null,
    connectedAt: iso(r.connected_at),
    lastHeartbeatAt: iso(r.last_heartbeat_at),
    lastSeenAt: iso(r.last_seen_at) ?? iso(r.last_heartbeat_at),
  };
}

export async function queryPresence(showEmail: boolean): Promise<PresenceUser[]> {
  const sql = await getSql();
  const rows = await sql.query<Row>(`
    select p.user_id as id, p.username, p.display_name, u.email, p.discord_id,
           dm.username as discord_username, dm.nickname, p.role, coalesce(dm.highest_privilege, p.discord_privilege) as highest_privilege, dm.discord_status,
           pr.platform, coalesce(pr.last_heartbeat_at > now() - interval '${ONLINE_WINDOW}', false) as app_online,
           pr.connected_at, pr.last_heartbeat_at, pr.last_seen_at, true as has_account
    from furr_profile p
    left join "user" u on u.id = p.user_id
    left join discord_member dm on dm.discord_id = p.discord_id
    left join furr_presence pr on pr.user_id = p.user_id
    union all
    select 'discord:' || dm.discord_id as id, dm.username, dm.display_name, null as email, dm.discord_id,
           dm.username, dm.nickname, null as role, dm.highest_privilege, dm.discord_status,
           null as platform, false as app_online, null as connected_at, null as last_heartbeat_at,
           dm.last_presence_at as last_seen_at, false as has_account
    from discord_member dm
    where not exists (select 1 from furr_profile p where p.discord_id = dm.discord_id)`);
  return rows
    .map((r) => toDto(r, showEmail))
    .sort((a, b) => {
      const score = (u: PresenceUser) => (u.isAppOnline ? 0 : u.isDiscordOnline ? 1 : 2);
      if (score(a) !== score(b)) return score(a) - score(b);
      return (a.nickname || a.displayName).localeCompare(b.nickname || b.displayName, "de");
    });
}

/** `team` = accounts/members with Supporter+ role, `global` = everyone incl. Discord-only members. */
export const listPresence = createServerFn({ method: "GET" })
  .validator((view: "team" | "global") => (view === "global" ? "global" : "team"))
  .middleware([authMiddleware])
  .handler(async ({ context, data: view }) => {
    const me = await loadMe(context.userId);
    const users = await queryPresence(me.permissions.canManageAccounts);
    if (view === "team") return users.filter((u) => isRole(u.role) && u.role !== "member");
    if (!me.permissions.canViewPresence) return users.filter((u) => u.hasAccount);
    return users;
  });

/** Discord text reports (Dokumente/Moderation_Beweise/Discord_Logs) that mention a member. */
export const listPresenceLogs = createServerFn({ method: "GET" })
  .validator((discordId: string) => String(discordId ?? "").trim())
  .middleware([authMiddleware])
  .handler(async ({ context, data: discordId }): Promise<PresenceLog[]> => {
    await requirePermission(context.userId, "canViewPresence");
    if (!/^\d{17,22}$/.test(discordId)) throw new Error("Discord-ID muss eine numerische Snowflake sein.");
    const sql = await getSql();
    const names = await sql<{ v: string | null }>`
      select username as v from discord_member where discord_id = ${discordId}
      union all select nickname from discord_member where discord_id = ${discordId}
      union all select display_name from discord_member where discord_id = ${discordId}
      union all select username from furr_profile where discord_id = ${discordId}
      union all select display_name from furr_profile where discord_id = ${discordId}`;
    const candidates = [discordId, ...names.map((n) => n.v).filter((v): v is string => Boolean(v))].flatMap((v) => [
      v.toLowerCase(),
      sanitizeSegment(v).toLowerCase(),
    ]);
    const rows = await sql.query<FileRow & { content_b64: string | null }>(
      `select ${FILE_COLUMNS}, content_b64 from furr_file
       where scope = 'public' and owner_id is null and folder = $1 and is_folder = false`,
      [DISCORD_LOGS],
    );
    const logs: PresenceLog[] = [];
    for (const row of rows) {
      const content = base64ToText(row.content_b64);
      const haystack = `${row.name}\n${content}`.toLowerCase();
      if (!candidates.some((c) => c && haystack.includes(c))) continue;
      const dto = toFileDto(row);
      logs.push({ id: dto.id, name: dto.name, path: dto.path, updatedAt: dto.updatedAt, content });
    }
    return logs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });

export const listDiscordMembers = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<DiscordMemberOption[]> => {
    await requirePermission(context.userId, "canUseEvidence");
    const sql = await getSql();
    const rows = await sql<{
      discord_id: string;
      username: string;
      nickname: string | null;
      display_name: string;
      role_names: string;
      highest_privilege: string;
    }>`select discord_id, username, nickname, display_name, role_names, highest_privilege
       from discord_member order by lower(coalesce(nickname, display_name))`;
    return rows.map((m) => {
      let roleNames: string[] = [];
      try {
        const parsed = JSON.parse(m.role_names);
        roleNames = Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        roleNames = [];
      }
      return {
        discordId: m.discord_id,
        username: m.username,
        nickname: m.nickname,
        displayName: m.display_name,
        label: m.nickname ? `${m.nickname} (${m.username})` : m.username,
        roleNames,
        highestPrivilege: m.highest_privilege,
      };
    });
  });
