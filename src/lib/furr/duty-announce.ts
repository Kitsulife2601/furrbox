// Who counts as "anwesend" – one definition for FurrBox, the alarms and the bot's "new group
// instance" message in Discord (also used to refresh that message when someone clicks a button).
import { getSql } from "./core";

const DUTY_ROLE: Record<string, string> = { dev: "Dev", owner: "Owner", moderator: "Mod", supporter: "Supporter" };

/**
 * SQL: seen in an instance of our group right now (and not switched to "Aus" by hand there).
 * (Alias: d = mod_duty.)
 */
export const DUTY_AUTO_SQL = `coalesce(d.vrchat_until > now() and d.vrchat_location is distinct from d.vrchat_optout and coalesce(d.status, 'off') <> 'away', false)`;

/**
 * SQL: is this person "anwesend" right now? Either switched on (and FurrBox was seen in the last
 * minutes, or they clicked "Anwesend" in Discord a short while ago) – or seen in a group instance.
 * (Aliases: d = mod_duty, pr = furr_presence.)
 */
export const DUTY_ON_SQL = `(coalesce(d.on_duty and (pr.last_heartbeat_at > now() - interval '15 minutes' or d.discord_until > now()), false) or ${DUTY_AUTO_SQL})`;

/** Marks these FurrBox users as seen in a group instance (for the next few minutes). */
export async function markSeenInGroupInstance(seen: { userId: string; location: string }[]) {
  const sql = await getSql();
  for (const s of seen.slice(0, 50)) {
    await sql`
      insert into mod_duty (user_id, on_duty, status, updated_at, vrchat_until, vrchat_location)
      values (${s.userId}, false, 'off', now(), now() + interval '4 minutes', ${s.location})
      on conflict (user_id) do update set vrchat_until = excluded.vrchat_until, vrchat_location = excluded.vrchat_location`;
  }
}

/** The id of the VRChat group FurrBox is connected to, or null. */
export async function connectedGroupId() {
  const sql = await getSql();
  const rows = await sql<{ group_id: string | null }>`select group_id from vrchat_connection where id = 1`;
  const id = rows[0]?.group_id ?? null;
  return id && /^grp_[0-9a-f-]{36}$/i.test(id) ? id : null;
}

/** Is this VRChat location an instance of that group? ("wrld_…:123~group(grp_…)~…") */
export function isGroupInstance(location: string, groupId: string) {
  return location.startsWith("wrld_") && location.includes(`~group(${groupId})`);
}

export async function dutyLines() {
  const sql = await getSql();
  const staff = await sql.query<{ name: string; privilege: string; on_duty: boolean; auto: boolean; vrchat_name: string | null }>(
    `select coalesce(dm.nickname, dm.display_name) as name, dm.highest_privilege as privilege,
            ${DUTY_ON_SQL} as on_duty, ${DUTY_AUTO_SQL} as auto, p.vrchat_name
     from discord_member dm
     left join furr_profile p on p.discord_id = dm.discord_id
     left join mod_duty d on d.user_id = p.user_id
     left join furr_presence pr on pr.user_id = p.user_id
     where dm.highest_privilege in ('dev', 'owner', 'moderator', 'supporter')
     order by array_position(array['dev', 'owner', 'moderator', 'supporter'], dm.highest_privilege), 1`,
    [],
  );
  const one = (s: (typeof staff)[number]) =>
    `${s.name} (${DUTY_ROLE[s.privilege] ?? s.privilege}${s.auto ? ` · in der Instanz${s.vrchat_name ? ` als ${s.vrchat_name}` : ""}` : ""})`;
  const line = (list: typeof staff) => (list.length ? list.map(one).join(", ") : "niemand");
  const on = staff.filter((s) => s.on_duty);
  return {
    anyone: on.length > 0,
    lines: [`✅ **Anwesend (kann moderieren):** ${line(on)}`, `❌ **Nicht anwesend:** ${line(staff.filter((s) => !s.on_duty))}`],
  };
}
