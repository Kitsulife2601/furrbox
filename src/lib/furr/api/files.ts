// FurrFS: private home per user + shared public ("Shared Network") storage.
import { createServerFn } from "@tanstack/react-start";
import { accessMiddleware } from "../access";
import {
  FILE_COLUMNS,
  base64ToText,
  ensureFolderPath,
  getSql,
  ownerFor,
  textToBase64,
  toFileDto,
  writeFile,
  type FileRow,
} from "../core";
import { MAX_UPLOAD_BYTES, joinPath, normalizePath, sanitizeName } from "../paths";
import type { FurrFile, Scope } from "../types";

function asScope(value: unknown): Scope {
  return value === "public" ? "public" : "private";
}

function ownerClause(scope: Scope) {
  return scope === "private" ? "owner_id = $2" : "owner_id is null and $2::text is not null";
}

/** Lists one folder (or, with `recursive`, everything below it). */
export const listFiles = createServerFn({ method: "GET" })
  .validator((input: { scope: Scope; folder?: string; recursive?: boolean }) => ({
    scope: asScope(input.scope),
    folder: normalizePath(String(input.folder ?? "")),
    recursive: Boolean(input.recursive),
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }): Promise<FurrFile[]> => {
    const sql = await getSql();
    const rows = data.recursive
      ? await sql.query<FileRow>(
          `select ${FILE_COLUMNS} from furr_file where scope = $1 and ${ownerClause(data.scope)}
           and ($3 = '' or folder = $3 or folder like $3 || '/%')
           order by is_folder desc, lower(name) limit 2000`,
          [data.scope, context.userId, data.folder],
        )
      : await sql.query<FileRow>(
          `select ${FILE_COLUMNS} from furr_file where scope = $1 and ${ownerClause(data.scope)} and folder = $3
           order by is_folder desc, lower(name)`,
          [data.scope, context.userId, data.folder],
        );
    return rows.map(toFileDto);
  });

/** Name search across both scopes (taskbar Deep Search). */
export const searchFiles = createServerFn({ method: "GET" })
  .validator((query: string) => String(query ?? "").trim().slice(0, 80))
  .middleware([accessMiddleware])
  .handler(async ({ context, data: query }): Promise<FurrFile[]> => {
    if (!query) return [];
    const sql = await getSql();
    const rows = await sql.query<FileRow>(
      `select ${FILE_COLUMNS} from furr_file
       where (owner_id = $1 or (scope = 'public' and owner_id is null)) and lower(name) like '%' || lower($2) || '%'
       order by updated_at desc limit 25`,
      [context.userId, query],
    );
    return rows.map(toFileDto);
  });

export const recentFiles = createServerFn({ method: "GET" })
  .middleware([accessMiddleware])
  .handler(async ({ context }): Promise<FurrFile[]> => {
    const sql = await getSql();
    const rows = await sql.query<FileRow>(
      `select ${FILE_COLUMNS} from furr_file
       where is_folder = false and (owner_id = $1 or (scope = 'public' and owner_id is null))
       order by updated_at desc limit 8`,
      [context.userId],
    );
    return rows.map(toFileDto);
  });

export const createFolder = createServerFn({ method: "POST" })
  .validator((input: { scope: Scope; folder: string; name: string }) => ({
    scope: asScope(input.scope),
    folder: normalizePath(String(input.folder ?? "")),
    name: sanitizeName(String(input.name ?? "")) || "Neuer Ordner",
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    await ensureFolderPath(data.scope, ownerFor(data.scope, context.userId), joinPath(data.folder, data.name), context.userId);
    return { path: joinPath(data.folder, data.name) };
  });

export const uploadFile = createServerFn({ method: "POST" })
  .validator((input: { scope: Scope; folder: string; name: string; mimeType: string; base64: string }) => {
    const base64 = String(input.base64 ?? "");
    const size = Math.floor((base64.length * 3) / 4);
    if (size > MAX_UPLOAD_BYTES) throw new Error("Datei ist zu groß (max. 3 MB).");
    return {
      scope: asScope(input.scope),
      folder: normalizePath(String(input.folder ?? "")),
      name: sanitizeName(String(input.name ?? "")) || "Datei",
      mimeType: String(input.mimeType || "application/octet-stream").slice(0, 120),
      base64,
      size,
    };
  })
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) =>
    writeFile({ ...data, ownerId: ownerFor(data.scope, context.userId), createdBy: context.userId }),
  );

export const saveTextFile = createServerFn({ method: "POST" })
  .validator((input: { scope: Scope; folder: string; name: string; content: string }) => {
    let name = sanitizeName(String(input.name ?? "")) || "Neues Textdokument";
    if (!/\.[a-z0-9]{1,5}$/i.test(name)) name = `${name}.txt`;
    const content = String(input.content ?? "");
    if (content.length > 1_000_000) throw new Error("Textdokument ist zu groß.");
    return { scope: asScope(input.scope), folder: normalizePath(String(input.folder ?? "")), name, content };
  })
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) =>
    writeFile({
      scope: data.scope,
      ownerId: ownerFor(data.scope, context.userId),
      folder: data.folder,
      name: data.name,
      mimeType: "text/plain",
      base64: textToBase64(data.content),
      size: Buffer.byteLength(data.content, "utf8"),
      createdBy: context.userId,
    }),
  );

