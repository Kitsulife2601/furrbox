// FurrWhitelist (Owner/Dev only): who may use FurrBox besides Discord staff.
// Whitelisted users sign in with Discord first, then with the name + password the owner
// assigned; the start password has to be replaced on first use.
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { accessMiddleware } from "../access";
import { getSetting, getSql, iso, loadMe, notify, requirePermission, setSetting } from "../core";

const DISCORD_ID = /^\d{17,22}$/;
const USERNAME = /^[a-z0-9_.-]{3,32}$/;
const MAX_FAILED = 5;
const LOCK_MINUTES = 10;

function checkPassword(password: string) {
  if (password.length < 8) throw new Error("Das Passwort muss mindestens 8 Zeichen lang sein.");
  if (password.length > 200) throw new Error("Das Passwort ist zu lang.");
}

export type WhitelistEntry = {
  discordId: string;
  name: string | null;
  note: string;
  addedBy: string | null;
  createdAt: string;
  hasAccount: boolean;
  username: string | null;
  /** True while the owner-assigned start password is still in use. */
  mustChangePassword: boolean;
  passwordChangedAt: string | null;
};

export type WhitelistCandidate = { discordId: string; name: string; username: string };

export const getWhitelist = createServerFn({ method: "GET" })
  .middleware([accessMiddleware])
  .handler(async ({ context }) => {
    await requirePermission(context.userId, "canManageWhitelist");
    const sql = await getSql();
    const rows = await sql<{
      discord_id: string;
      note: string;
      added_by: string | null;
      created_at: unknown;
      name: string | null;
      has_account: boolean;
      username: string | null;
      must_change_password: boolean;
      password_changed_at: unknown;
    }>`
      select w.discord_id, w.note, ap.display_name as added_by, w.created_at, w.username,
             w.must_change_password, w.password_changed_at,
             coalesce(dm.nickname, dm.display_name, p.display_name) as name,
             p.user_id is not null as has_account
      from furr_whitelist w
      left join discord_member dm on dm.discord_id = w.discord_id
      left join furr_profile p on p.discord_id = w.discord_id
      left join furr_profile ap on ap.user_id = w.added_by
      order by w.created_at desc`;
    const entries: WhitelistEntry[] = rows.map((r) => ({
      discordId: r.discord_id,
      name: r.name,
      note: r.note,
      addedBy: r.added_by,
      createdAt: iso(r.created_at) ?? new Date().toISOString(),
      hasAccount: Boolean(r.has_account),
      username: r.username,
      mustChangePassword: Boolean(r.must_change_password),
      passwordChangedAt: iso(r.password_changed_at),
    }));
    // People who already signed in or are known from the Discord server, for quick adding.
    const candidates = await sql<{ discord_id: string; name: string; username: string }>`
      select discord_id, name, username from (
        select dm.discord_id, coalesce(dm.nickname, dm.display_name) as name, dm.username
        from discord_member dm where dm.highest_privilege = 'none'
        union
        select p.discord_id, p.display_name as name, p.username
        from furr_profile p where p.discord_id is not null
      ) c
      where discord_id not in (select discord_id from furr_whitelist)
      order by name limit 500`;
    return {
      enabled: (await getSetting("whitelist_enabled", "true")) === "true",
      entries,
      candidates: candidates.map((c): WhitelistCandidate => ({ discordId: c.discord_id, name: c.name, username: c.username })),
    };
  });

