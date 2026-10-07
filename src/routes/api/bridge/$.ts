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
//   POST /api/bridge/file-take          -> { fileId, idx } -> next piece of an upload for the bot's PC
//   POST /api/bridge/file-stored        -> { fileId, ok, error? }
//   POST /api/bridge/file-down          -> { fileId, idx, data } (piece of a requested file) -> { pending }
//   POST /api/bridge/file-down-done     -> { fileId, ok, totalChunks?, error? }
//   GET  /api/bridge/sanctions-active   -> active mod_sanction[] (Bot-Reconcile)
//   GET  /api/bridge/queue              also returns alerts[] + chatboxHints[]
import { createFileRoute } from "@tanstack/react-router";
import { appendTextFile, discordName, getSetting, getSql, iso, newId, notify, setSetting } from "@/lib/furr/core";
import { bridgeError, bridgeJson, runSideEffect, safeJsonParse } from "@/lib/furr/http";
import { createThrottle } from "@/lib/furr/cache";
import { invalidatePresenceCache } from "@/lib/furr/presence-cache";
import { AUDIT_LOG_NAME, DISCORD_LOGS, VRCHAT_LOGS } from "@/lib/furr/paths";
import { VRC_ACCESS, VRC_REGION, parseLocation, vrchatAuditAction } from "@/lib/furr/vrchat-location";
import { isRole } from "@/lib/furr/roles";
import { dutyLines } from "@/lib/furr/duty-announce";
import { enrichQueuePayload, handleIdeenBridge, maybeEnqueueDutyEmptyAlert } from "@/lib/furr/bridge-ideen";
import { takeBotAlerts } from "@/lib/furr/alerts";
import { takeChatboxHintsForBridge } from "@/lib/furr/api/chatbox-hint";
import { loadActiveSanctions } from "@/lib/furr/api/sanctions";
import { alertIfNoOneOnDuty } from "@/lib/furr/api/duty";
import { appendAuditLater } from "@/lib/furr/audit";
import { fireStartingSoonReminders, replaceCalendarEvents } from "@/lib/furr/api/calendar";

const MAX_MEMBERS_PER_PUSH = 2_000;
const MAX_PRESENCES_PER_PUSH = 2_000;
const MAX_AUDIT_ENTRIES = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Batch-Größe für members/presence (1 Statement statt 1 pro Mitglied). */
const BATCH_SIZE = 500;

// ---------- Ressourcen ----------
// bot_last_seen: vorher 1 Upsert bei JEDEM Bridge-Call (Queue-Poll, jedes Datei-Chunk, Pushes).
// bridgeStatus() wertet ein 60-s-Fenster aus → 15 s Schreib-Drossel ist sicher (worst case ~25 s alt).
const BOT_SEEN_WRITE_MS = 15_000;
const shouldWriteBotSeen = createThrottle(BOT_SEEN_WRITE_MS);
// Stale-Cleanup (Schwellen 12 min / 30 min / 1 h) braucht keine 5-s-Auflösung → max. 1x pro Minute.
// Die Dispatch-Queries filtern das Alter zusätzlich selbst, Semantik bleibt exakt gleich.
const QUEUE_CLEANUP_MS = 60_000;
const shouldCleanupQueue = createThrottle(QUEUE_CLEANUP_MS);
const CALENDAR_SOON_MS = 60_000;
const shouldFireCalendarSoon = createThrottle(CALENDAR_SOON_MS);

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * "Instance opened" message for Discord: who is anwesend (can moderate right now) and who is not.
 * Queued for the bot when a duty channel is set (FurrSettings → FurrBox VR).
 */
