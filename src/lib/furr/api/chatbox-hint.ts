// Staff-Chatbox-Hinweis: kurzlebig → Bridge-Job + Overlay-Broadcast.
import { createServerFn } from "@tanstack/react-start";
import { accessMiddleware } from "../access";
import { appendAuditLater } from "../audit";
import { publishAlertLater } from "../alerts";
import { getSetting, getSql, iso, newId, requirePermission } from "../core";

export type ChatboxHintDto = {
  id: string;
  text: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
};

export const postChatboxHint = createServerFn({ method: "POST" })
  .validator((input: { text: string }) => ({ text: String(input.text ?? "").trim() }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    const me = await requirePermission(context.userId, "canUseEvidence");
    const maxLen = Math.max(20, Math.min(140, Number(await getSetting("chatbox_hint_max_len", "80")) || 80));
    const ttlSec = Math.max(10, Math.min(180, Number(await getSetting("chatbox_hint_ttl_sec", "45")) || 45));
    if (!data.text) throw new Error("Hinweis darf nicht leer sein.");
    if (data.text.length > maxLen) throw new Error(`Maximal ${maxLen} Zeichen.`);
    const sql = await getSql();
    // Rate: max. 1 aktiver Hinweis pro Staff alle 15 s.
    const recent = await sql<{ id: string }>`
      select id from chatbox_hint
      where created_by = ${context.userId} and created_at > now() - interval '15 seconds' limit 1`;
    if (recent.length) throw new Error("Bitte kurz warten, bevor du den nächsten Hinweis sendest.");

    const id = newId();
    await sql`
      insert into chatbox_hint (id, text, created_by, expires_at)
      values (${id}, ${data.text}, ${context.userId}, now() + (${ttlSec}::int * interval '1 second'))`;

    // Overlay / Desktop / VR via Alert-Bus; Bot bekommt zusätzlich Bridge-Job show-chatbox.
    publishAlertLater({
      kind: "chatbox.hint",
      severity: "info",
      title: "Chatbox-Hinweis",
      body: data.text,
      dedupKey: `hint:${id}`,
      channels: ["bot", "desktop", "vr"],
      payload: { hintId: id, text: data.text, ttlSec },
      ttlMinutes: Math.ceil(ttlSec / 60) + 1,
    });
    appendAuditLater({
      source: "furrbox",
      action: "chatbox.hint",
      actorId: context.userId,
      actorName: me.displayName,
      detail: data.text,
    });
    return { id, expiresInSec: ttlSec };
  });

export const listActiveChatboxHints = createServerFn({ method: "GET" })
  .middleware([accessMiddleware])
  .handler(async ({ context }): Promise<ChatboxHintDto[]> => {
    await requirePermission(context.userId, "canUseEvidence");
    const sql = await getSql();
    const rows = await sql<{ id: string; text: string; created_by: string; created_at: unknown; expires_at: unknown }>`
      select id, text, created_by, created_at, expires_at from chatbox_hint
      where expires_at > now() order by created_at desc limit 10`;
    return rows.map((r) => ({
      id: r.id,
      text: r.text,
      createdBy: r.created_by,
      createdAt: iso(r.created_at) ?? "",
      expiresAt: iso(r.expires_at) ?? "",
    }));
  });

/** Für Bridge-Queue: offene Hints als VRChat-Jobs „show-chatbox“. */
export async function takeChatboxHintsForBridge(limit = 5) {
  const sql = await getSql();
  const rows = await sql<{ id: string; text: string; expires_at: unknown }>`
    update chatbox_hint set delivered = true
    where id in (
      select id from chatbox_hint
      where not delivered and expires_at > now()
      order by created_at limit ${limit}
    )
    returning id, text, expires_at`;
  return rows.map((r) => ({
    hintId: r.id,
    text: r.text,
    expiresAt: iso(r.expires_at),
  }));
}
