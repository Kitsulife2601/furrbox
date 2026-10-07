// The two lines "who is anwesend / who is not" of the bot's "new group instance" message in
// Discord – also used to refresh the message when someone clicks a button below it.
import { getSql } from "./core";

const DUTY_ROLE: Record<string, string> = { dev: "Dev", owner: "Owner", moderator: "Mod", supporter: "Supporter" };

/**
 * SQL: is this duty row "really there" right now? Either FurrBox was seen in the last minutes or
 * the person clicked "Anwesend" in Discord a short while ago. (Aliases: d = mod_duty, pr = furr_presence.)
 */
export const DUTY_FRESH_SQL = `(pr.last_heartbeat_at > now() - interval '15 minutes' or d.discord_until > now())`;

export async function dutyLines() {
  const sql = await getSql();
  const staff = await sql.query<{ name: string; privilege: string; on_duty: boolean }>(
    `select coalesce(dm.nickname, dm.display_name) as name, dm.highest_privilege as privilege,
            coalesce(d.on_duty and ${DUTY_FRESH_SQL}, false) as on_duty
     from discord_member dm
     left join furr_profile p on p.discord_id = dm.discord_id
     left join mod_duty d on d.user_id = p.user_id
     left join furr_presence pr on pr.user_id = p.user_id
     where dm.highest_privilege in ('dev', 'owner', 'moderator', 'supporter')
     order by array_position(array['dev', 'owner', 'moderator', 'supporter'], dm.highest_privilege), 1`,
    [],
  );
  const line = (list: typeof staff) => (list.length ? list.map((s) => `${s.name} (${DUTY_ROLE[s.privilege] ?? s.privilege})`).join(", ") : "niemand");
  const on = staff.filter((s) => s.on_duty);
  return {
    anyone: on.length > 0,
    lines: [`✅ **Anwesend (kann moderieren):** ${line(on)}`, `❌ **Nicht anwesend:** ${line(staff.filter((s) => !s.on_duty))}`],
  };
}
