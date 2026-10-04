// Anwesenheit ("kann gerade moderieren"): set from the VR panel or the desktop, shown in the team
// list, used by the bot's "instance opened" message and written to the duty log.
import { createServerFn } from "@tanstack/react-start";
import { accessMiddleware } from "../access";
import { appendTextFile, getSetting, getSql, iso, newId, requirePermission, setSetting } from "../core";
import { VRCHAT_LOGS } from "../paths";

export const DUTY_LOG_NAME = "Anwesenheit.txt";
/** "Anwesend" only counts while FurrBox was seen recently – nobody stays on duty by accident. */
export const DUTY_FRESH_MINUTES = 15;

export type DutyEntry = { userId: string; onDuty: boolean; since: string | null };
export type DutyLogEntry = { id: string; name: string; kind: "on" | "off" | "votekick"; detail: string | null; at: string };

function stamp() {
  return new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" });
}

async function writeLog(userId: string, name: string, kind: DutyLogEntry["kind"], detail: string | null) {
  const sql = await getSql();
  await sql`insert into mod_duty_log (id, user_id, kind, detail) values (${newId()}, ${userId}, ${kind}, ${detail})`;
  const text = kind === "on" ? "ist anwesend (kann moderieren)" : kind === "off" ? "ist nicht mehr anwesend" : `hat einen Votekick als erledigt markiert: ${detail ?? ""}`;
  await appendTextFile("public", `${VRCHAT_LOGS}/${DUTY_LOG_NAME}`, `[${stamp()}] ${name} ${text}\r\n`, userId);
}

/** Everyone's duty status (only "anwesend" while their FurrBox was seen in the last minutes). */
export const listDuty = createServerFn({ method: "GET" })
  .middleware([accessMiddleware])
  .handler(async ({ context }): Promise<DutyEntry[]> => {
    await requirePermission(context.userId, "canUseEvidence");
    const sql = await getSql();
    const rows = await sql<{ user_id: string; on_duty: boolean; updated_at: unknown; fresh: boolean }>`
      select d.user_id, d.on_duty, d.updated_at,
             coalesce(p.last_heartbeat_at > now() - interval '15 minutes', false) as fresh
      from mod_duty d left join furr_presence p on p.user_id = d.user_id`;
    return rows.map((r) => ({ userId: r.user_id, onDuty: Boolean(r.on_duty && r.fresh), since: iso(r.updated_at) }));
  });

export const setDuty = createServerFn({ method: "POST" })
  .validator((on: boolean) => Boolean(on))
  .middleware([accessMiddleware])
  .handler(async ({ context, data: on }) => {
    const me = await requirePermission(context.userId, "canUseEvidence");
    const sql = await getSql();
    const before = await sql<{ on_duty: boolean }>`select on_duty from mod_duty where user_id = ${context.userId}`;
    await sql`
      insert into mod_duty (user_id, on_duty, updated_at) values (${context.userId}, ${on}, now())
      on conflict (user_id) do update set on_duty = excluded.on_duty, updated_at = now()`;
    if (Boolean(before[0]?.on_duty) !== on) await writeLog(context.userId, `${me.displayName} (${me.roleLabel})`, on ? "on" : "off", null);
    return { onDuty: on };
  });

/** "Erledigt" on a vote kick warning: goes into the duty log. */
export const markVotekickDone = createServerFn({ method: "POST" })
  .validator((input: { target: string; initiator?: string | null; world?: string | null }) => ({
    target: String(input.target ?? "").trim().slice(0, 100),
    initiator: input.initiator ? String(input.initiator).slice(0, 100) : null,
    world: input.world ? String(input.world).slice(0, 150) : null,
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    const me = await requirePermission(context.userId, "canUseEvidence");
    if (!data.target) throw new Error("Kein Votekick angegeben.");
    const detail = `gegen ${data.target}${data.initiator ? `, gestartet von ${data.initiator}` : ""}${data.world ? ` (${data.world})` : ""}`;
    await writeLog(context.userId, `${me.displayName} (${me.roleLabel})`, "votekick", detail);
    return { ok: true };
  });

export const listDutyLog = createServerFn({ method: "GET" })
  .middleware([accessMiddleware])
  .handler(async ({ context }): Promise<DutyLogEntry[]> => {
    await requirePermission(context.userId, "canUseEvidence");
    const sql = await getSql();
    const rows = await sql<{ id: string; kind: string; detail: string | null; created_at: unknown; name: string | null }>`
      select l.id, l.kind, l.detail, l.created_at, p.display_name as name
      from mod_duty_log l left join furr_profile p on p.user_id = l.user_id
      order by l.created_at desc limit 100`;
    return rows.map((r) => ({ id: r.id, name: r.name ?? "Unbekannt", kind: r.kind as DutyLogEntry["kind"], detail: r.detail, at: iso(r.created_at) ?? "" }));
  });

/** Discord channel where the bot announces a newly opened group instance with the duty list. */
export const getDutyChannel = createServerFn({ method: "GET" })
  .middleware([accessMiddleware])
  .handler(async ({ context }) => {
    await requirePermission(context.userId, "canManageVrchat");
    return { channelId: await getSetting("duty_channel_id", "1434484156431204382") };
  });

export const setDutyChannel = createServerFn({ method: "POST" })
  .validator((channelId: string) => {
    const id = String(channelId ?? "").trim();
    if (id && !/^\d{17,22}$/.test(id)) throw new Error("Die Kanal-ID ist eine lange Zahl (in Discord: Rechtsklick auf den Kanal → „Kanal-ID kopieren“).");
    return id;
  })
  .middleware([accessMiddleware])
  .handler(async ({ context, data: channelId }) => {
    await requirePermission(context.userId, "canManageVrchat");
    await setSetting("duty_channel_id", channelId);
    return { channelId };
  });
