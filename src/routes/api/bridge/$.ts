// Discord bot bridge (replaces the Socket.io "bot-bridge" room).
// The bot authenticates with `Authorization: Bearer $BOT_BRIDGE_TOKEN` and polls:
//   GET  /api/bridge/queue              -> pending moderation commands + message inspections
//   POST /api/bridge/members            -> { members: DiscordMemberSnapshot[] }
//   POST /api/bridge/presence           -> { presences: { discordId, discordStatus }[] }
//   POST /api/bridge/moderation-result  -> { requestId, status: "success"|"failed", error? }
//   POST /api/bridge/inspect-result     -> { requestId, found, content, authorName?, channelName?, ... }
//   POST /api/bridge/vrchat-result      -> { jobId, ok, result?, error? }  (VRChat jobs from the queue)
//   POST /api/bridge/vrchat-state       -> { account, groupId, group, instances, error }
//   POST /api/bridge/vrchat-audit       -> { entries: VRChat group audit log entries }
import { createFileRoute } from "@tanstack/react-router";
import { appendTextFile, discordName, getSql, iso, newId, notify, setSetting } from "@/lib/furr/core";
import { AUDIT_LOG_NAME, DISCORD_LOGS, VRCHAT_LOGS } from "@/lib/furr/paths";
import { VRC_ACCESS, VRC_REGION, parseLocation, vrchatAuditAction } from "@/lib/furr/vrchat-location";
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
    // VRChat jobs. A login job's payload (contains the password) is wiped as soon as it is handed out.
    await sql`
      update vrchat_job set status = 'failed', error = 'Der Discord-Bot hat nicht reagiert.', payload_json = null
      where status = 'queued' and created_at < now() - interval '12 minutes'`;
    const vrchatJobs = await sql<{ id: string; kind: string; payload_json: string | null }>`
      select id, kind, payload_json from vrchat_job where status = 'queued' order by created_at limit 10`;
    for (const job of vrchatJobs) {
      if (job.kind === "login") {
        await sql`update vrchat_job set status = 'dispatched', payload_json = null where id = ${job.id}`;
      } else {
        await sql`update vrchat_job set status = 'dispatched' where id = ${job.id}`;
      }
    }
    // Lets the bot poll fast only while someone has FurrBox open (keeps the database asleep otherwise).
    const activeRows = await sql<{ n: number }>`
      select count(*)::int as n from furr_presence where last_heartbeat_at > now() - interval '3 minutes'`;
    return json({
      active: (activeRows[0]?.n ?? 0) > 0,
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
      vrchatJobs: vrchatJobs.map((j) => ({ jobId: j.id, kind: j.kind, payload: j.payload_json ? JSON.parse(j.payload_json) : {} })),
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

  if (action === "vrchat-result") {
    const jobId = String(body.jobId ?? "");
    const ok = Boolean(body.ok);
    const error = ok ? null : String(body.error ?? "Unbekannter Fehler").slice(0, 500);
    const rows = await sql<{ kind: string; payload_json: string | null; requested_by: string }>`
      update vrchat_job set status = ${ok ? "done" : "failed"}, result_json = ${JSON.stringify(body.result ?? null)},
        error = ${error}, completed_at = now()
      where id = ${jobId}
      returning kind, payload_json, requested_by`;
    const job = rows[0];
    if (!job) return json({ error: "Unknown jobId" }, 404);
    if (job.kind === "moderate" && job.payload_json) {
      const p = JSON.parse(job.payload_json) as { action: string; userId: string; userName?: string; reason: string };
      const label: Record<string, string> = { kick: "Kick", ban: "Bann", unban: "Entbannung" };
      const mods = await sql<{ display_name: string; role: string }>`
        select display_name, role from furr_profile where user_id = ${job.requested_by}`;
      const modName = mods[0]?.display_name ?? "Unbekannt";
      await sql`
        insert into vrchat_moderation (id, action, target_user_id, target_name, reason, moderator_user_id, status, error)
        values (${newId()}, ${p.action}, ${p.userId}, ${p.userName || null}, ${p.reason}, ${job.requested_by},
                ${ok ? "success" : "failed"}, ${error})`;
      const block = [
        "------------------------------------------------------------",
        `Datum: ${new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}`,
        "Plattform: VRChat (Gruppe)",
        `Status: ${ok ? "ERFOLGREICH" : "FEHLGESCHLAGEN"}`,
        `Aktion: ${label[p.action] ?? p.action}`,
        `Moderator: ${modName}`,
        `Ziel: ${p.userName || p.userId} (${p.userId})`,
        "Grund:",
        p.reason,
        error ? `Fehler: ${error}` : "",
        "------------------------------------------------------------",
        "",
      ]
        .filter(Boolean)
        .join("\r\n");
      await appendTextFile("public", `${VRCHAT_LOGS}/${AUDIT_LOG_NAME}`, `${block}\r\n`, job.requested_by);
      await notify(
        `VRChat: ${label[p.action] ?? p.action} ${ok ? "ausgeführt" : "fehlgeschlagen"}`,
        `${p.userName || p.userId} – von ${modName}${error ? ` (${error})` : ""}`,
      );
    }
    return json({ ok: true });
  }

  if (action === "vrchat-audit") {
    type Entry = {
      id: string;
      created_at: string;
      actorId?: string;
      actorDisplayName?: string;
      targetId?: string;
      eventType: string;
      description?: string;
      data?: unknown;
    };
    const entries = Array.isArray(body.entries) ? (body.entries as Entry[]) : [];
    const silent = Boolean(body.initial); // first import: no notification storm
    const conns = await sql<{ account_id: string | null }>`select account_id from vrchat_connection where id = 1`;
    const botAccount = conns[0]?.account_id ?? null;
    let added = 0;
    for (const e of entries) {
      if (!e?.id || !e.eventType) continue;
      const rows = await sql<{ id: string }>`
        insert into vrchat_audit (id, created_at, actor_id, actor_name, target_id, event_type, description, data_json)
        values (${String(e.id)}, ${iso(e.created_at) ?? new Date().toISOString()}, ${e.actorId ?? null}, ${e.actorDisplayName ?? null},
                ${e.targetId ?? null}, ${String(e.eventType)}, ${e.description ?? null}, ${e.data ? JSON.stringify(e.data) : null})
        on conflict (id) do nothing
        returning id`;
      if (!rows.length) continue;
      added += 1;
      const action = vrchatAuditAction(String(e.eventType));
      // Actions FurrBox itself triggered through the bot are announced already.
      if (!silent && action && e.actorId !== botAccount) {
        await notify(`VRChat: ${action}`, e.description || `${e.actorDisplayName ?? "Jemand"} – ${e.eventType}`);
      }
    }
    return json({ ok: true, added });
  }

  if (action === "vrchat-state") {
    type Instance = {
      instanceId: string;
      location: string;
      memberCount: number;
      world: { id: string; name: string; capacity: number; image: string | null };
    };
    const account = body.account as { id?: string; displayName?: string } | null;
    const group = (body.group ?? null) as Record<string, unknown> | null;
    const error = body.error ? String(body.error).slice(0, 500) : null;
    await sql`insert into vrchat_connection (id) values (1) on conflict (id) do nothing`;
    await sql`
      update vrchat_connection set account_name = ${account?.displayName ?? null}, account_id = ${account?.id ?? null},
        group_id = ${body.groupId ? String(body.groupId) : null}, group_json = ${group ? JSON.stringify(group) : null},
        last_error = ${error}, state_at = now()
      where id = 1`;
    if (Array.isArray(body.instances)) {
      const instances = body.instances as Instance[];
      const open = await sql<{ instance_id: string }>`select instance_id from vrchat_instance where closed_at is null`;
      const known = new Set(open.map((r) => r.instance_id));
      for (const i of instances) {
        const loc = parseLocation(i.location);
        await sql`
          insert into vrchat_instance (instance_id, location, world_id, world_name, world_image, capacity, member_count, region, access_type)
          values (${i.instanceId}, ${i.location}, ${i.world.id}, ${i.world.name}, ${i.world.image}, ${i.world.capacity},
                  ${i.memberCount}, ${loc.region}, ${loc.access})
          on conflict (instance_id) do update set
            location = excluded.location, world_name = excluded.world_name, world_image = excluded.world_image,
            capacity = excluded.capacity, member_count = excluded.member_count, last_seen = now(), closed_at = null,
            first_seen = case when vrchat_instance.closed_at is not null then now() else vrchat_instance.first_seen end`;
        if (!known.has(i.instanceId)) {
          await notify(
            "VRChat-Instanz geöffnet",
            `${i.world.name} · ${VRC_REGION[loc.region] ?? loc.region} · ${VRC_ACCESS[loc.access] ?? loc.access} · ${i.memberCount} ${i.memberCount === 1 ? "Person" : "Personen"}`,
          );
        }
      }
      await sql.query(
        `update vrchat_instance set closed_at = now() where closed_at is null and not (instance_id = any($1::text[]))`,
        [instances.map((i) => i.instanceId)],
      );
    }
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
