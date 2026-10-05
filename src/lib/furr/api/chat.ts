// FurrChat: team channel + private messages with auto-deletion (retention days).
import { createServerFn } from "@tanstack/react-start";
import { accessMiddleware } from "../access";
import { getSetting, getSql, iso, loadMe, newId, requirePermission, setSetting } from "../core";
import { runSideEffect, safeJsonParse } from "../http";
import { EVIDENCE_ROOT, MAX_UPLOAD_BYTES, sanitizeName } from "../paths";
import { ROLE_LABEL, effectiveRole } from "../roles";
import type { ChatAttachment, ChatChannel, ChatKind, ChatMessage } from "../types";
import { STICKER_IDS } from "../stickers";

/** Purge höchstens alle 60s – verhindert DB-Last bei Polling. */
const PURGE_MIN_INTERVAL_MS = 60_000;
let lastPurgeAt = 0;

async function retentionDays() {
  const parsed = Number(await getSetting("chat_retention_days", "7"));
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), 365) : 7;
}

async function purgeExpired() {
  const days = await retentionDays();
  const sql = await getSql();
  await sql.query(`delete from chat_message where created_at < now() - ($1::int * interval '1 day')`, [days]);
  await sql`delete from chat_attachment a where not exists (select 1 from chat_message m where m.id = a.message_id)`;
}

/**
 * Abgelaufene Nachrichten im Hintergrund aufräumen.
 * Nie den Request blockieren (Client-Animationen / Chat-UI warten nicht).
 */
function schedulePurge(force = false) {
  void runSideEffect(async () => {
    if (!force && Date.now() - lastPurgeAt < PURGE_MIN_INTERVAL_MS) return;
    lastPurgeAt = Date.now();
    await purgeExpired();
  }, force ? "chat-purge-settings" : "chat-purge");
}

type Row = {
  id: string;
  channel: ChatChannel;
  sender_id: string;
  sender_name: string | null;
  sender_role: string | null;
  sender_priv: string | null;
  recipient_id: string | null;
  recipient_name: string | null;
  content: string;
  created_at: unknown;
  kind: string | null;
  attachment_json: string | null;
};

const SELECT = `
  select cm.id, cm.channel, cm.sender_id, sp.display_name as sender_name, sp.role as sender_role,
         dm.highest_privilege as sender_priv, cm.recipient_id, rp.display_name as recipient_name,
         cm.content, cm.created_at, cm.kind, cm.attachment_json
  from chat_message cm
  left join furr_profile sp on sp.user_id = cm.sender_id
  left join discord_member dm on dm.discord_id = sp.discord_id
  left join furr_profile rp on rp.user_id = cm.recipient_id`;

function toDto(r: Row): ChatMessage {
  return {
    id: r.id,
    channel: r.channel,
    senderId: r.sender_id,
    senderName: r.sender_name ?? "Gelöschter Nutzer",
    senderRoleLabel: ROLE_LABEL[effectiveRole(r.sender_role, r.sender_priv)],
    recipientId: r.recipient_id,
    recipientName: r.recipient_name,
    content: r.content,
    createdAt: iso(r.created_at) ?? new Date().toISOString(),
    kind: (r.kind ?? "text") as ChatKind,
    attachment: safeJsonParse<ChatAttachment | null>(r.attachment_json, null),
  };
}

export const listChatMessages = createServerFn({ method: "GET" })
  .validator((input: { channel: ChatChannel; partnerId?: string }) => ({
    channel: (input.channel === "private" ? "private" : "team") as ChatChannel,
    partnerId: String(input.partnerId ?? ""),
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }): Promise<ChatMessage[]> => {
    schedulePurge();
    if (data.channel === "private" && !data.partnerId) return [];
    const sql = await getSql();
    const rows =
      data.channel === "team"
        ? await sql.query<Row>(`${SELECT} where cm.channel = 'team' order by cm.created_at desc limit 250`)
        : await sql.query<Row>(
            `${SELECT} where cm.channel = 'private'
             and ((cm.sender_id = $1 and cm.recipient_id = $2) or (cm.sender_id = $2 and cm.recipient_id = $1))
             order by cm.created_at desc limit 250`,
            [context.userId, data.partnerId],
          );
    return rows.reverse().map(toDto);
  });

/** Newest messages addressed to me (team or private) — drives the taskbar unread badge/toasts. */
export const latestIncoming = createServerFn({ method: "GET" })
  .middleware([accessMiddleware])
  .handler(async ({ context }): Promise<ChatMessage[]> => {
    const sql = await getSql();
    const rows = await sql.query<Row>(
      `${SELECT} where cm.sender_id <> $1 and (cm.channel = 'team' or cm.recipient_id = $1)
       order by cm.created_at desc limit 10`,
      [context.userId],
    );
    return rows.map(toDto);
  });

type SendInput = {
  channel: ChatChannel;
  content?: string;
  recipientId?: string;
  stickerId?: string;
  casePath?: string;
  file?: { name: string; mimeType: string; base64: string };
};

