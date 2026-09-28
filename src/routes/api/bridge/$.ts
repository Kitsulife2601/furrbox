// Discord bot bridge (replaces the Socket.io "bot-bridge" room).
// The bot authenticates with `Authorization: Bearer $BOT_BRIDGE_TOKEN` and polls:
//   GET  /api/bridge/queue              -> pending moderation commands + message inspections
//   POST /api/bridge/members            -> { members: DiscordMemberSnapshot[] }
//   POST /api/bridge/presence           -> { presences: { discordId, discordStatus }[] }
//   POST /api/bridge/moderation-result  -> { requestId, status: "success"|"failed", error? }
//   POST /api/bridge/inspect-result     -> { requestId, found, content, authorName?, channelName?, ... }
import { createFileRoute } from "@tanstack/react-router";
import { appendTextFile, discordName, getSql, iso, notify, setSetting } from "@/lib/furr/core";
import { AUDIT_LOG_NAME, DISCORD_LOGS } from "@/lib/furr/paths";
import { isRole } from "@/lib/furr/roles";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function authorized(request: Request) {
  const expected = process.env.BOT_BRIDGE_TOKEN;
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ presented.charCodeAt(i);
  return diff === 0;
}

const STATUSES = new Set(["online", "idle", "dnd", "offline"]);

type MemberSnapshot = {
  discordId: string;
  username: string;
  nickname?: string | null;
  displayName?: string;
  roleNames?: string[];
  highestPrivilege?: string;
  discordStatus?: string;
};

async function handle(request: Request, action: string) {
  if (!process.env.BOT_BRIDGE_TOKEN) return json({ error: "BOT_BRIDGE_TOKEN ist nicht gesetzt." }, 503);
  if (!authorized(request)) return json({ error: "Unauthorized" }, 401);
  const sql = await getSql();
  await setSetting("bot_last_seen", new Date().toISOString());

  if (request.method === "GET" && action === "queue") {
    const moderation = await sql<{
      id: string;
      action: string;
      moderator_discord_id: string;
      target_discord_id: string;
      reason: string;
      duration_ms: number | null;
    }>`
      update moderation_request set status = 'dispatched'
      where id in (select id from moderation_request where status = 'queued' order by created_at limit 20)
      returning id, action, moderator_discord_id, target_discord_id, reason, duration_ms`;
    const inspections = await sql<{ id: string; message_id: string }>`
      update message_inspect set status = 'dispatched'
      where id in (select id from message_inspect where status = 'queued' order by created_at limit 20)
      returning id, message_id`;
    return json({
      moderation: moderation.map((m) => ({
        requestId: m.id,
        source: "dashboard",
        action: m.action,
        moderatorId: m.moderator_discord_id,
        targetId: m.target_discord_id,
        reason: m.reason,
        durationMs: m.duration_ms ?? undefined,
      })),
      inspections: inspections.map((i) => ({ requestId: i.id, messageId: i.message_id })),
    });
  }

  if (request.method !== "POST") return json({ error: "Not found" }, 404);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  if (action === "members") {
    const members = Array.isArray(body.members) ? (body.members as MemberSnapshot[]) : [];
    for (const m of members) {
      if (!/^\d{17,22}$/.test(String(m.discordId))) continue;
      const privilege = isRole(m.highestPrivilege) ? m.highestPrivilege : "none";
      const status = STATUSES.has(String(m.discordStatus)) ? String(m.discordStatus) : "offline";
      await sql`
        insert into discord_member (discord_id, username, nickname, display_name, role_names, highest_privilege, discord_status, synced_at)
        values (${m.discordId}, ${String(m.username ?? m.discordId)}, ${m.nickname ?? null},
                ${String(m.displayName ?? m.username ?? m.discordId)}, ${JSON.stringify(m.roleNames ?? [])},
                ${privilege}, ${status}, now())
        on conflict (discord_id) do update set
          username = excluded.username, nickname = excluded.nickname, display_name = excluded.display_name,
          role_names = excluded.role_names, highest_privilege = excluded.highest_privilege,
          discord_status = excluded.discord_status, synced_at = now()`;
    }
    if (Array.isArray(body.removed)) {
      for (const id of body.removed as string[]) await sql`delete from discord_member where discord_id = ${String(id)}`;
    }
    return json({ ok: true, count: members.length });
  }

  if (action === "presence") {
    const presences = Array.isArray(body.presences) ? (body.presences as { discordId: string; discordStatus: string }[]) : [];
    for (const p of presences) {
      const status = STATUSES.has(p.discordStatus) ? p.discordStatus : "offline";
      await sql`
        update discord_member set discord_status = ${status}, last_presence_at = now()
        where discord_id = ${String(p.discordId)}`;
    }
    return json({ ok: true, count: presences.length });
  }

  if (action === "moderation-result") {
    const requestId = String(body.requestId ?? "");
    const status = body.status === "success" ? "success" : "failed";
    const error = body.error ? String(body.error).slice(0, 1000) : null;
    const rows = await sql<{
      action: string;
      moderator_discord_id: string;
      target_discord_id: string;
      reason: string;
      duration_ms: number | null;
    }>`
      update moderation_request set status = ${status}, error = ${error}, completed_at = now()
      where id = ${requestId}
      returning action, moderator_discord_id, target_discord_id, reason, duration_ms`;
    const req = rows[0];
    if (!req) return json({ error: "Unknown requestId" }, 404);
    const moderatorName = await discordName(req.moderator_discord_id);
    const targetName = await discordName(req.target_discord_id);
    const block = [
      "------------------------------------------------------------",
      `Date: ${new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}`,
      `Status: ${status.toUpperCase()}`,
      `Action: ${req.action.toUpperCase()}`,
      `Moderator Name: ${moderatorName}`,
      `Target Name: ${targetName} (${req.target_discord_id})`,
      `Request ID: ${requestId}`,
      req.duration_ms ? `Duration: ${Math.round(Number(req.duration_ms) / 1000)} seconds` : "Duration: Not set",
      "Reason:",
      req.reason,
      error ? `Error: ${error}` : "",
      "------------------------------------------------------------",
      "",
    ]
      .filter(Boolean)
      .join("\r\n");
    await appendTextFile("public", `${DISCORD_LOGS}/${AUDIT_LOG_NAME}`, `${block}\r\n`, "bot");
    await notify(
      `Moderation ${status === "success" ? "ausgeführt" : "fehlgeschlagen"}`,
      `${req.action.toUpperCase()} gegen ${targetName} durch ${moderatorName}${error ? ` – ${error}` : ""}.`,
    );
    return json({ ok: true });
  }

  if (action === "inspect-result") {
    const requestId = String(body.requestId ?? "");
    const result = {
      requestId,
      messageId: String(body.messageId ?? ""),
      found: Boolean(body.found),
      content: String(body.content ?? ""),
      authorId: body.authorId ? String(body.authorId) : undefined,
      authorName: body.authorName ? String(body.authorName) : undefined,
      channelId: body.channelId ? String(body.channelId) : undefined,
      channelName: body.channelName ? String(body.channelName) : undefined,
      createdAt: iso(body.createdAt) ?? undefined,
      error: body.error ? String(body.error) : undefined,
    };
    await sql`
      update message_inspect set status = 'done', result_json = ${JSON.stringify(result)}, completed_at = now()
      where id = ${requestId}`;
    return json({ ok: true });
  }

  return json({ error: "Not found" }, 404);
}

export const Route = createFileRoute("/api/bridge/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => handle(request, params._splat ?? ""),
      POST: ({ request, params }) => handle(request, params._splat ?? ""),
    },
  },
});
