// Big evidence files stored on the Discord bot's PC (no size limit). Vercel only accepts small
// requests, so files travel in pieces of BOT_CHUNK_BYTES through the bot_file_chunk table; the
// bot picks them up (or delivers them) via /api/bridge/file-*. Only a few pieces sit in the
// database at any time.
import { createServerFn } from "@tanstack/react-start";
import { accessMiddleware } from "../access";
import { bridgeStatus, getSql } from "../core";

/** Pieces waiting for the bot before the uploader pauses. */
const MAX_PENDING_UP = 8;

type Row = { id: string; created_by: string | null; scope: string; owner_id: string | null; on_bot: boolean; bot_state: string | null };

async function visibleFile(userId: string, fileId: string) {
  const sql = await getSql();
  const rows = await sql<Row>`
    select id, created_by, scope, owner_id, on_bot, bot_state from furr_file
    where id = ${fileId} and (owner_id = ${userId} or (scope = 'public' and owner_id is null))`;
  const row = rows[0];
  if (!row || !row.on_bot) throw new Error("Datei nicht gefunden.");
  return row;
}

/** One piece of an upload. `wait: true` = the bot is behind, try the same piece again shortly. */
export const uploadBotChunk = createServerFn({ method: "POST" })
  .validator((input: { fileId: string; idx: number; base64: string }) => ({
    fileId: String(input.fileId ?? ""),
    idx: Math.max(0, Math.trunc(Number(input.idx) || 0)),
    base64: String(input.base64 ?? ""),
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    const file = await visibleFile(context.userId, data.fileId);
    if (file.created_by !== context.userId || file.bot_state !== "uploading") throw new Error("Upload ist nicht mehr aktiv.");
    const sql = await getSql();
    const [{ n }] = await sql<{ n: number }>`
      select count(*)::int as n from bot_file_chunk where file_id = ${data.fileId} and direction = 'up'`;
    if (n >= MAX_PENDING_UP) {
      const bot = await bridgeStatus();
      if (!bot.connected) throw new Error("Der Discord-Bot ist offline – große Dateien gehen nur, wenn er läuft.");
      return { wait: true };
    }
    await sql`
      insert into bot_file_chunk (file_id, direction, idx, data_b64) values (${data.fileId}, 'up', ${data.idx}, ${data.base64})
      on conflict (file_id, direction, idx) do nothing`;
    return { wait: false };
  });

export const finishBotUpload = createServerFn({ method: "POST" })
  .validator((input: { fileId: string; chunks: number }) => ({
    fileId: String(input.fileId ?? ""),
    chunks: Math.max(0, Math.trunc(Number(input.chunks) || 0)),
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    const file = await visibleFile(context.userId, data.fileId);
    if (file.created_by !== context.userId) throw new Error("Nicht erlaubt.");
    const sql = await getSql();
    await sql`update furr_file set bot_chunks = ${data.chunks} where id = ${data.fileId} and bot_state = 'uploading'`;
    return { ok: true };
  });

export type BotFileStatus = {
  state: "uploading" | "stored" | "failed";
  error: string | null;
  /** Download: null = not requested yet. */
  download: { status: "queued" | "sending" | "done" | "failed"; totalChunks: number | null; error: string | null } | null;
};

export const getBotFileStatus = createServerFn({ method: "GET" })
  .validator((fileId: string) => String(fileId ?? ""))
  .middleware([accessMiddleware])
  .handler(async ({ context, data: fileId }): Promise<BotFileStatus> => {
    await visibleFile(context.userId, fileId);
    const sql = await getSql();
    const [f] = await sql<{ bot_state: string | null; bot_error: string | null }>`
      select bot_state, bot_error from furr_file where id = ${fileId}`;
    const [r] = await sql<{ status: string; total_chunks: number | null; error: string | null }>`
      select status, total_chunks, error from bot_file_request where file_id = ${fileId}`;
    return {
      state: (f?.bot_state ?? "failed") as BotFileStatus["state"],
      error: f?.bot_error ?? null,
      download: r ? { status: r.status as "queued", totalChunks: r.total_chunks, error: r.error } : null,
    };
  });

/** Asks the bot to send a stored file (the viewer then reads the pieces with readBotChunk). */
export const requestBotFile = createServerFn({ method: "POST" })
  .validator((fileId: string) => String(fileId ?? ""))
  .middleware([accessMiddleware])
  .handler(async ({ context, data: fileId }) => {
    const file = await visibleFile(context.userId, fileId);
    if (file.bot_state !== "stored") throw new Error("Die Datei ist noch nicht beim Bot angekommen.");
    const bot = await bridgeStatus();
    if (!bot.connected) throw new Error("Der Discord-Bot ist offline – die Datei liegt auf seinem PC.");
    const sql = await getSql();
    await sql`delete from bot_file_chunk where file_id = ${fileId} and direction = 'down'`;
    await sql`
      insert into bot_file_request (file_id, status, total_chunks, error, requested_at) values (${fileId}, 'queued', null, null, now())
      on conflict (file_id) do update set status = 'queued', total_chunks = null, error = null, requested_at = now()`;
    return { ok: true };
  });

/** Takes one downloaded piece (it is removed from the database right away). null = not there yet. */
export const readBotChunk = createServerFn({ method: "POST" })
  .validator((input: { fileId: string; idx: number }) => ({
    fileId: String(input.fileId ?? ""),
    idx: Math.max(0, Math.trunc(Number(input.idx) || 0)),
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    await visibleFile(context.userId, data.fileId);
    const sql = await getSql();
    const rows = await sql<{ data_b64: string }>`
      delete from bot_file_chunk where file_id = ${data.fileId} and direction = 'down' and idx = ${data.idx}
      returning data_b64`;
    return { base64: rows[0]?.data_b64 ?? null };
  });