async function findVisible(userId: string, id: string) {
  const sql = await getSql();
  const rows = await sql.query<FileRow & { content_b64: string | null }>(
    `select ${FILE_COLUMNS}, content_b64 from furr_file
     where id = $1 and (owner_id = $2 or (scope = 'public' and owner_id is null))`,
    [id, userId],
  );
  return rows[0] ?? null;
}

export const readFile = createServerFn({ method: "GET" })
  .validator((id: string) => String(id ?? ""))
  .middleware([accessMiddleware])
  .handler(async ({ context, data: id }) => {
    const row = await findVisible(context.userId, id);
    if (!row || row.is_folder) throw new Error("Datei nicht gefunden.");
    return { file: toFileDto(row), base64: row.content_b64 ?? "" };
  });

export const readFileByPath = createServerFn({ method: "GET" })
  .validator((input: { scope: Scope; path: string }) => ({ scope: asScope(input.scope), path: normalizePath(String(input.path ?? "")) }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    const idx = data.path.lastIndexOf("/");
    const folder = idx === -1 ? "" : data.path.slice(0, idx);
    const name = idx === -1 ? data.path : data.path.slice(idx + 1);
    const sql = await getSql();
    const rows = await sql.query<FileRow & { content_b64: string | null }>(
      `select ${FILE_COLUMNS}, content_b64 from furr_file where scope = $1 and ${ownerClause(data.scope)}
       and folder = $3 and name = $4`,
      [data.scope, context.userId, folder, name],
    );
    const row = rows[0];
    if (!row) return null;
    return { file: toFileDto(row), text: row.is_folder ? "" : base64ToText(row.content_b64) };
  });

/** Deletes a file, or a folder with everything inside it. */
export const deleteEntry = createServerFn({ method: "POST" })
  .validator((id: string) => String(id ?? ""))
  .middleware([accessMiddleware])
  .handler(async ({ context, data: id }) => {
    const row = await findVisible(context.userId, id);
    if (!row) throw new Error("Element nicht gefunden.");
    const sql = await getSql();
    if (row.is_folder) {
      const path = joinPath(row.folder, row.name);
      await sql.query(
        `delete from furr_file where scope = $1 and coalesce(owner_id, '') = $2 and (folder = $3 or folder like $3 || '/%')`,
        [row.scope, row.owner_id ?? "", path],
      );
    }
    await sql`delete from furr_file where id = ${row.id}`;
    return { ok: true };
  });

export const renameEntry = createServerFn({ method: "POST" })
  .validator((input: { id: string; name: string }) => ({
    id: String(input.id ?? ""),
    name: sanitizeName(String(input.name ?? "")),
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    if (!data.name) throw new Error("Name fehlt.");
    const row = await findVisible(context.userId, data.id);
    if (!row) throw new Error("Element nicht gefunden.");
    const sql = await getSql();
    const clash = await sql.query(
      `select 1 from furr_file where scope = $1 and coalesce(owner_id, '') = $2 and folder = $3 and name = $4`,
      [row.scope, row.owner_id ?? "", row.folder, data.name],
    );
    if (clash.length) throw new Error("Ein Element mit diesem Namen existiert bereits.");
    if (row.is_folder) {
      const oldPath = joinPath(row.folder, row.name);
      const newPath = joinPath(row.folder, data.name);
      await sql.query(
        `update furr_file set folder = $4 || substr(folder, length($3) + 1)
         where scope = $1 and coalesce(owner_id, '') = $2 and (folder = $3 or folder like $3 || '/%')`,
        [row.scope, row.owner_id ?? "", oldPath, newPath],
      );
    }
    await sql`update furr_file set name = ${data.name}, updated_at = now() where id = ${row.id}`;
    return { ok: true };
  });

/** Copy (or move) a file into another folder/scope — FurrFS cut/copy/paste. */
export const pasteEntry = createServerFn({ method: "POST" })
  .validator((input: { id: string; scope: Scope; folder: string; move: boolean }) => ({
    id: String(input.id ?? ""),
    scope: asScope(input.scope),
    folder: normalizePath(String(input.folder ?? "")),
    move: Boolean(input.move),
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    const row = await findVisible(context.userId, data.id);
    if (!row) throw new Error("Element nicht gefunden.");
    if (row.is_folder) throw new Error("Ordner können nur einzeln per Datei kopiert werden.");
    const file = await writeFile({
      scope: data.scope,
      ownerId: ownerFor(data.scope, context.userId),
      folder: data.folder,
      name: row.name,
      mimeType: row.mime_type,
      base64: row.content_b64 ?? "",
      size: Number(row.size) || 0,
      createdBy: context.userId,
    });
    if (data.move && file.id !== row.id) {
      const sql = await getSql();
      await sql`delete from furr_file where id = ${row.id}`;
    }
    return file;
  });

