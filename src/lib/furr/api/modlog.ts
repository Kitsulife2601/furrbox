// FurrModLog: one moderation log across Discord (bot moderation from FurrBox), VRChat moderation
// from FurrBox and the VRChat group audit log (warnings, kicks, bans done directly in VRChat).
import { createServerFn } from "@tanstack/react-start";
import { accessMiddleware } from "../access";
import { getSql, iso, requirePermission } from "../core";
import { MOD_ACTION_LABEL, vrchatAuditKind } from "../vrchat-location";

export type ModLogEntry = {
  id: string;
  at: string;
  platform: "Discord" | "VRChat";
  /** warn | mute | timeout | kick | remove | ban | unban */
  kind: string;
  label: string;
  source: "FurrBox" | "VRChat";
  moderator: string;
  target: string;
  targetId: string | null;
  reason: string | null;
  durationMs: number | null;
  status: "success" | "failed" | "pending";
  error: string | null;
  details: string | null;
};

type Filter = { platform: "all" | "Discord" | "VRChat"; days: number };

export const listModerationLog = createServerFn({ method: "GET" })
  .validator((input: Partial<Filter>): Filter => ({
    platform: input.platform === "Discord" || input.platform === "VRChat" ? input.platform : "all",
    days: [1, 7, 30, 365].includes(Number(input.days)) ? Number(input.days) : 30,
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }): Promise<ModLogEntry[]> => {
    await requirePermission(context.userId, "canUseEvidence");
    const sql = await getSql();
    const entries: ModLogEntry[] = [];

    if (data.platform !== "VRChat") {
      const rows = await sql.query<{
        id: string;
        action: string;
        target_discord_id: string;
        target_name: string | null;
        moderator_name: string | null;
        reason: string;
        duration_ms: number | null;
        status: string;
        error: string | null;
        created_at: unknown;
        completed_at: unknown;
      }>(
        `select m.id, m.action, m.target_discord_id, coalesce(dm.nickname, dm.display_name) as target_name,
                p.display_name as moderator_name, m.reason, m.duration_ms, m.status, m.error, m.created_at, m.completed_at
         from moderation_request m
         left join discord_member dm on dm.discord_id = m.target_discord_id
         left join furr_profile p on p.user_id = m.moderator_user_id
         where m.created_at > now() - ($1::int * interval '1 day')
         order by m.created_at desc limit 500`,
        [data.days],
      );
      for (const r of rows) {
        entries.push({
          id: `dc-${r.id}`,
          at: iso(r.completed_at) ?? iso(r.created_at) ?? "",
          platform: "Discord",
          kind: r.action,
          label: MOD_ACTION_LABEL[r.action] ?? r.action,
          source: "FurrBox",
          moderator: r.moderator_name ?? "Unbekannt",
          target: r.target_name ?? r.target_discord_id,
          targetId: r.target_discord_id,
          reason: r.reason,
          durationMs: r.duration_ms === null ? null : Number(r.duration_ms),
          status: r.status === "success" ? "success" : r.status === "failed" ? "failed" : "pending",
          error: r.error,
          details: null,
        });
      }
    }

    if (data.platform !== "Discord") {
      const mods = await sql.query<{
        id: string;
        action: string;
        target_user_id: string;
        target_name: string | null;
        reason: string;
        moderator_name: string | null;
        status: string;
        error: string | null;
        created_at: unknown;
      }>(
        `select m.id, m.action, m.target_user_id, m.target_name, m.reason, p.display_name as moderator_name,
                m.status, m.error, m.created_at
         from vrchat_moderation m left join furr_profile p on p.user_id = m.moderator_user_id
         where m.created_at > now() - ($1::int * interval '1 day')
         order by m.created_at desc limit 500`,
        [data.days],
      );
      for (const r of mods) {
        const kind = r.action === "kick" ? "kick" : r.action;
        entries.push({
          id: `vf-${r.id}`,
          at: iso(r.created_at) ?? "",
          platform: "VRChat",
          kind,
          label: MOD_ACTION_LABEL[kind] ?? kind,
          source: "FurrBox",
          moderator: r.moderator_name ?? "Unbekannt",
          target: r.target_name ?? r.target_user_id,
          targetId: r.target_user_id,
          reason: r.reason,
          durationMs: null,
          status: r.status === "success" ? "success" : "failed",
          error: r.error,
          details: null,
        });
      }

      // VRChat's own audit log. Actions the bot did for FurrBox are already listed above (with reason).
      const conn = await sql<{ account_id: string | null }>`select account_id from vrchat_connection where id = 1`;
      const botAccount = conn[0]?.account_id ?? "";
      const audit = await sql.query<{
        id: string;
        created_at: unknown;
        actor_id: string | null;
        actor_name: string | null;
        target_id: string | null;
        event_type: string;
        description: string | null;
        data_json: string | null;
      }>(
        `select id, created_at, actor_id, actor_name, target_id, event_type, description, data_json
         from vrchat_audit
         where created_at > now() - ($1::int * interval '1 day') and coalesce(actor_id, '') <> $2
         order by created_at desc limit 1000`,
        [data.days, botAccount],
      );
      for (const r of audit) {
        const kind = vrchatAuditKind(r.event_type);
        if (!kind) continue;
        entries.push({
          id: `va-${r.id}`,
          at: iso(r.created_at) ?? "",
          platform: "VRChat",
          kind,
          label: MOD_ACTION_LABEL[kind] ?? kind,
          source: "VRChat",
          moderator: r.actor_name ?? r.actor_id ?? "Unbekannt",
          target: targetFromDescription(r.description) ?? r.target_id ?? "Unbekannt",
          targetId: r.target_id,
          reason: null,
          durationMs: null,
          status: "success",
          error: null,
          details: [r.description, r.event_type, r.data_json && r.data_json !== "{}" ? r.data_json : null]
            .filter(Boolean)
            .join("\n"),
        });
      }
    }

    return entries.sort((a, b) => b.at.localeCompare(a.at));
  });

/** VRChat descriptions look like "Moderator warned Target." / "User Target was banned …". */
function targetFromDescription(description: string | null) {
  if (!description) return null;
  const m =
    /^User\s+(.+?)\s+(?:was|has been)\b/i.exec(description) ??
    /(?:warned|kicked|banned|unbanned|muted|removed)\s+(.+?)(?:\s+from\b|\s+in\b|\.|$)/i.exec(description);
  return m?.[1]?.trim() || null;
}