/** Owner: add someone (or update their entry) with a login name and start password. */
export const addToWhitelist = createServerFn({ method: "POST" })
  .validator((input: { discordId: string; username: string; password: string; note?: string }) => ({
    discordId: String(input.discordId ?? "").trim(),
    username: String(input.username ?? "").trim().toLowerCase(),
    password: String(input.password ?? ""),
    note: String(input.note ?? "").trim().slice(0, 200),
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    const me = await requirePermission(context.userId, "canManageWhitelist");
    if (!DISCORD_ID.test(data.discordId)) throw new Error("Die Discord-ID ist eine 17–22-stellige Zahl.");
    if (!USERNAME.test(data.username)) throw new Error("Nutzername: 3–32 Zeichen, nur a–z, 0–9, _ . -");
    checkPassword(data.password);
    const sql = await getSql();
    const taken = await sql`
      select 1 from furr_whitelist where lower(username) = ${data.username} and discord_id <> ${data.discordId}`;
    if (taken.length) throw new Error("Dieser Nutzername ist schon vergeben.");
    const { hashPassword } = await import("../whitelist-login.server");
    const hash = await hashPassword(data.password);
    await sql`
      insert into furr_whitelist (discord_id, note, added_by, username, password_hash, must_change_password)
      values (${data.discordId}, ${data.note}, ${context.userId}, ${data.username}, ${hash}, true)
      on conflict (discord_id) do update set
        note = excluded.note, username = excluded.username, password_hash = excluded.password_hash,
        must_change_password = true, failed_attempts = 0, locked_until = null`;
    // A new start password signs the person out of FurrBox everywhere.
    await sql`
      delete from furr_whitelist_unlock
      where user_id in (select user_id from furr_profile where discord_id = ${data.discordId})`;
    await notify("Whitelist", `${me.displayName} hat ${data.username} für FurrBox freigeschaltet.`);
    return { ok: true };
  });

/** Owner: give someone a new start password (they must change it again on next login). */
export const resetWhitelistPassword = createServerFn({ method: "POST" })
  .validator((input: { discordId: string; password: string }) => ({
    discordId: String(input.discordId ?? "").trim(),
    password: String(input.password ?? ""),
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    await requirePermission(context.userId, "canManageWhitelist");
    checkPassword(data.password);
    const { hashPassword } = await import("../whitelist-login.server");
    const sql = await getSql();
    const hash = await hashPassword(data.password);
    const rows = await sql`
      update furr_whitelist set password_hash = ${hash}, must_change_password = true,
        failed_attempts = 0, locked_until = null
      where discord_id = ${data.discordId} returning discord_id`;
    if (!rows.length) throw new Error("Eintrag nicht gefunden.");
    await sql`
      delete from furr_whitelist_unlock
      where user_id in (select user_id from furr_profile where discord_id = ${data.discordId})`;
    return { ok: true };
  });

type LoginEntry = {
  discord_id: string;
  username: string | null;
  password_hash: string | null;
  failed_attempts: number;
  locked_until: unknown;
};

async function myEntry(userId: string) {
  const sql = await getSql();
  const rows = await sql<LoginEntry>`
    select w.discord_id, w.username, w.password_hash, w.failed_attempts, w.locked_until
    from furr_whitelist w join furr_profile p on p.discord_id = w.discord_id
    where p.user_id = ${userId}`;
  return rows[0] ?? null;
}

/** Whitelisted user, after Discord: sign in with the FurrBox name + password. */
export const whitelistLogin = createServerFn({ method: "POST" })
  .validator((input: { username: string; password: string }) => ({
    username: String(input.username ?? "").trim().toLowerCase(),
    password: String(input.password ?? ""),
  }))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const entry = await myEntry(context.userId);
    if (!entry?.password_hash) throw new Error("Für dich ist noch kein FurrBox-Zugang angelegt.");
    const lockedUntil = entry.locked_until ? new Date(String(entry.locked_until)) : null;
    if (lockedUntil && lockedUntil > new Date()) {
      const at = lockedUntil.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
      throw new Error(`Zu viele Fehlversuche. Versuch es um ${at} Uhr erneut.`);
    }
    const { currentSessionKey, verifyPassword } = await import("../whitelist-login.server");
    const sql = await getSql();
    const ok =
      entry.username?.toLowerCase() === data.username && (await verifyPassword(data.password, entry.password_hash));
    if (!ok) {
      const failed = Number(entry.failed_attempts) + 1;
      const lock = failed >= MAX_FAILED;
      await sql.query(
        `update furr_whitelist set failed_attempts = $2,
           locked_until = case when $3 then now() + ($4::int * interval '1 minute') else null end
         where discord_id = $1`,
        [entry.discord_id, lock ? 0 : failed, lock, LOCK_MINUTES],
      );
      throw new Error("Nutzername oder Passwort ist falsch.");
    }
    const key = await currentSessionKey(context.bearerToken);
    if (!key) throw new Error("Deine Discord-Sitzung wurde nicht erkannt. Bitte neu anmelden.");
    await sql`update furr_whitelist set failed_attempts = 0, locked_until = null where discord_id = ${entry.discord_id}`;
    await sql`
      insert into furr_whitelist_unlock (token_hash, user_id) values (${key}, ${context.userId})
      on conflict (token_hash) do nothing`;
    return loadMe(context.userId, context.bearerToken);
  });

/** Whitelisted user: replace the password (required after the owner set a start password). */
export const changeWhitelistPassword = createServerFn({ method: "POST" })
  .validator((input: { currentPassword: string; newPassword: string }) => ({
    currentPassword: String(input.currentPassword ?? ""),
    newPassword: String(input.newPassword ?? ""),
  }))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const me = await loadMe(context.userId, context.bearerToken);
    if (me.accessReason !== "ok" && me.accessReason !== "must_change_password") {
      throw new Error("Bitte melde dich zuerst mit deinem FurrBox-Nutzernamen und Passwort an.");
    }
    const entry = await myEntry(context.userId);
    if (!entry?.password_hash) throw new Error("Für dich ist kein FurrBox-Passwort hinterlegt.");
    const { hashPassword, verifyPassword } = await import("../whitelist-login.server");
    if (!(await verifyPassword(data.currentPassword, entry.password_hash))) {
      throw new Error("Das aktuelle Passwort stimmt nicht.");
    }
    checkPassword(data.newPassword);
    if (data.newPassword === data.currentPassword) throw new Error("Das neue Passwort muss sich vom alten unterscheiden.");
    const sql = await getSql();
    const hash = await hashPassword(data.newPassword);
    await sql`
      update furr_whitelist set password_hash = ${hash}, must_change_password = false, password_changed_at = now()
      where discord_id = ${entry.discord_id}`;
    return loadMe(context.userId, context.bearerToken);
  });

export const removeFromWhitelist = createServerFn({ method: "POST" })
  .validator((discordId: string) => String(discordId ?? "").trim())
  .middleware([accessMiddleware])
  .handler(async ({ context, data: discordId }) => {
    const me = await requirePermission(context.userId, "canManageWhitelist");
    const sql = await getSql();
    await sql`delete from furr_whitelist where discord_id = ${discordId}`;
    await sql`
      delete from furr_whitelist_unlock
      where user_id in (select user_id from furr_profile where discord_id = ${discordId})`;
    await notify("Whitelist", `${me.displayName} hat ${discordId} von der Whitelist entfernt.`);
    return { ok: true };
  });

export const setWhitelistEnabled = createServerFn({ method: "POST" })
  .validator((enabled: boolean) => Boolean(enabled))
  .middleware([accessMiddleware])
  .handler(async ({ context, data: enabled }) => {
    await requirePermission(context.userId, "canToggleWhitelist");
    await setSetting("whitelist_enabled", enabled ? "true" : "false");
    return { enabled };
  });
