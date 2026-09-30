// FurrWhitelist (Owner/Dev only): who may use FurrBox besides Discord staff.
import { createServerFn } from "@tanstack/react-start";
import { accessMiddleware } from "../access";
import { getSetting, getSql, iso, notify, requirePermission, setSetting } from "../core";

const DISCORD_ID = /^\d{17,22}$/;

export type WhitelistEntry = {
  discordId: string;
  name: string | null;
  note: string;
  addedBy: string | null;
  createdAt: string;
  hasAccount: boolean;
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
    }>`
      select w.discord_id, w.note, ap.display_name as added_by, w.created_at,
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

export const addToWhitelist = createServerFn({ method: "POST" })
  .validator((input: { discordId: string; note?: string }) => ({
    discordId: String(input.discordId ?? "").trim(),
    note: String(input.note ?? "").trim().slice(0, 200),
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    const me = await requirePermission(context.userId, "canManageWhitelist");
    if (!DISCORD_ID.test(data.discordId)) throw new Error("Die Discord-ID ist eine 17–22-stellige Zahl.");
    const sql = await getSql();
    await sql`
      insert into furr_whitelist (discord_id, note, added_by) values (${data.discordId}, ${data.note}, ${context.userId})
      on conflict (discord_id) do update set note = excluded.note`;
    await notify("Whitelist", `${me.displayName} hat ${data.discordId} für FurrBox freigeschaltet.`);
    return { ok: true };
  });

export const removeFromWhitelist = createServerFn({ method: "POST" })
  .validator((discordId: string) => String(discordId ?? "").trim())
  .middleware([accessMiddleware])
  .handler(async ({ context, data: discordId }) => {
    const me = await requirePermission(context.userId, "canManageWhitelist");
    const sql = await getSql();
    await sql`delete from furr_whitelist where discord_id = ${discordId}`;
    await notify("Whitelist", `${me.displayName} hat ${discordId} von der Whitelist entfernt.`);
    return { ok: true };
  });

export const setWhitelistEnabled = createServerFn({ method: "POST" })
  .validator((enabled: boolean) => Boolean(enabled))
  .middleware([accessMiddleware])
  .handler(async ({ context, data: enabled }) => {
    await requirePermission(context.userId, "canManageWhitelist");
    await setSetting("whitelist_enabled", enabled ? "true" : "false");
    return { enabled };
  });
