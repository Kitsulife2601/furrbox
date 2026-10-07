// FurrEvidence: structured evidence cases in the shared FurrFS + Discord moderation queue.
import { createServerFn } from "@tanstack/react-start";
import { accessMiddleware } from "../access";
import {
  bridgeStatus,
  discordName,
  ensureFolderPath,
  getSql,
  iso,
  loadMe,
  newId,
  notify,
  requirePermission,
  writeFile,
  writeTextFile,
} from "../core";
import { BOT_JOB_STALE_MS, BOT_JOB_STALE_MSG } from "../http";
import { appendAuditLater } from "../audit";
import { publishAlertLater } from "../alerts";
import { upsertSanctionFromBot } from "./sanctions";
import { DISCORD_LOGS, EVIDENCE_ROOT, MAX_UPLOAD_BYTES, formatSize, sanitizeName, sanitizeSegment } from "../paths";
import { MODERATION_ACTIONS, type ModerationAction } from "../roles";
import type { CaseStatus, EvidenceCase, Me, MessageProof, ModerationEntry } from "../types";

export const VIOLATION_CATEGORIES = [
  "Harassment",
  "Chat Spam",
  "NSFW Content",
  "Threats",
  "Impersonation",
  "ToS Violation",
  "Other",
] as const;

type EvidenceInput = {
  platform: "Discord" | "VRChat";
  targetPrimary: string;
  targetDiscordId: string;
  targetDisplayName: string;
  targetSecondary: string;
  messageId: string;
  messageProof: MessageProof | null;
  violationCategory: string;
  notes: string;
  files: { name: string; mimeType: string; base64: string }[];
  /** Big files: only described here, the content goes to the bot's PC afterwards (uploadBotChunk). */
  bigFiles?: { name: string; mimeType: string; size: number }[];
};

