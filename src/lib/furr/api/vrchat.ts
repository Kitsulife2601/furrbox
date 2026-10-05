// FurrVRChat: VRChat group link – open group instances (world, players, region) and group
// moderation (kick / ban / unban).
//
// VRChat ties a login to the internet address it came from, and Vercel changes that address on
// every request. So everything VRChat-related runs through the Discord bot on the owner's PC:
// FurrBox queues jobs (vrchat_job), the bot executes them, reports results and pushes the current
// group state (/api/bridge/vrchat-*). The bot keeps the VRChat login; the server never sees it
// except the password in a login job, which is removed the moment the bot picks the job up.
import { createServerFn } from "@tanstack/react-start";
import { accessMiddleware } from "../access";
import { appendTextFile, bridgeStatus, getSql, iso, newId, notify, requirePermission } from "../core";
import { BOT_JOB_STALE_MS, BOT_JOB_STALE_MSG, runSideEffect, safeJsonParse } from "../http";
import { AUDIT_LOG_NAME, VRCHAT_LOGS } from "../paths";
import { VRC_ACCESS, VRC_REGION } from "../vrchat-location";

export type VrchatGroupInfo = {
  id: string;
  name: string;
  code: string;
  iconUrl: string | null;
  bannerUrl: string | null;
  memberCount: number;
  onlineMemberCount: number;
};

export type VrchatStatus = {
  botOnline: boolean;
  connected: boolean;
  accountName: string | null;
  groupId: string | null;
  group: VrchatGroupInfo | null;
  lastError: string | null;
  stateAt: string | null;
};

export type VrchatInstance = {
  instanceId: string;
  location: string;
  worldName: string;
  worldImage: string | null;
  capacity: number;
  memberCount: number;
  region: string;
  access: string;
  openedAt: string;
  joinUrl: string;
};

export type VrchatModerationEntry = {
  id: string;
  action: string;
  targetUserId: string;
  targetName: string | null;
  reason: string;
  moderatorName: string;
  status: string;
  error: string | null;
  createdAt: string;
};

/** `resultJson` is the bot's JSON result (parsed on the client). */
export type VrchatJob = { status: "queued" | "dispatched" | "done" | "failed"; resultJson: string | null; error: string | null };

type Conn = {
  account_name: string | null;
  group_id: string | null;
  group_json: string | null;
  last_error: string | null;
  state_at: unknown;
};

const USER_ID = /^usr_[0-9a-f-]{36}$/i;

async function conn(): Promise<Conn | null> {
  const sql = await getSql();
  const rows = await sql<Conn>`
    select account_name, group_id, group_json, last_error, state_at from vrchat_connection where id = 1`;
  return rows[0] ?? null;
}

async function enqueue(kind: string, payload: unknown, userId: string) {
  const bot = await bridgeStatus();
  if (!bot.configured) throw new Error("BOT_BRIDGE_TOKEN ist nicht gesetzt – VRChat-Jobs können nicht zugestellt werden.");
  if (!bot.connected) throw new Error(BOT_JOB_STALE_MSG);
  const sql = await getSql();
  const id = newId();
  await sql`
    insert into vrchat_job (id, kind, payload_json, requested_by)
    values (${id}, ${kind}, ${JSON.stringify(payload)}, ${userId})`;
  return { jobId: id };
}

