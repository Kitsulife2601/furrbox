// FurrChat: team channel + private messages with auto-deletion (retention days).
import { createServerFn } from "@tanstack/react-start";
import { accessMiddleware } from "../access";
import { getSetting, getSql, iso, newId, requirePermission, setSetting } from "../core";
import { ROLE_LABEL, effectiveRole } from "../roles";
import type { ChatChannel, ChatMessage } from "../types";

async function retentionDays() {
  const parsed = Number(await getSetting("chat_retention_days", "7"));
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), 365) : 7;
}

async function purgeExpired() {
  const days = await retentionDays();
  const sql = await getSql();
  await sql.query(`delete from chat_message where created_at < now() - ($1::int * interval '1 day')`, [days]);
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
};

const SELECT = `
  select cm.id, cm.channel, cm.sender_id, sp.display_name as sender_name, sp.role as sender_role,
         dm.highest_privilege as sender_priv, cm.recipient_id, rp.display_name as recipient_name,
         cm.content, cm.created_at
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
  };
}

export const listChatMessages = createServerFn({ method: "GET" })
  .validator((input: { channel: ChatChannel; partnerId?: string }) => ({
    channel: (input.channel === "private" ? "private" : "team") as ChatChannel,
    partnerId: String(input.partnerId ?? ""),
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }): Promise<ChatMessage[]> => {
    await purgeExpired();
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

export const sendChatMessage = createServerFn({ method: "POST" })
  .validator((input: { channel: ChatChannel; content: string; recipientId?: string }) => ({
    channel: (input.channel === "private" ? "private" : "team") as ChatChannel,
    content: String(input.content ?? "").trim(),
    recipientId: String(input.recipientId ?? "").trim(),
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    if (!data.content) throw new Error("Nachricht ist leer.");
    if (data.content.length > 2000) throw new Error("Nachricht ist zu lang.");
    const sql = await getSql();
    let recipientId: string | null = null;
    if (data.channel === "private") {
      const rows = await sql`select user_id from furr_profile where user_id = ${data.recipientId}`;
      if (!rows.length || data.recipientId === context.userId) throw new Error("Ungültiger Empfänger.");
      recipientId = data.recipientId;
    }
    await purgeExpired();
    const id = newId();
    await sql`
      insert into chat_message (id, channel, sender_id, recipient_id, content)
      values (${id}, ${data.channel}, ${context.userId}, ${recipientId}, ${data.content})`;
    return { id };
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
    await purgeExpired();
    return { retentionDays: days };
  });