function formatGermanDateTime(date: Date) {
  return (
    new Intl.DateTimeFormat("de-DE", {
      timeZone: "Europe/Berlin",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
      .format(date)
      .replace(",", " -") + " Uhr"
  );
}

function buildReport(meta: EvidenceInput & { caseId: string; createdAt: Date; moderator: Me; fileSizes: number[] }) {
  const channel = meta.messageProof?.channelName
    ? `#${meta.messageProof.channelName}${meta.messageProof.channelId ? ` (ID: ${meta.messageProof.channelId})` : ""}`
    : meta.targetSecondary || "Nicht angegeben";
  const files = meta.files.length
    ? meta.files.map((f, i) => `${i + 1}. ${f.name} (${f.mimeType || "Datei"}, ${formatSize(meta.fileSizes[i])})`).join("\r\n")
    : "Keine separaten Dateien angehängt.";
  return [
    "==================================================",
    "        FURRBOX SYSTEM-MODERATIONSPROTOKOLL",
    "==================================================",
    "[FALL-INFORMATIONEN]",
    `Fall-ID       : ${meta.caseId}`,
    `Zeitpunkt     : ${formatGermanDateTime(meta.createdAt)}`,
    `Plattform     : ${meta.platform}`,
    `Kategorie     : ${meta.violationCategory}`,
    `Zielperson    : ${meta.targetDisplayName || meta.targetPrimary} (ID: ${meta.targetDiscordId || "Nicht angegeben"})`,
    `Moderator     : ${meta.moderator.displayName} (Rolle: ${meta.moderator.roleLabel})`,
    "",
    "[BEWEISMITTEL & QUELLEN]",
    `Nachrichten-ID: ${meta.messageId || "Nicht angegeben"}`,
    `Server/Channel: ${channel}`,
    "Inhalt der Nachricht:",
    "--------------------------------------------------",
    meta.messageProof?.content?.trim() || "Keine Discord-Nachricht geladen.",
    "--------------------------------------------------",
    "",
    "[ANGEHÄNGTE DATEIEN]",
    "--------------------------------------------------",
    files,
    "--------------------------------------------------",
    "",
    "[MODERATOR NOTIZEN]",
    "--------------------------------------------------",
    meta.notes || "Keine Moderator-Notizen eingetragen.",
    "--------------------------------------------------",
    "==================================================",
    "",
  ].join("\r\n");
}

export const saveEvidenceCase = createServerFn({ method: "POST" })
  .validator((input: EvidenceInput): EvidenceInput => {
    const files = Array.isArray(input.files) ? input.files.slice(0, 32) : [];
    const bigFiles = Array.isArray(input.bigFiles) ? input.bigFiles.slice(0, 32) : [];
    const total = files.reduce((sum, f) => sum + Math.floor((String(f.base64 ?? "").length * 3) / 4), 0);
    if (total > MAX_UPLOAD_BYTES) throw new Error("Beweisdateien sind zusammen zu groß (max. 3 MB).");
    return {
      platform: input.platform === "VRChat" ? "VRChat" : "Discord",
      targetPrimary: String(input.targetPrimary ?? "").trim().slice(0, 200),
      targetDiscordId: String(input.targetDiscordId ?? "").trim(),
      targetDisplayName: String(input.targetDisplayName ?? "").trim().slice(0, 200),
      targetSecondary: String(input.targetSecondary ?? "").trim().slice(0, 500),
      messageId: String(input.messageId ?? "").trim(),
      messageProof: input.messageProof && typeof input.messageProof === "object" ? input.messageProof : null,
      violationCategory: String(input.violationCategory ?? "Other").trim().slice(0, 80) || "Other",
      notes: String(input.notes ?? "").trim().slice(0, 10_000),
      files: files.map((f) => ({
        name: sanitizeName(String(f.name ?? "")) || "Beweis",
        mimeType: String(f.mimeType || "application/octet-stream").slice(0, 120),
        base64: String(f.base64 ?? ""),
      })),
      bigFiles: bigFiles.map((f) => ({
        name: sanitizeName(String(f.name ?? "")) || "Beweis",
        mimeType: String(f.mimeType || "application/octet-stream").slice(0, 120),
        size: Math.max(0, Math.trunc(Number(f.size) || 0)),
      })),
    };
  })
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    const me = await requirePermission(context.userId, "canUseEvidence");
    if (!data.targetPrimary) throw new Error("Zielperson muss angegeben werden.");
    const bigFiles = data.bigFiles ?? [];
    if (bigFiles.length && !(await bridgeStatus()).connected) {
      throw new Error("Große Dateien werden auf dem PC des Discord-Bots gespeichert – der Bot ist gerade offline.");
    }
    if (!data.files.length && !bigFiles.length && !data.messageProof?.found && !data.notes) {
      throw new Error("Mindestens eine Beweisdatei, eine geladene Discord-Nachricht oder Notizen sind nötig.");
    }

    const createdAt = new Date();
    const targetName =
      data.targetDisplayName || (data.targetDiscordId ? await discordName(data.targetDiscordId) : data.targetPrimary);
    const caseId = `${sanitizeSegment(targetName)}_${createdAt.toISOString().replace(/[:.]/g, "-")}`;
    const casePath = `${EVIDENCE_ROOT}/${data.platform}/${caseId}`;
    const fileSizes = data.files.map((f) => Math.floor((f.base64.length * 3) / 4));

    for (const [i, f] of data.files.entries()) {
      await writeFile({
        scope: "public",
        ownerId: null,
        folder: casePath,
        name: f.name,
        mimeType: f.mimeType,
        base64: f.base64,
        size: fileSizes[i],
        createdBy: context.userId,
      });
    }
    // Big files: a FurrFS entry now, the content follows piece by piece to the bot's PC.
    const uploads: { fileId: string; name: string }[] = [];
    if (bigFiles.length) {
      const sql = await getSql();
      await ensureFolderPath("public", null, casePath, context.userId);
      const taken = new Set(data.files.map((f) => f.name.toLowerCase()));
      for (const f of bigFiles) {
        let name = f.name;
        for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = f.name.replace(/(\.[^.]+)?$/, ` (${n})$1`);
        taken.add(name.toLowerCase());
        const fileId = newId();
        await sql`
          insert into furr_file (id, scope, owner_id, created_by, folder, name, is_folder, mime_type, size, content_b64, on_bot, bot_state)
          values (${fileId}, 'public', null, ${context.userId}, ${casePath}, ${name}, false, ${f.mimeType}, ${f.size}, null, true, 'uploading')`;
        uploads.push({ fileId, name });
      }
    }
    const allFiles = [...data.files, ...bigFiles.map((f, i) => ({ name: uploads[i].name, mimeType: f.mimeType, base64: "" }))];
    const allSizes = [...fileSizes, ...bigFiles.map((f) => f.size)];
    const report = buildReport({
      ...data,
      files: allFiles,
      targetDisplayName: targetName,
      caseId,
      createdAt,
      moderator: me,
      fileSizes: allSizes,
    });
    await writeTextFile("public", null, `${casePath}/Moderationsprotokoll.txt`, report, context.userId);
    if (data.platform === "Discord") {
      await writeTextFile("public", null, `${DISCORD_LOGS}/${sanitizeSegment(targetName)}_Report.txt`, report, context.userId);
    }
    await notify("Neuer Evidence-Fall", `${me.displayName} hat einen ${data.platform}-Fall zu ${targetName} (${data.violationCategory}) angelegt.`);
    await (await getSql())`
      insert into evidence_case_meta (case_path, status, assignee_id, updated_by)
      values (${casePath}, 'open', ${context.userId}, ${context.userId})
      on conflict (case_path) do nothing`.catch(() => undefined);
    return { caseId, casePath, uploads };
  });