export const getVrchatStatus = createServerFn({ method: "GET" })
  .middleware([accessMiddleware])
  .handler(async ({ context }): Promise<VrchatStatus> => {
    await requirePermission(context.userId, "canUseEvidence");
    const [c, bot] = await Promise.all([conn(), bridgeStatus()]);
    let group: VrchatGroupInfo | null = null;
    if (c?.group_json) {
      const g = safeJsonParse<Record<string, unknown> | null>(c.group_json, null);
      if (g?.id) {
        group = {
          id: String(g.id),
          name: String(g.name ?? ""),
          code: g.shortCode ? `${g.shortCode}.${g.discriminator}` : "",
          iconUrl: (g.iconUrl as string) ?? null,
          bannerUrl: (g.bannerUrl as string) ?? null,
          memberCount: Number(g.memberCount ?? 0),
          onlineMemberCount: Number(g.onlineMemberCount ?? 0),
        };
      }
    }
    return {
      botOnline: bot.connected,
      connected: Boolean(c?.account_name),
      accountName: c?.account_name ?? null,
      groupId: c?.group_id ?? null,
      group,
      lastError: c?.last_error ?? null,
      stateAt: iso(c?.state_at),
    };
  });

/** Polled by the UI after starting a job. Only the requester can read it. */
export const getVrchatJob = createServerFn({ method: "GET" })
  .validator((jobId: string) => String(jobId ?? ""))
  .middleware([accessMiddleware])
  .handler(async ({ context, data: jobId }): Promise<VrchatJob> => {
    const sql = await getSql();
    const rows = await sql<{ status: VrchatJob["status"]; result_json: string | null; error: string | null; created_at: unknown }>`
      select status, result_json, error, created_at from vrchat_job where id = ${jobId} and requested_by = ${context.userId}`;
    const row = rows[0];
    if (!row) throw new Error("Auftrag nicht gefunden.");
    // Fail-fast: queued ODER dispatched ohne Bot-Antwort → Client-Poll hängt nicht ewig.
    const age = Date.now() - new Date(iso(row.created_at) ?? 0).getTime();
    if ((row.status === "queued" || row.status === "dispatched") && age > BOT_JOB_STALE_MS) {
      await sql`update vrchat_job set status = 'failed', error = ${BOT_JOB_STALE_MSG}, payload_json = null where id = ${jobId}`;
      return { status: "failed", resultJson: null, error: BOT_JOB_STALE_MSG };
    }
    return { status: row.status, resultJson: row.result_json, error: row.error };
  });

