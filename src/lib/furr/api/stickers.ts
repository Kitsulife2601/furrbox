// FurrChat: stickers the team makes itself. Everyone with access can use them; the creator (and
// Owner / Dev) can delete them.
import { createServerFn } from "@tanstack/react-start";
import { accessMiddleware } from "../access";
import { getSql, iso, loadMe, newId } from "../core";

export type CustomSticker = { id: string; name: string; createdBy: string; mine: boolean; createdAt: string };

const MAX_STICKER_BYTES = 1024 * 1024;
const STICKER_TYPES = ["image/png", "image/gif", "image/webp", "image/jpeg"];
const MAX_STICKERS = 200;

export const listCustomStickers = createServerFn({ method: "GET" })
  .middleware([accessMiddleware])
  .handler(async ({ context }): Promise<CustomSticker[]> => {
    const sql = await getSql();
    const rows = await sql<{ id: string; name: string; created_by: string; creator: string | null; created_at: unknown }>`
      select s.id, s.name, s.created_by, p.display_name as creator, s.created_at
      from chat_sticker s left join furr_profile p on p.user_id = s.created_by
      order by s.created_at desc`;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdBy: r.creator ?? "Unbekannt",
      mine: r.created_by === context.userId,
      createdAt: iso(r.created_at) ?? "",
    }));
  });

/** The picture of one sticker (loaded separately and cached – they rarely change). */
export const readCustomSticker = createServerFn({ method: "GET" })
  .validator((id: string) => String(id ?? ""))
  .middleware([accessMiddleware])
  .handler(async ({ data: id }) => {
    const sql = await getSql();
    const rows = await sql<{ mime_type: string; content_b64: string }>`
      select mime_type, content_b64 from chat_sticker where id = ${id}`;
    const row = rows[0];
    if (!row) throw new Error("Sticker wurde gelöscht.");
    return { mimeType: row.mime_type, base64: row.content_b64 };
  });

export const createCustomSticker = createServerFn({ method: "POST" })
  .validator((input: { name: string; mimeType: string; base64: string }) => {
    const base64 = String(input.base64 ?? "");
    const mimeType = String(input.mimeType ?? "");
    if (!STICKER_TYPES.includes(mimeType)) throw new Error("Bitte ein Bild nehmen (PNG, GIF, WebP oder JPG).");
    if (Math.floor((base64.length * 3) / 4) > MAX_STICKER_BYTES) throw new Error("Das Bild ist zu groß (max. 1 MB).");
    const name = String(input.name ?? "").trim().slice(0, 40);
    if (!name) throw new Error("Bitte gib dem Sticker einen Namen.");
    return { name, mimeType, base64 };
  })
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const [{ count }] = await sql<{ count: number }>`select count(*)::int as count from chat_sticker`;
    if (count >= MAX_STICKERS) throw new Error("Es gibt schon sehr viele Sticker – lösche zuerst ein paar alte.");
    const id = newId();
    await sql`
      insert into chat_sticker (id, name, mime_type, content_b64, created_by)
      values (${id}, ${data.name}, ${data.mimeType}, ${data.base64}, ${context.userId})`;
    return { id };
  });

export const deleteCustomSticker = createServerFn({ method: "POST" })
  .validator((id: string) => String(id ?? ""))
  .middleware([accessMiddleware])
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    const rows = await sql<{ created_by: string }>`select created_by from chat_sticker where id = ${id}`;
    if (!rows[0]) return { ok: true };
    if (rows[0].created_by !== context.userId) {
      const me = await loadMe(context.userId);
      if (!me.permissions.canManageWhitelist) throw new Error("Nur wer den Sticker gemacht hat (oder Owner/Dev) kann ihn löschen.");
    }
    await sql`delete from chat_sticker where id = ${id}`;
    return { ok: true };
  });