export const listEvidenceCases = createServerFn({ method: "GET" })
  .middleware([accessMiddleware])
  .handler(async ({ context }): Promise<EvidenceCase[]> => {
    await requirePermission(context.userId, "canUseEvidence");
    const sql = await getSql();
    const rows = await sql.query<{
      folder: string;
      name: string;
      created_at: unknown;
      file_count: number;
      status: string | null;
      assignee_id: string | null;
      assignee_name: string | null;
      note: string | null;
      updated_at: unknown;
    }>(
      `select f.folder, f.name, f.created_at,
         (select count(*)::int from furr_file c where c.scope = 'public' and c.owner_id is null
            and c.folder = f.folder || '/' || f.name and c.is_folder = false) as file_count,
         m.status, m.assignee_id, p.display_name as assignee_name, m.note, m.updated_at
       from furr_file f
       left join evidence_case_meta m on m.case_path = f.folder || '/' || f.name
       left join furr_profile p on p.user_id = m.assignee_id
       where f.scope = 'public' and f.owner_id is null and f.is_folder = true and f.folder in ($1, $2)
       order by f.created_at desc limit 200`,
      [`${EVIDENCE_ROOT}/Discord`, `${EVIDENCE_ROOT}/VRChat`],
    );
    return rows.map((r) => ({
      path: `${r.folder}/${r.name}`,
      platform: r.folder.split("/").pop() ?? "",
      caseId: r.name,
      createdAt: iso(r.created_at) ?? "",
      fileCount: Number(r.file_count) || 0,
      status: (CASE_STATUSES.includes(r.status as CaseStatus) ? r.status : "open") as CaseStatus,
      assigneeId: r.assignee_id,
      assigneeName: r.assignee_id ? (r.assignee_name ?? "Unbekannt") : null,
      note: r.note,
      statusChangedAt: iso(r.updated_at),
    }));
  });

const CASE_STATUSES: CaseStatus[] = ["open", "working", "waiting", "done"];
const CASE_STATUS_LABEL: Record<CaseStatus, string> = { open: "Offen", working: "In Arbeit", waiting: "Wartet", done: "Erledigt" };

/**
 * Changes state, the person in charge and / or the note of a case. Only the fields that are
 * passed change; `assigneeId: null` takes the person off, "me" means the caller.
 */