/** Owner: log the bot into VRChat (username, password and – with an authenticator app – the 2FA code). */
export const vrchatLogin = createServerFn({ method: "POST" })
  .validator((input: { username: string; password: string; code?: string }) => ({
    username: String(input.username ?? "").trim(),
    password: String(input.password ?? ""),
    code: String(input.code ?? "").replace(/\s+/g, ""),
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    await requirePermission(context.userId, "canManageVrchat");
    if (!data.username || !data.password) throw new Error("Bitte VRChat-Nutzername und Passwort eingeben.");
    return enqueue("login", data, context.userId);
  });

/** Owner: second step – the 2FA code (authenticator app or e-mail), checked by the bot that holds the login. */
export const vrchatVerify2fa = createServerFn({ method: "POST" })
  .validator((code: string) => String(code ?? "").replace(/\s+/g, ""))
  .middleware([accessMiddleware])
  .handler(async ({ context, data: code }) => {
    await requirePermission(context.userId, "canManageVrchat");
    if (code.length < 6) throw new Error("Bitte den Code eingeben.");
    return enqueue("verify", { code }, context.userId);
  });

/** Owner: choose the group – short code ("FLS.0227"), id ("grp_…") or a vrchat.com group link. */
export const setVrchatGroup = createServerFn({ method: "POST" })
  .validator((input: string) => {
    const raw = String(input ?? "").trim();
    const id = /grp_[0-9a-f-]{36}/i.exec(raw)?.[0];
    if (id) return id.toLowerCase();
    const code = /([A-Za-z0-9]{3,6})\.(\d{4})/.exec(raw);
    if (code) return `${code[1].toUpperCase()}.${code[2]}`;
    throw new Error("Bitte das Gruppen-Kürzel (z. B. FLS.0227), die Gruppen-ID (grp_…) oder den Gruppen-Link eingeben.");
  })
  .middleware([accessMiddleware])
  .handler(async ({ context, data: group }) => {
    await requirePermission(context.userId, "canManageVrchat");
    return enqueue("set-group", { group }, context.userId);
  });

export const disconnectVrchat = createServerFn({ method: "POST" })
  .middleware([accessMiddleware])
  .handler(async ({ context }) => {
    await requirePermission(context.userId, "canManageVrchat");
    return enqueue("logout", {}, context.userId);
  });

/** Open group instances as last reported by the bot. */
export const listVrchatInstances = createServerFn({ method: "GET" })
  .middleware([accessMiddleware])
  .handler(async ({ context }) => {
    await requirePermission(context.userId, "canUseEvidence");
    const sql = await getSql();
    const rows = await sql<{
      instance_id: string;
      location: string;
      world_id: string | null;
      world_name: string | null;
      world_image: string | null;
      capacity: number | null;
      member_count: number;
      region: string | null;
      access_type: string | null;
      first_seen: unknown;
    }>`
      select instance_id, location, world_id, world_name, world_image, capacity, member_count, region, access_type, first_seen
      from vrchat_instance where closed_at is null order by member_count desc, first_seen`;
    const c = await conn();
    return {
      updatedAt: iso(c?.state_at),
      instances: rows.map((r): VrchatInstance => {
        const [worldId, instanceId = ""] = r.location.split(":");
        return {
          instanceId: r.instance_id,
          location: r.location,
          worldName: r.world_name ?? "Unbekannte Welt",
          worldImage: r.world_image,
          capacity: Number(r.capacity ?? 0),
          memberCount: Number(r.member_count ?? 0),
          region: VRC_REGION[r.region ?? ""] ?? (r.region ?? "").toUpperCase(),
          access: VRC_ACCESS[r.access_type ?? ""] ?? (r.access_type ?? ""),
          openedAt: iso(r.first_seen) ?? new Date().toISOString(),
          joinUrl: `https://vrchat.com/home/launch?worldId=${encodeURIComponent(r.world_id ?? worldId)}&instanceId=${encodeURIComponent(instanceId)}`,
        };
      }),
    };
  });

export const searchVrchatUsers = createServerFn({ method: "POST" })
  .validator((query: string) => String(query ?? "").trim().slice(0, 60))
  .middleware([accessMiddleware])
  .handler(async ({ context, data: query }) => {
    await requirePermission(context.userId, "canUseEvidence");
    if (query.length < 2) throw new Error("Bitte mindestens 2 Zeichen eingeben.");
    return enqueue("search", { query }, context.userId);
  });

/** Asks the bot whether a (personally logged-in) VRChat account is a member of the group. */
export const checkVrchatMembership = createServerFn({ method: "POST" })
  .validator((userId: string) => {
    const id = String(userId ?? "").trim();
    if (!USER_ID.test(id)) throw new Error("Ungültige VRChat-ID.");
    return id;
  })
  .middleware([accessMiddleware])
  .handler(async ({ context, data: userId }) => {
    await requirePermission(context.userId, "canUseEvidence");
    return enqueue("member-check", { userId }, context.userId);
  });

/** Moderator+: kick / ban / unban someone in the VRChat group (logged when the bot reports back). */
export const vrchatModerate = createServerFn({ method: "POST" })
  .validator((input: { action: "kick" | "ban" | "unban"; userId: string; userName?: string; reason: string }) => ({
    action: (["kick", "ban", "unban"].includes(input.action) ? input.action : "kick") as "kick" | "ban" | "unban",
    userId: String(input.userId ?? "").trim(),
    userName: String(input.userName ?? "").trim().slice(0, 100),
    reason: String(input.reason ?? "").trim(),
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    await requirePermission(context.userId, "canModerateVrchat");
    if (!USER_ID.test(data.userId)) throw new Error("Bitte eine VRChat-Person auswählen (ID beginnt mit usr_).");
    if (data.reason.length < 3) throw new Error("Bitte einen Grund angeben (mindestens 3 Zeichen).");
    return enqueue("moderate", data, context.userId);
  });

export const listVrchatModeration = createServerFn({ method: "GET" })
  .middleware([accessMiddleware])
  .handler(async ({ context }): Promise<VrchatModerationEntry[]> => {
    await requirePermission(context.userId, "canUseEvidence");
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      action: string;
      target_user_id: string;
      target_name: string | null;
      reason: string;
      moderator_name: string | null;
      status: string;
      error: string | null;
      created_at: unknown;
    }>`
      select m.id, m.action, m.target_user_id, m.target_name, m.reason, p.display_name as moderator_name, m.status, m.error, m.created_at
      from vrchat_moderation m left join furr_profile p on p.user_id = m.moderator_user_id
      order by m.created_at desc limit 50`;
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      targetUserId: r.target_user_id,
      targetName: r.target_name,
      reason: r.reason,
      moderatorName: r.moderator_name ?? "Unbekannt",
      status: r.status,
      error: r.error,
      createdAt: iso(r.created_at) ?? "",
    }));
  });