export const sendChatMessage = createServerFn({ method: "POST" })
  .validator((input: SendInput) => {
    const file = input.file
      ? {
          name: sanitizeName(String(input.file.name ?? "")) || "Datei",
          mimeType: String(input.file.mimeType || "application/octet-stream").slice(0, 120),
          base64: String(input.file.base64 ?? ""),
        }
      : null;
    if (file && Math.floor((file.base64.length * 3) / 4) > MAX_UPLOAD_BYTES) throw new Error("Datei ist zu groß (max. 3 MB).");
    return {
      channel: (input.channel === "private" ? "private" : "team") as ChatChannel,
      content: String(input.content ?? "").trim(),
      recipientId: String(input.recipientId ?? "").trim(),
      stickerId: String(input.stickerId ?? "").trim(),
      casePath: String(input.casePath ?? "").trim(),
      file,
    };
  })
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    if (data.content.length > 2000) throw new Error("Nachricht ist zu lang.");
    const sql = await getSql();
    let recipientId: string | null = null;
    if (data.channel === "private") {
      const rows = await sql`select user_id from furr_profile where user_id = ${data.recipientId}`;
      if (!rows.length || data.recipientId === context.userId) throw new Error("Ungültiger Empfänger.");
      recipientId = data.recipientId;
    }

    const id = newId();
    let kind: ChatKind = "text";
    let attachment: ChatAttachment | null = null;
    let content = data.content;
    if (data.stickerId) {
      const custom = /^custom:(.+)$/.exec(data.stickerId)?.[1];
      const known = custom
        ? (await sql`select 1 from chat_sticker where id = ${custom}`).length > 0
        : STICKER_IDS.has(data.stickerId);
      if (!known) throw new Error("Unbekannter Sticker.");
      kind = "sticker";
      attachment = { type: "sticker", stickerId: data.stickerId };
      content = "Sticker";
    } else if (data.casePath) {
      const me = await loadMe(context.userId);
      if (!me.permissions.canUseEvidence) throw new Error("Für Fallakten fehlt dir die Berechtigung.");
      const idx = data.casePath.lastIndexOf("/");
      const folder = data.casePath.slice(0, idx);
      const name = data.casePath.slice(idx + 1);
      if (!folder.startsWith(`${EVIDENCE_ROOT}/`)) throw new Error("Das ist keine Fallakte.");
      const rows = await sql`
        select 1 from furr_file where scope = 'public' and owner_id is null and is_folder = true and folder = ${folder} and name = ${name}`;
      if (!rows.length) throw new Error("Fallakte nicht gefunden.");
      kind = "case";
      attachment = { type: "case", path: data.casePath, caseId: name, platform: folder.split("/").pop() ?? "" };
      content = content || `Fallakte: ${name}`;
    } else if (data.file) {
      const fileId = newId();
      const size = Math.floor((data.file.base64.length * 3) / 4);
      await sql`
        insert into chat_attachment (id, message_id, name, mime_type, size, content_b64)
        values (${fileId}, ${id}, ${data.file.name}, ${data.file.mimeType}, ${size}, ${data.file.base64})`;
      kind = "file";
      attachment = { type: "file", id: fileId, name: data.file.name, mimeType: data.file.mimeType, size };
      content = content || `Datei: ${data.file.name}`;
    }
    if (!content) throw new Error("Nachricht ist leer.");

    // Kritischer Pfad: Insert zuerst – Purge danach im Hintergrund.
    await sql`
      insert into chat_message (id, channel, sender_id, recipient_id, content, kind, attachment_json)
      values (${id}, ${data.channel}, ${context.userId}, ${recipientId}, ${content}, ${kind}, ${attachment ? JSON.stringify(attachment) : null})`;
    schedulePurge();
    return { id };
  });

/** A file sent in the chat – only for the team channel or the two people of a private chat. */
export const readChatAttachment = createServerFn({ method: "GET" })
  .validator((id: string) => String(id ?? ""))
  .middleware([accessMiddleware])
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    const rows = await sql<{ name: string; mime_type: string; content_b64: string }>`
      select a.name, a.mime_type, a.content_b64 from chat_attachment a
      join chat_message m on m.id = a.message_id
      where a.id = ${id} and (m.channel = 'team' or m.sender_id = ${context.userId} or m.recipient_id = ${context.userId})`;
    const row = rows[0];
    if (!row) throw new Error("Datei nicht gefunden (vielleicht schon automatisch gelöscht).");
    return { name: row.name, mimeType: row.mime_type, base64: row.content_b64 };
  });

export const getChatSettings = createServerFn({ method: "GET" })
  .middleware([accessMiddleware])
  .handler(async () => ({ retentionDays: await retentionDays() }));

export const updateChatSettings = createServerFn({ method: "POST" })
  .validator((retentionDays: number) => Math.min(Math.max(Math.trunc(Number(retentionDays) || 7), 1), 365))
  .middleware([accessMiddleware])
  .handler(async ({ context, data: days }) => {
    await requirePermission(context.userId, "canConfigureChat");
    await setSetting("chat_retention_days", String(days));
    schedulePurge(true);
    return { retentionDays: days };
  });