export const updateEvidenceCase = createServerFn({ method: "POST" })
  .validator((input: { path: string; status?: CaseStatus; assigneeId?: string | null; note?: string }) => ({
    path: String(input.path ?? "").trim(),
    status: input.status && CASE_STATUSES.includes(input.status) ? input.status : undefined,
    assigneeId: input.assigneeId === undefined ? undefined : input.assigneeId === null ? null : String(input.assigneeId).trim() || null,
    note: input.note === undefined ? undefined : String(input.note).trim().slice(0, 500),
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    const me = await requirePermission(context.userId, "canUseEvidence");
    const idx = data.path.lastIndexOf("/");
    const folder = data.path.slice(0, idx);
    const name = data.path.slice(idx + 1);
    if (![`${EVIDENCE_ROOT}/Discord`, `${EVIDENCE_ROOT}/VRChat`].includes(folder)) throw new Error("Das ist keine Fallakte.");
    const sql = await getSql();
    const exists = await sql`
      select 1 from furr_file where scope = 'public' and owner_id is null and is_folder = true and folder = ${folder} and name = ${name}`;
    if (!exists.length) throw new Error("Fallakte nicht gefunden.");

    const assignee = data.assigneeId === "me" ? context.userId : data.assigneeId;
    if (assignee) {
      const known = await sql`select 1 from furr_profile where user_id = ${assignee}`;
      if (!known.length) throw new Error("Diese Person gibt es nicht.");
    }
    const before = await sql<{ status: string; assignee_id: string | null; note: string | null }>`
      select status, assignee_id, note from evidence_case_meta where case_path = ${data.path}`;
    const next = {
      status: data.status ?? (before[0]?.status as CaseStatus | undefined) ?? "open",
      assignee: assignee === undefined ? (before[0]?.assignee_id ?? null) : assignee,
      note: data.note === undefined ? (before[0]?.note ?? null) : data.note || null,
    };
    await sql`
      insert into evidence_case_meta (case_path, status, assignee_id, note, updated_by, updated_at)
      values (${data.path}, ${next.status}, ${next.assignee}, ${next.note}, ${context.userId}, now())
      on conflict (case_path) do update set
        status = excluded.status, assignee_id = excluded.assignee_id, note = excluded.note,
        updated_by = excluded.updated_by, updated_at = now()`;

    const changes: string[] = [];
    if (data.status && data.status !== (before[0]?.status ?? "open")) changes.push(`Status: ${CASE_STATUS_LABEL[data.status]}`);
    if (assignee !== undefined && assignee !== (before[0]?.assignee_id ?? null)) {
      changes.push(assignee ? (assignee === context.userId ? "übernommen" : "zugewiesen") : "Zuständigkeit entfernt");
    }
    if (data.note !== undefined && (data.note || null) !== (before[0]?.note ?? null)) changes.push("Notiz geändert");
    if (changes.length) {
      appendAuditLater({
        source: "furrbox",
        action: "case.update",
        actorId: context.userId,
        caseId: name,
        detail: `${me.displayName}: ${changes.join(", ")}`,
      });
    }
    return { ok: true as const };
  });

// ---------- Discord message inspection (answered by the bot through the bridge) ----------

export const requestMessageInspect = createServerFn({ method: "POST" })
  .validator((messageId: string) => String(messageId ?? "").trim())
  .middleware([accessMiddleware])
  .handler(async ({ context, data: messageId }) => {
    await requirePermission(context.userId, "canUseEvidence");
    if (!/^\d{17,22}$/.test(messageId)) throw new Error("Nachrichten-ID muss eine Discord-Snowflake sein.");
    const bot = await bridgeStatus();
    if (!bot.connected) throw new Error(BOT_JOB_STALE_MSG);
    const sql = await getSql();
    const id = newId();
    await sql`insert into message_inspect (id, message_id, requested_by) values (${id}, ${messageId}, ${context.userId})`;
    return { requestId: id };
  });

export const getMessageInspect = createServerFn({ method: "GET" })
  .validator((requestId: string) => String(requestId ?? ""))
  .middleware([accessMiddleware])
  .handler(async ({ context, data: requestId }) => {
    const sql = await getSql();
    const rows = await sql<{ status: string; result_json: string | null; created_at: unknown }>`
      select status, result_json, created_at from message_inspect where id = ${requestId} and requested_by = ${context.userId}`;
    const row = rows[0];
    if (!row) throw new Error("Anfrage nicht gefunden.");
    if (
      (row.status === "queued" || row.status === "dispatched") &&
      Date.now() - new Date(iso(row.created_at) ?? 0).getTime() > BOT_JOB_STALE_MS
    ) {
      await sql`update message_inspect set status = 'failed', completed_at = now() where id = ${requestId}`;
      return { status: "failed", result: { requestId, messageId: "", found: false, content: "", error: BOT_JOB_STALE_MSG } as MessageProof };
    }
    let result: MessageProof | null = null;
    if (row.result_json) {
      try {
        result = JSON.parse(row.result_json) as MessageProof;
      } catch {
        result = null;
      }
    }
    return { status: row.status, result };
  });

// ---------- Moderation (ban / warn / timeout / mute), executed by the Discord bot ----------

export const queueModeration = createServerFn({ method: "POST" })
  .validator((input: { action: ModerationAction; targetDiscordId: string; reason: string; durationMs?: number; caseId?: string }) => ({
    action: String(input.action ?? "").toLowerCase() as ModerationAction,
    targetDiscordId: String(input.targetDiscordId ?? "").trim(),
    reason: String(input.reason ?? "").trim(),
    durationMs: input.durationMs === undefined ? undefined : Number(input.durationMs),
    caseId: input.caseId ? String(input.caseId).trim().slice(0, 80) : null,
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    const me = await loadMe(context.userId);
    if (!MODERATION_ACTIONS.includes(data.action)) throw new Error("Unbekannte Moderationsaktion.");
    if (!me.permissions.moderationActions.includes(data.action)) {
      throw new Error(me.permissions.isTeam ? "Supporter dürfen nur Warn und Timeout ausführen." : "Keine Moderationsrechte.");
    }
    if (!me.discordId) throw new Error("Hinterlege zuerst deine Discord-ID (Kontoverwaltung), damit der Bot dich zuordnen kann.");
    if (!/^\d{17,22}$/.test(data.targetDiscordId)) throw new Error("Ziel muss eine Discord-Snowflake sein.");
    if (data.reason.length < 3 || data.reason.length > 512) throw new Error("Begründung muss 3-512 Zeichen lang sein.");
    if (data.action === "ban") {
      if (!data.caseId) throw new Error("Bann braucht eine Fall-ID (caseId).");
      if (data.reason.length < 5) throw new Error("Bann-Begründung mindestens 5 Zeichen.");
    }
    const needsDuration = data.action === "timeout" || data.action === "mute";
    if (needsDuration && (!data.durationMs || data.durationMs < 60_000 || data.durationMs > 2_419_200_000)) {
      throw new Error("Dauer muss zwischen 1 Minute und 28 Tagen liegen.");
    }
    const bot = await bridgeStatus();
    if (!bot.connected) throw new Error(BOT_JOB_STALE_MSG);
    const sql = await getSql();
    const id = newId();
    await sql`
      insert into moderation_request (id, action, moderator_user_id, moderator_discord_id, target_discord_id, reason, duration_ms)
      values (${id}, ${data.action}, ${context.userId}, ${me.discordId}, ${data.targetDiscordId}, ${data.reason},
              ${needsDuration ? Math.trunc(data.durationMs!) : null})`;

    // Persistente Sanktion für Mute/Timeout/Ban (Bot-Reconcile).
    if (data.action === "mute" || data.action === "timeout" || data.action === "ban") {
      const expiresAt =
        needsDuration && data.durationMs ? new Date(Date.now() + data.durationMs).toISOString() : null;
      await upsertSanctionFromBot({
        platform: "discord",
        targetId: data.targetDiscordId,
        type: data.action,
        reason: data.reason,
        caseId: data.caseId,
        expiresAt,
        createdBy: context.userId,
      });
    }

    let undoToken: string | null = null;
    let undoExpiresAt: string | null = null;
    if (data.action === "ban") {
      undoToken = newId();
      undoExpiresAt = new Date(Date.now() + 10_000).toISOString();
      await sql`
        insert into ban_undo (token, platform, target_id, reason, case_id, moderator_id, job_or_req, expires_at)
        values (${undoToken}, 'discord', ${data.targetDiscordId}, ${data.reason}, ${data.caseId}, ${context.userId}, ${id}, ${undoExpiresAt})`;
      publishAlertLater({
        kind: "ban.applied",
        severity: "critical",
        title: "Discord-Bann (Undo 10 s)",
        body: `${data.targetDiscordId} – ${data.reason}`,
        dedupKey: `ban:dc:${id}`,
        payload: { undoToken, requestId: id, caseId: data.caseId },
      });
      appendAuditLater({
        source: "furrbox",
        action: "discord.ban",
        actorId: context.userId,
        actorName: me.displayName,
        targetId: data.targetDiscordId,
        caseId: data.caseId,
        detail: data.reason,
      });
    }
    return { requestId: id, undoToken, undoExpiresAt };
  });

/** 10 s Undo für Discord-Bann: queued Unban. */
export const undoDiscordBan = createServerFn({ method: "POST" })
  .validator((token: string) => String(token ?? "").trim())
  .middleware([accessMiddleware])
  .handler(async ({ context, data: token }) => {
    const me = await loadMe(context.userId);
    if (!me.permissions.moderationActions.includes("ban")) throw new Error("Keine Bann-Rechte.");
    if (!me.discordId) throw new Error("Discord-ID fehlt.");
    const sql = await getSql();
    const rows = await sql<{
      token: string;
      target_id: string;
      reason: string;
      case_id: string;
      moderator_id: string;
      expires_at: unknown;
      used_at: unknown;
    }>`select * from ban_undo where token = ${token} and platform = 'discord'`;
    const row = rows[0];
    if (!row) throw new Error("Undo-Token unbekannt.");
    if (row.used_at) throw new Error("Undo schon benutzt.");
    if (new Date(String(row.expires_at)).getTime() < Date.now()) throw new Error("Undo-Fenster (10 s) abgelaufen.");
    if (row.moderator_id !== context.userId) throw new Error("Nur der ausstellende Moderator darf undoen.");
    await sql`update ban_undo set used_at = now() where token = ${token}`;
    const bot = await bridgeStatus();
    if (!bot.connected) throw new Error(BOT_JOB_STALE_MSG);
    const id = newId();
    await sql`
      insert into moderation_request (id, action, moderator_user_id, moderator_discord_id, target_discord_id, reason, duration_ms)
      values (${id}, 'unban', ${context.userId}, ${me.discordId}, ${row.target_id}, ${"Undo: " + row.reason}, null)`;
    publishAlertLater({
      kind: "ban.undo",
      severity: "warn",
      title: "Discord-Bann rückgängig",
      body: row.target_id,
      dedupKey: `banundo:${token}`,
      payload: { token, requestId: id, caseId: row.case_id },
    });
    appendAuditLater({
      source: "furrbox",
      action: "discord.ban.undo",
      actorId: context.userId,
      targetId: row.target_id,
      caseId: row.case_id,
    });
    return { ok: true as const, requestId: id };
  });

export const listModeration = createServerFn({ method: "GET" })
  .middleware([accessMiddleware])
  .handler(async ({ context }): Promise<ModerationEntry[]> => {
    await requirePermission(context.userId, "canUseEvidence");
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      action: string;
      target_discord_id: string;
      target_name: string | null;
      moderator_name: string | null;
      reason: string;
      duration_ms: number | null;
      status: ModerationEntry["status"];
      error: string | null;
      created_at: unknown;
      completed_at: unknown;
    }>`
      select m.id, m.action, m.target_discord_id, coalesce(dm.nickname, dm.display_name) as target_name,
             p.display_name as moderator_name, m.reason, m.duration_ms, m.status, m.error, m.created_at, m.completed_at
      from moderation_request m
      left join discord_member dm on dm.discord_id = m.target_discord_id
      left join furr_profile p on p.user_id = m.moderator_user_id
      order by m.created_at desc limit 50`;
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      targetDiscordId: r.target_discord_id,
      targetName: r.target_name ?? r.target_discord_id,
      moderatorName: r.moderator_name ?? "Unbekannt",
      reason: r.reason,
      durationMs: r.duration_ms === null ? null : Number(r.duration_ms),
      status: r.status,
      error: r.error,
      createdAt: iso(r.created_at) ?? "",
      completedAt: iso(r.completed_at),
    }));
  });