/**
 * Records a kick / ban / unban a team member did with their own VRChat login in the desktop app
 * (the action itself runs on their PC – VRChat only accepts logins from the user's own address).
 */
export const logVrchatModeration = createServerFn({ method: "POST" })
  .validator(
    (input: {
      action: "kick" | "ban" | "unban";
      userId: string;
      userName?: string;
      reason: string;
      vrchatName?: string;
      ok: boolean;
      error?: string;
    }) => ({
      action: (["kick", "ban", "unban"].includes(input.action) ? input.action : "kick") as "kick" | "ban" | "unban",
      userId: String(input.userId ?? "").trim(),
      userName: String(input.userName ?? "").trim().slice(0, 100),
      reason: String(input.reason ?? "").trim().slice(0, 1000),
      vrchatName: String(input.vrchatName ?? "").trim().slice(0, 100),
      ok: Boolean(input.ok),
      error: input.error ? String(input.error).slice(0, 500) : null,
    }),
  )
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    const me = await requirePermission(context.userId, "canModerateVrchat");
    if (!USER_ID.test(data.userId)) throw new Error("Ungültige VRChat-Person.");
    const sql = await getSql();
    await sql`
      insert into vrchat_moderation (id, action, target_user_id, target_name, reason, moderator_user_id, status, error)
      values (${newId()}, ${data.action}, ${data.userId}, ${data.userName || null}, ${data.reason}, ${context.userId},
              ${data.ok ? "success" : "failed"}, ${data.error})`;
    const label: Record<string, string> = { kick: "Kick", ban: "Bann", unban: "Entbannung" };
    const block = [
      "------------------------------------------------------------",
      `Datum: ${new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}`,
      "Plattform: VRChat (Gruppe)",
      `Status: ${data.ok ? "ERFOLGREICH" : "FEHLGESCHLAGEN"}`,
      `Aktion: ${label[data.action]}`,
      `Moderator: ${me.displayName} (${me.roleLabel})${data.vrchatName ? ` – VRChat-Konto ${data.vrchatName}` : ""}`,
      `Ziel: ${data.userName || data.userId} (${data.userId})`,
      "Grund:",
      data.reason,
      data.error ? `Fehler: ${data.error}` : "",
      "------------------------------------------------------------",
      "",
    ]
      .filter(Boolean)
      .join("\r\n");
    await runSideEffect(async () => {
      await appendTextFile("public", `${VRCHAT_LOGS}/${AUDIT_LOG_NAME}`, `${block}\r\n`, context.userId);
      await notify(
        `VRChat: ${label[data.action]} ${data.ok ? "ausgeführt" : "fehlgeschlagen"}`,
        `${data.userName || data.userId} – von ${me.displayName}${data.error ? ` (${data.error})` : ""}`,
      );
    }, "log-vrchat-moderation");
    return { ok: true };
  });
