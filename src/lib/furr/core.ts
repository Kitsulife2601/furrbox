// Server-side building blocks shared by all FurrBox server functions.
// Only call these from createServerFn handlers or server routes.
import { getSql, type Sql } from "@/lib/db";
import { effectiveRole, permissionsFor, ROLE_LABEL, type Permissions, type Role } from "./roles";
import { syncDiscordLogin } from "./discord-staff";
import { joinPath, normalizePath, PRIVATE_DEFAULT_FOLDERS } from "./paths";
import type { FurrFile, Me, Scope } from "./types";

export { getSql };

export function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function newId() {
  return crypto.randomUUID();
}

type ProfileRow = {
  user_id: string;
  username: string;
  display_name: string;
  discord_id: string | null;
  role: string;
  email: string | null;
  highest_privilege: string | null;
  synced_at: unknown;
  discord_privilege: string | null;
  discord_checked_at: unknown;
};

async function readProfile(sql: Sql, userId: string) {
  const rows = await sql<ProfileRow>`
    select p.user_id, p.username, p.display_name, p.discord_id, p.role, u.email, dm.highest_privilege,
      dm.synced_at, p.discord_privilege, p.discord_checked_at
    from furr_profile p
    left join "user" u on u.id = p.user_id
    left join discord_member dm on dm.discord_id = p.discord_id
    where p.user_id = ${userId}`;
  return rows[0] ?? null;
}

function usernameBase(name: string | null, email: string | null) {
  const source = name?.trim() || email?.split("@")[0] || "furr";
  return (
    source
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 24) || "furr"
  );
}

async function uniqueUsername(sql: Sql, base: string) {
  for (let i = 0; i < 50; i += 1) {
    const candidate = i === 0 ? base : `${base}${i + 1}`;
    const taken = await sql`select 1 from furr_profile where username = ${candidate}`;
    if (!taken.length) return candidate;
  }
  return `${base}_${newId().slice(0, 6)}`;
}

export async function ensureDefaultFolders(sql: Sql, userId: string) {
  for (const name of PRIVATE_DEFAULT_FOLDERS) {
    await sql`
      insert into furr_file (id, scope, owner_id, created_by, folder, name, is_folder, mime_type)
      values (${newId()}, 'private', ${userId}, ${userId}, '', ${name}, true, 'inode/directory')
      on conflict do nothing`;
  }
}

/** Creates a profile for a first-time user. Admin rights only ever come from Discord staff roles. */
export async function createProfile(
  sql: Sql,
  userId: string,
  opts: { username?: string; displayName?: string; discordId?: string | null; role?: Role } = {},
) {
  const users = await sql<{ name: string | null; email: string | null }>`
    select name, email from "user" where id = ${userId}`;
  const user = users[0] ?? { name: null, email: null };
  const role: Role = opts.role ?? "member";
  const username = await uniqueUsername(sql, usernameBase(opts.username ?? user.name, user.email));
  const displayName = opts.displayName?.trim() || user.name?.trim() || username;
  await sql`
    insert into furr_profile (user_id, username, display_name, discord_id, role)
    values (${userId}, ${username}, ${displayName}, ${opts.discordId ?? null}, ${role})
    on conflict (user_id) do nothing`;
  await ensureDefaultFolders(sql, userId);
}

/** The fresher of the two Discord sources: the bot bridge sync or the login check. */
function discordPrivilege(row: ProfileRow) {
  const synced = iso(row.synced_at);
  const checked = iso(row.discord_checked_at);
  if (checked && (!synced || checked >= synced)) return row.discord_privilege;
  return row.highest_privilege;
}

export async function loadMe(userId: string): Promise<Me> {
  const sql = await getSql();
  await syncDiscordLogin(sql, userId, (discordId) => createProfile(sql, userId, { discordId }));
  let row = await readProfile(sql, userId);
  if (!row) {
    await createProfile(sql, userId);
    row = await readProfile(sql, userId);
  }
  if (!row) throw new Error("Profil konnte nicht angelegt werden.");
  const role = effectiveRole(row.role, discordPrivilege(row));
  const permissions = permissionsFor(role);
  return {
    userId: row.user_id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    discordId: row.discord_id,
    role,
    roleLabel: ROLE_LABEL[role],
    permissions,
    hasAccess: await hasAccess(sql, row.discord_id, row.role, permissions.isTeam),
  };
}

/** Staff and manually promoted accounts always get in; everyone else needs a whitelist entry. */
async function hasAccess(sql: Sql, discordId: string | null, accountRole: string, isTeam: boolean) {
  if (isTeam || (accountRole && accountRole !== "member")) return true;
  if ((await getSetting("whitelist_enabled", "true")) !== "true") return true;
  if (!discordId) return false;
  const rows = await sql`select 1 from furr_whitelist where discord_id = ${discordId}`;
  return rows.length > 0;
}

export async function requireAccess(userId: string) {
  const me = await loadMe(userId);
  if (!me.hasAccess) throw new Error("Du bist nicht auf der FurrBox-Whitelist. Bitte den Owner um Freischaltung.");
  return me;
}

export async function requirePermission(userId: string, key: keyof Omit<Permissions, "moderationActions">) {
  const me = await loadMe(userId);
  if (!me.permissions[key]) throw new Error("Dafür fehlt dir die Berechtigung.");
  return me;
}

export async function notify(title: string, description: string, audience: "team" | "all" = "team") {
  const sql = await getSql();
  await sql`insert into furr_notification (audience, title, description) values (${audience}, ${title}, ${description})`;
}