async function announceInstance(headline: string) {
  const channelId = await getSetting("duty_channel_id", "1434484156431204382");
  if (!/^\d{17,22}$/.test(channelId)) return;
  const sql = await getSql();
  const duty = await dutyLines();
  const content = [`🟢 **Neue Gruppen-Instanz:** ${headline}`, ...duty.lines].join("\n").slice(0, 1900);
  // kind "duty-instance": the bot adds the buttons „Anwesend“ / „Nicht anwesend“ and – when nobody
  // is there – marks the team roles. (Fallback for a database without the newer outbox columns.)
  try {
    await sql`
      insert into bot_outbox (id, channel_id, content, kind, components_json)
      values (${newId()}, ${channelId}, ${content}, 'duty-instance', ${JSON.stringify({ ping: !duty.anyone })})`;
  } catch {
    await sql`insert into bot_outbox (id, channel_id, content) values (${newId()}, ${channelId}, ${content})`;
  }
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
  if (!process.env.BOT_BRIDGE_TOKEN) return bridgeError("BOT_BRIDGE_TOKEN ist nicht gesetzt.", 503);
  if (!authorized(request)) return bridgeError("Unauthorized", 401);
  const sql = await getSql();
  if (shouldWriteBotSeen()) await setSetting("bot_last_seen", new Date().toISOString());

  if (request.method === "GET" && action === "queue") {
    if (shouldCleanupQueue()) {
      // Stuck Discord moderation / inspect after bot picked them up but never reported back.
      await sql`
        update moderation_request set status = 'failed', error = 'Der Discord-Bot hat nicht reagiert.', completed_at = now()
        where status = 'dispatched' and created_at < now() - interval '12 minutes'`;
      await sql`
        update message_inspect set status = 'failed', completed_at = now()
        where status in ('queued', 'dispatched') and created_at < now() - interval '12 minutes'`;
      // VRChat jobs. A login job's payload (contains the password) is wiped on failure, too.
      await sql`
        update vrchat_job set status = 'failed', error = 'Der Discord-Bot hat nicht reagiert.', payload_json = null
        where status in ('queued', 'dispatched') and created_at < now() - interval '12 minutes'`;
      await sql`delete from bot_file_chunk where direction = 'down' and created_at < now() - interval '30 minutes'`;
      await sql`delete from bot_outbox where created_at < now() - interval '1 hour'`;
    }

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
      where id in (
        select id from message_inspect
        where status = 'queued' and created_at > now() - interval '12 minutes'
        order by created_at limit 20)
      returning id, message_id`;
    // VRChat jobs in EINEM Statement (vorher 1 Select + 1 Update pro Job). `picked` liefert die
    // Werte VOR dem Update – der Bot bekommt das Login-Payload genau einmal, in der DB wird es gelöscht.
    const vrchatJobs = await sql<{ id: string; kind: string; payload_json: string | null }>`
      with picked as (
        select id, kind, payload_json, created_at from vrchat_job
        where status = 'queued' and created_at > now() - interval '12 minutes'
        order by created_at limit 10
      ), dispatched as (
        update vrchat_job v set status = 'dispatched',
          payload_json = case when v.kind = 'login' then null else v.payload_json end
        from picked where v.id = picked.id
        returning v.id
      )
      select picked.id, picked.kind, picked.payload_json
      from picked join dispatched on dispatched.id = picked.id
      order by picked.created_at`;
    // Big evidence files on the bot's PC: uploads in progress and files someone wants to see.
    const uploads = await sql<{ id: string; folder: string; name: string; bot_chunks: number | null }>`
      select id, folder, name, bot_chunks from furr_file where on_bot and bot_state = 'uploading'`;
    const downloads = await sql<{ id: string; folder: string; name: string }>`
      update bot_file_request r set status = 'sending' from furr_file f
      where f.id = r.file_id and r.status = 'queued'
      returning f.id, f.folder, f.name`;
    // Discord messages for the bot to post (handed out once; older than 1 h are never sent).
    // Ideen: Embed/Vote-Felder wenn Migration 0016 da ist – sonst Fallback auf content-only.
    let outbox: {
      id: string;
      channel_id: string;
      content: string;
      kind?: string | null;
      embed_json?: string | null;
      components_json?: string | null;
      dedupe_key?: string | null;
      discord_message_id?: string | null;
      ref_id?: string | null;
    }[] = [];
    try {
      outbox = await sql`
        update bot_outbox set status = 'sent'
        where status = 'queued' and created_at > now() - interval '1 hour'
        returning id, channel_id, content, kind, embed_json, components_json, dedupe_key, discord_message_id, ref_id`;
    } catch {
      outbox = await sql<{ id: string; channel_id: string; content: string }>`
        update bot_outbox set status = 'sent'
        where status = 'queued' and created_at > now() - interval '1 hour'
        returning id, channel_id, content`;
    }
    // Lets the bot poll fast only while someone has FurrBox open (keeps the database asleep otherwise).
    const activeRows = await sql<{ n: number }>`
      select count(*)::int as n from furr_presence where last_heartbeat_at > now() - interval '3 minutes'`;
    const [alerts, chatboxHints] = await Promise.all([takeBotAlerts(20), takeChatboxHintsForBridge(5)]);
    if (shouldFireCalendarSoon()) {
      void runSideEffect(() => fireStartingSoonReminders(), "calendar-starting-soon");
    }
    return bridgeJson(await enrichQueuePayload(sql, {
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
      vrchatJobs: vrchatJobs.map((j) => ({
        jobId: j.id,
        kind: j.kind,
        payload: safeJsonParse<Record<string, unknown>>(j.payload_json, {}),
      })),
      discordMessages: outbox.map((m) => ({
        id: m.id,
        channelId: m.channel_id,
        content: m.content,
        kind: m.kind || "plain",
        embedJson: m.embed_json ?? null,
        componentsJson: m.components_json ?? null,
        dedupeKey: m.dedupe_key ?? null,
        discordMessageId: m.discord_message_id ?? null,
        voteId: m.ref_id ?? null,
        refId: m.ref_id ?? null,
      })),
      botFiles: {
        uploads: uploads.map((u) => ({ fileId: u.id, folder: u.folder, name: u.name, totalChunks: u.bot_chunks })),
        downloads: downloads.map((d) => ({ fileId: d.id, folder: d.folder, name: d.name })),
      },
      // Additiv: Bot kann ignorieren bis er Alerts/Hints unterstützt.
      alerts,
      chatboxHints: chatboxHints.map((h) => ({
        hintId: h.hintId,
        text: h.text,
        expiresAt: h.expiresAt,
        kind: "show-chatbox",
      })),
    }));
  }

  if (request.method === "GET" && action === "sanctions-active") {
    const sanctions = await loadActiveSanctions();
    return bridgeJson({ ok: true, sanctions });
  }

  if (request.method !== "POST") return bridgeError("Not found", 404);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  // Ideen-Features (Duty, WL, Hint, Sanctions, Vote, Flags, Clip) – eigener Handler.
  {
    const ideen = await handleIdeenBridge(action, body);
    if (ideen) return ideen;
  }

  if (action === "calendar-events") {
    const groupId = String(body.groupId ?? "").trim();
    if (!groupId.startsWith("grp_")) return bridgeError("groupId ungültig", 400);
    const entries = Array.isArray(body.events) ? (body.events as Array<Record<string, unknown>>) : [];
    await replaceCalendarEvents(
      groupId,
      entries.map((e) => ({
        id: String(e.id ?? "").slice(0, 80),
        title: String(e.title ?? "").slice(0, 200),
        description: e.description != null ? String(e.description).slice(0, 1000) : null,
        startsAt: String(e.startsAt ?? e.starts_at ?? ""),
        endsAt: e.endsAt != null ? String(e.endsAt) : e.ends_at != null ? String(e.ends_at) : null,
        category: e.category != null ? String(e.category) : null,
        imageUrl: e.imageUrl != null ? String(e.imageUrl) : e.image_url != null ? String(e.image_url) : null,
      })),
    );
    appendAuditLater({ source: "bot", action: "calendar.push", detail: `${entries.length} events`, meta: { groupId } });
    return bridgeJson({ ok: true, count: entries.length });
  }

  if (action === "file-take") {
    const fileId = String(body.fileId ?? "");
    if (!UUID_RE.test(fileId)) return bridgeError("Ungültige fileId", 400);
    const idx = Math.max(0, Math.trunc(Number(body.idx) || 0));
    const rows = await sql<{ data_b64: string }>`
      delete from bot_file_chunk where file_id = ${fileId} and direction = 'up' and idx = ${idx} returning data_b64`;
    const [f] = await sql<{ bot_chunks: number | null; bot_state: string | null }>`
      select bot_chunks, bot_state from furr_file where id = ${fileId}`;
    return bridgeJson({ data: rows[0]?.data_b64 ?? null, totalChunks: f?.bot_chunks ?? null, active: f?.bot_state === "uploading" });
  }

  if (action === "file-stored") {
    const fileId = String(body.fileId ?? "");
    if (!UUID_RE.test(fileId)) return bridgeError("Ungültige fileId", 400);
    const ok = Boolean(body.ok);
    await sql`
      update furr_file set bot_state = ${ok ? "stored" : "failed"}, bot_error = ${ok ? null : String(body.error ?? "Fehler beim Speichern").slice(0, 300)}
      where id = ${fileId}`;
    await sql`delete from bot_file_chunk where file_id = ${fileId} and direction = 'up'`;
    return bridgeJson({ ok: true });
  }

  if (action === "file-down") {
    const fileId = String(body.fileId ?? "");
    if (!UUID_RE.test(fileId)) return bridgeError("Ungültige fileId", 400);
    const idx = Math.max(0, Math.trunc(Number(body.idx) || 0));
    // Without data it is only a "how many pieces are still waiting?" check.
    if (typeof body.data === "string") {
      await sql`
        insert into bot_file_chunk (file_id, direction, idx, data_b64) values (${fileId}, 'down', ${idx}, ${body.data})
        on conflict (file_id, direction, idx) do update set data_b64 = excluded.data_b64, created_at = now()`;
    }
    const [{ n }] = await sql<{ n: number }>`
      select count(*)::int as n from bot_file_chunk where file_id = ${fileId} and direction = 'down'`;
    const [r] = await sql<{ status: string }>`select status from bot_file_request where file_id = ${fileId}`;
    return bridgeJson({ pending: n, cancelled: r?.status !== "sending" });
  }

  if (action === "file-down-done") {
    const fileId = String(body.fileId ?? "");
    if (!UUID_RE.test(fileId)) return bridgeError("Ungültige fileId", 400);
    const ok = Boolean(body.ok);
    await sql`
      update bot_file_request set status = ${ok ? "done" : "failed"}, total_chunks = ${ok ? Math.trunc(Number(body.totalChunks) || 0) : null},
        error = ${ok ? null : String(body.error ?? "Fehler").slice(0, 300)}
      where file_id = ${fileId}`;
    return bridgeJson({ ok: true });
  }

  if (action === "members") {
    const members = Array.isArray(body.members) ? (body.members as MemberSnapshot[]).slice(0, MAX_MEMBERS_PER_PUSH) : [];
    // Batch-Upsert: vorher 1 Round-Trip pro Mitglied (Full-Sync 200er-Pakete = 200 Queries),
    // jetzt 1 Statement pro 500. Dedupe nötig – ON CONFLICT darf eine Zeile nur 1x treffen.
    const rows = new Map<string, Record<string, string | null>>();
    for (const m of members) {
      const discordId = String(m?.discordId ?? "");
      if (!/^\d{17,22}$/.test(discordId)) continue;
      rows.set(discordId, {
        discord_id: discordId,
        username: String(m.username ?? discordId),
        nickname: m.nickname ?? null,
        display_name: String(m.displayName ?? m.username ?? discordId),
        role_names: JSON.stringify(m.roleNames ?? []),
        highest_privilege: isRole(m.highestPrivilege) ? String(m.highestPrivilege) : "none",
        discord_status: STATUSES.has(String(m.discordStatus)) ? String(m.discordStatus) : "offline",
      });
    }
    for (const batch of chunks([...rows.values()], BATCH_SIZE)) {
      await sql.query(
        `insert into discord_member (discord_id, username, nickname, display_name, role_names, highest_privilege, discord_status, synced_at)
         select r.discord_id, r.username, r.nickname, r.display_name, r.role_names, r.highest_privilege, r.discord_status, now()
         from jsonb_to_recordset($1::jsonb) as r(discord_id text, username text, nickname text, display_name text,
                                                 role_names text, highest_privilege text, discord_status text)
         on conflict (discord_id) do update set
           username = excluded.username, nickname = excluded.nickname, display_name = excluded.display_name,
           role_names = excluded.role_names, highest_privilege = excluded.highest_privilege,
           discord_status = excluded.discord_status, synced_at = now()`,
        [JSON.stringify(batch)],
      );
    }
    if (Array.isArray(body.removed)) {
      const removed = (body.removed as unknown[]).slice(0, MAX_MEMBERS_PER_PUSH).map(String);
      if (removed.length) {
        await sql.query(`delete from discord_member where discord_id = any($1::text[])`, [removed]);
      }
    }
    if (rows.size || (Array.isArray(body.removed) && body.removed.length)) invalidatePresenceCache();
    return bridgeJson({ ok: true, count: members.length });
  }

  if (action === "presence") {
    const presences = Array.isArray(body.presences)
      ? (body.presences as { discordId: string; discordStatus: string }[]).slice(0, MAX_PRESENCES_PER_PUSH)
      : [];
    // Batch-Update (vorher 1 Update pro Statuswechsel). Letzter Status pro ID gewinnt.
    const latest = new Map<string, string>();
    for (const p of presences) {
      if (!p?.discordId) continue;
      latest.set(String(p.discordId), STATUSES.has(p.discordStatus) ? p.discordStatus : "offline");
    }
    const rows = [...latest].map(([discord_id, discord_status]) => ({ discord_id, discord_status }));
    for (const batch of chunks(rows, BATCH_SIZE)) {
      await sql.query(
        `update discord_member dm set discord_status = r.discord_status, last_presence_at = now()
         from jsonb_to_recordset($1::jsonb) as r(discord_id text, discord_status text)
         where dm.discord_id = r.discord_id`,
        [JSON.stringify(batch)],
      );
    }
    if (rows.length) invalidatePresenceCache();
    return bridgeJson({ ok: true, count: presences.length });
  }

  if (action === "moderation-result") {
    const requestId = String(body.requestId ?? "");
    if (!UUID_RE.test(requestId)) return bridgeError("Ungültige requestId", 400);
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
    if (!req) return bridgeError("Unknown requestId", 404);
    // Audit-Log + Notify nach dem kritischen DB-Update – mit Timeout, Bot wartet nicht ewig.
    await runSideEffect(async () => {
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
    }, "moderation-result-audit");
    return bridgeJson({ ok: true });
  }

  if (action === "inspect-result") {
    const requestId = String(body.requestId ?? "");
    if (!UUID_RE.test(requestId)) return bridgeError("Ungültige requestId", 400);
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
    return bridgeJson({ ok: true });
  }

  if (action === "vrchat-result") {
    const jobId = String(body.jobId ?? "");
    if (!UUID_RE.test(jobId)) return bridgeError("Ungültige jobId", 400);
    const ok = Boolean(body.ok);
    const error = ok ? null : String(body.error ?? "Unbekannter Fehler").slice(0, 500);
    const rows = await sql<{ kind: string; payload_json: string | null; requested_by: string }>`
      update vrchat_job set status = ${ok ? "done" : "failed"}, result_json = ${JSON.stringify(body.result ?? null)},
        error = ${error}, completed_at = now()
      where id = ${jobId}
      returning kind, payload_json, requested_by`;
    const job = rows[0];
    if (!job) return bridgeError("Unknown jobId", 404);
    if (job.kind === "moderate" && job.payload_json) {
      const p = safeJsonParse<{ action: string; userId: string; userName?: string; reason: string } | null>(job.payload_json, null);
      if (p?.userId && p.reason) {
        const label: Record<string, string> = { kick: "Kick", ban: "Bann", unban: "Entbannung" };
        const mods = await sql<{ display_name: string; role: string }>`
          select display_name, role from furr_profile where user_id = ${job.requested_by}`;
        const modName = mods[0]?.display_name ?? "Unbekannt";
        // DB-Eintrag synchron (ModLog / Audit-Dedup) – Datei + Notify mit Timeout.
        await sql`
          insert into vrchat_moderation (id, action, target_user_id, target_name, reason, moderator_user_id, status, error)
          values (${newId()}, ${p.action}, ${p.userId}, ${p.userName || null}, ${p.reason}, ${job.requested_by},
                  ${ok ? "success" : "failed"}, ${error})`;
        await runSideEffect(async () => {
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
        }, "vrchat-result-audit");
      }
    }
    return bridgeJson({ ok: true });
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
    const entries = Array.isArray(body.entries) ? (body.entries as Entry[]).slice(0, MAX_AUDIT_ENTRIES) : [];
    const silent = Boolean(body.initial); // first import: no notification storm
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
      const actionLabel = vrchatAuditAction(String(e.eventType));
      // Kicks/bans FurrBox itself triggered through the bot are announced already.
      const viaFurrBox = e.targetId
        ? await sql`
            select 1 from vrchat_moderation
            where target_user_id = ${e.targetId} and created_at > now() - interval '3 minutes'`
        : [];
      if (!silent && actionLabel && !viaFurrBox.length) {
        await runSideEffect(
          () => notify(`VRChat: ${actionLabel}`, e.description || `${e.actorDisplayName ?? "Jemand"} – ${e.eventType}`),
          "vrchat-audit-notify",
        );
      }
    }
    return bridgeJson({ ok: true, added });
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
        if (!i?.instanceId || !i.location || !i.world?.id) continue;
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
          const headline = `${i.world.name} · ${VRC_REGION[loc.region] ?? loc.region} · ${VRC_ACCESS[loc.access] ?? loc.access} · ${i.memberCount} ${i.memberCount === 1 ? "Person" : "Personen"}`;
          await runSideEffect(async () => {
            await notify("VRChat-Instanz geöffnet", headline);
            await announceInstance(headline);
            await alertIfNoOneOnDuty(headline);
          }, "instance-opened");
        }
      }
      await sql.query(
        `update vrchat_instance set closed_at = now() where closed_at is null and not (instance_id = any($1::text[]))`,
        [instances.map((i) => i.instanceId)],
      );
    }
    return bridgeJson({ ok: true });
  }

  // Bot/Desktop kann Joins aus dem VRChat-Log melden (kein Server-Polling).
  if (action === "watchlist-sighting") {
    const usrId = String(body.usrId ?? "").trim();
    if (!/^usr_[0-9a-f-]{36}$/i.test(usrId)) return bridgeError("usrId ungültig", 400);
    const kind = body.kind === "leave" || body.kind === "rejoin" ? String(body.kind) : "join";
    const displayName = body.displayName ? String(body.displayName).slice(0, 100) : null;
    const world = body.world ? String(body.world).slice(0, 150) : null;
    const instanceId = body.instanceId ? String(body.instanceId).slice(0, 120) : null;
    const watched = await sql<{ usr_id: string; note: string; alarm_join: boolean }>`
      select usr_id, note, alarm_join from watchlist_entry where usr_id = ${usrId}`;
    const id = newId();
    const hopSec = Number(await getSetting("watchlist_hop_window_sec", "90")) || 90;
    const recent = await sql<{ kind: string }>`
      select kind from watchlist_sighting
      where usr_id = ${usrId} and seen_at > now() - (${hopSec}::int * interval '1 second')
      order by seen_at desc limit 5`;
    const hopping = kind !== "leave" && recent.some((r) => r.kind === "join" || r.kind === "rejoin");
    await sql`
      insert into watchlist_sighting (id, usr_id, display_name, kind, world, instance_id, hopping, source, seen_at)
      values (${id}, ${usrId}, ${displayName}, ${hopping && kind === "join" ? "rejoin" : kind},
              ${world}, ${instanceId}, ${hopping}, 'bridge', now())`;
    if (watched[0]?.alarm_join && kind !== "leave") {
      const { publishAlertLater } = await import("@/lib/furr/alerts");
      publishAlertLater({
        kind: "watchlist.join",
        severity: hopping ? "critical" : "warn",
        title: hopping ? "Watchlist: Rejoin-Hopping" : "Watchlist: Join",
        body: `${displayName || usrId}${world ? ` @ ${world}` : ""}`,
        dedupKey: `wl:${usrId}:${kind}:${Math.floor(Date.now() / 30_000)}`,
        payload: { usrId, hopping, sightingId: id, note: watched[0].note },
      });
    }
    appendAuditLater({
      source: "bot",
      action: hopping ? "watchlist.hopping" : `watchlist.${kind}`,
      targetId: usrId,
      targetName: displayName,
      detail: world,
    });
    return bridgeJson({ ok: true, id, hopping, onList: Boolean(watched[0]) });
  }

  return bridgeError("Not found", 404);
}

async function safeHandle(request: Request, action: string) {
  try {
    return await handle(request, action);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Interner Bridge-Fehler";
    console.warn("[furrbox] bridge error", action, message);
    return bridgeError(message.slice(0, 300), 500, "BRIDGE_ERROR");
  }
}

export const Route = createFileRoute("/api/bridge/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => safeHandle(request, params._splat ?? ""),
      POST: ({ request, params }) => safeHandle(request, params._splat ?? ""),
    },
  },
});