export async function getSetting(key: string, fallback: string) {
  const sql = await getSql();
  const rows = await sql<{ value: string }>`select value from furr_setting where key = ${key}`;
  return rows[0]?.value ?? fallback;
}

export async function setSetting(key: string, value: string) {
  const sql = await getSql();
  await sql`
    insert into furr_setting (key, value, updated_at) values (${key}, ${value}, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
}

// ---------- FurrFS ----------

export type FileRow = {
  id: string;
  scope: Scope;
  owner_id: string | null;
  folder: string;
  name: string;
  is_folder: boolean;
  mime_type: string;
  size: number;
  created_at: unknown;
  updated_at: unknown;
};

export const FILE_COLUMNS =
  "id, scope, owner_id, folder, name, is_folder, mime_type, size, created_at, updated_at";

export function toFileDto(row: FileRow): FurrFile {
  return {
    id: row.id,
    scope: row.scope,
    ownerId: row.owner_id,
    folder: row.folder,
    name: row.name,
    path: joinPath(row.folder, row.name),
    isFolder: row.is_folder,
    mimeType: row.mime_type,
    size: Number(row.size) || 0,
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
    updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
  };
}

export function ownerFor(scope: Scope, userId: string) {
  return scope === "private" ? userId : null;
}

/** Makes sure every segment of `path` exists as a folder. */
export async function ensureFolderPath(scope: Scope, ownerId: string | null, path: string, createdBy: string) {
  const sql = await getSql();
  const parts = normalizePath(path).split("/").filter(Boolean);
  let parent = "";
  for (const part of parts) {
    await sql`
      insert into furr_file (id, scope, owner_id, created_by, folder, name, is_folder, mime_type)
      values (${newId()}, ${scope}, ${ownerId}, ${createdBy}, ${parent}, ${part}, true, 'inode/directory')
      on conflict do nothing`;
    parent = joinPath(parent, part);
  }
}

/** Creates or overwrites a file (folder chain is created on demand). */
export async function writeFile(opts: {
  scope: Scope;
  ownerId: string | null;
  folder: string;
  name: string;
  mimeType: string;
  base64: string;
  size: number;
  createdBy: string;
}): Promise<FurrFile> {
  const sql = await getSql();
  const folder = normalizePath(opts.folder);
  if (folder) await ensureFolderPath(opts.scope, opts.ownerId, folder, opts.createdBy);
  const rows = await sql.query<FileRow>(
    `insert into furr_file (id, scope, owner_id, created_by, folder, name, is_folder, mime_type, size, content_b64)
     values ($1, $2, $3, $4, $5, $6, false, $7, $8, $9)
     on conflict (scope, coalesce(owner_id, ''), folder, name) do update set
       mime_type = excluded.mime_type, size = excluded.size, content_b64 = excluded.content_b64,
       is_folder = false, updated_at = now()
     returning ${FILE_COLUMNS}`,
    [newId(), opts.scope, opts.ownerId, opts.createdBy, folder, opts.name, opts.mimeType, opts.size, opts.base64],
  );
  return toFileDto(rows[0]);
}

export function textToBase64(text: string) {
  return Buffer.from(text, "utf8").toString("base64");
}

export function base64ToText(b64: string | null) {
  return b64 ? Buffer.from(b64, "base64").toString("utf8") : "";
}

export async function writeTextFile(
  scope: Scope,
  ownerId: string | null,
  path: string,
  content: string,
  createdBy: string,
) {
  const { folder, name } = splitFolder(path);
  return writeFile({
    scope,
    ownerId,
    folder,
    name,
    mimeType: "text/plain",
    base64: textToBase64(content),
    size: Buffer.byteLength(content, "utf8"),
    createdBy,
  });
}

export async function appendTextFile(scope: Scope, path: string, block: string, createdBy: string) {
  const sql = await getSql();
  const { folder, name } = splitFolder(path);
  const rows = await sql<{ content_b64: string | null }>`
    select content_b64 from furr_file
    where scope = ${scope} and owner_id is null and folder = ${folder} and name = ${name}`;
  const current = base64ToText(rows[0]?.content_b64 ?? null);
  return writeTextFile(scope, null, path, current + block, createdBy);
}

function splitFolder(path: string) {
  const norm = normalizePath(path);
  const idx = norm.lastIndexOf("/");
  return idx === -1 ? { folder: "", name: norm } : { folder: norm.slice(0, idx), name: norm.slice(idx + 1) };
}

// ---------- Discord bridge ----------

export async function bridgeStatus() {
  const lastSeen = await getSetting("bot_last_seen", "");
  const lastSeenAt = lastSeen ? iso(lastSeen) : null;
  const connected = Boolean(lastSeenAt && Date.now() - new Date(lastSeenAt).getTime() < 60_000);
  return { connected, lastSeenAt, configured: Boolean(process.env.BOT_BRIDGE_TOKEN) };
}

export async function discordName(discordId: string) {
  const sql = await getSql();
  const rows = await sql<{ nickname: string | null; display_name: string; username: string }>`
    select nickname, display_name, username from discord_member where discord_id = ${discordId}`;
  const m = rows[0];
  if (m) return m.nickname || m.display_name || m.username;
  const profile = await sql<{ display_name: string }>`
    select display_name from furr_profile where discord_id = ${discordId}`;
  return profile[0]?.display_name ?? discordId;
}
