// Anwesenheit ("kann gerade moderieren"): set from the VR panel or the desktop, shown in the team
// list, used by the bot's "instance opened" message and written to the duty log.
import { createServerFn } from "@tanstack/react-start";
import { accessMiddleware } from "../access";
import { appendAuditLater } from "../audit";
import { publishAlertLater } from "../alerts";
import { appendTextFile, getSetting, getSql, iso, newId, requirePermission, setSetting } from "../core";
import { runSideEffect } from "../http";
import { VRCHAT_LOGS } from "../paths";
import { connectedGroupId, DUTY_AUTO_SQL, DUTY_ON_SQL, isGroupInstance, markSeenInGroupInstance } from "../duty-announce";

export const DUTY_LOG_NAME = "Anwesenheit.txt";
/** "Anwesend" only counts while FurrBox was seen recently – nobody stays on duty by accident. */
export const DUTY_FRESH_MINUTES = 15;
/** Heartbeat-Grace: Desktop darf bei Minimieren auf 60 s drosseln; Online-Fenster ≥ 120 s. */
export const DUTY_HEARTBEAT_GRACE_SEC = 120;

export type DutyStatus = "on" | "off" | "away";
export type DutyEntry = {
  userId: string;
  onDuty: boolean;
  status?: DutyStatus;
  since: string | null;
  name?: string | null;
  /** Counts as anwesend because they were seen in an instance of our group. */
  auto?: boolean;
  vrchatName?: string | null;
  vrchatId?: string | null;
};
export type DutyLogEntry = { id: string; name: string; kind: "on" | "off" | "away" | "votekick"; detail: string | null; at: string };

function stamp() {
  return new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" });
}

function normalizeStatus(raw: unknown, onDuty?: boolean): DutyStatus {
  if (raw === "on" || raw === "off" || raw === "away") return raw;
  return onDuty ? "on" : "off";
}

/**
 * DB-Eintrag zuerst (schnell), Datei-Append mit Timeout – damit Votekick-„Erledigt“
 * und Duty-Toggles nie auf einen hängenden Log-Write warten.
 */
async function writeLog(userId: string, name: string, kind: DutyLogEntry["kind"], detail: string | null) {
  const sql = await getSql();
  await sql`insert into mod_duty_log (id, user_id, kind, detail) values (${newId()}, ${userId}, ${kind}, ${detail})`;
  const text =
    kind === "on"
      ? "ist anwesend (kann moderieren)"
      : kind === "away"
        ? "ist kurz weg (away)"
        : kind === "off"
          ? "ist nicht mehr anwesend"
          : `hat einen Votekick als erledigt markiert: ${detail ?? ""}`;
  await runSideEffect(
    () => appendTextFile("public", `${VRCHAT_LOGS}/${DUTY_LOG_NAME}`, `[${stamp()}] ${name} ${text}\r\n`, userId),
    "duty-log-append",
  );
}

/** Everyone's duty status: switched on by hand (and FurrBox seen lately) or seen in a group instance. */
export const listDuty = createServerFn({ method: "GET" })
  .middleware([accessMiddleware])
  .handler(async ({ context }): Promise<DutyEntry[]> => {
    await requirePermission(context.userId, "canUseEvidence");
    const sql = await getSql();
    const rows = await sql.query<{
      user_id: string;
      status: string | null;
      on_duty: boolean;
      updated_at: unknown;
      effective: boolean;
      auto: boolean;
      fresh: boolean;
      name: string | null;
      vrchat_name: string | null;
      vrchat_user_id: string | null;
    }>(
      `select d.user_id, d.status, d.on_duty, d.updated_at, ${DUTY_ON_SQL} as effective, ${DUTY_AUTO_SQL} as auto,
              coalesce(pr.last_heartbeat_at > now() - interval '15 minutes' or d.discord_until > now(), false) as fresh,
              p.display_name as name, p.vrchat_name, p.vrchat_user_id
       from mod_duty d
       left join furr_presence pr on pr.user_id = d.user_id
       left join furr_profile p on p.user_id = d.user_id`,
      [],
    );
    return rows.map((r) => {
      const manual = normalizeStatus(r.status, Boolean(r.on_duty));
      const status: DutyStatus = r.effective ? "on" : r.fresh && manual === "away" ? "away" : "off";
      return {
        userId: r.user_id,
        onDuty: status === "on",
        status,
        since: iso(r.updated_at),
        name: r.name,
        auto: Boolean(r.auto),
        vrchatName: r.vrchat_name,
        vrchatId: r.vrchat_user_id,
      };
    });
  });

const USR_ID = /^usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keeps the own VRChat account (from the desktop app's VRChat login) at the FurrBox profile. */
export const linkMyVrchat = createServerFn({ method: "POST" })
  .validator((input: { userId: string; displayName: string }) => ({
    userId: String(input?.userId ?? "").trim(),
    displayName: String(input?.displayName ?? "").trim().slice(0, 100),
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    await requirePermission(context.userId, "canUseEvidence");
    if (!USR_ID.test(data.userId)) throw new Error("Ungültige VRChat-ID.");
    const sql = await getSql();
    await sql`
      update furr_profile set vrchat_user_id = ${data.userId}, vrchat_name = ${data.displayName || null}
      where user_id = ${context.userId}
        and (vrchat_user_id is distinct from ${data.userId} or vrchat_name is distinct from ${data.displayName || null})`;
    return { ok: true as const };
  });

/**
 * The desktop app tells in which VRChat instance you are (read from VRChat's own log). In an
 * instance of our group you count as "anwesend" for the next minutes.
 */
export const reportVrchatLocation = createServerFn({ method: "POST" })
  .validator((location: string) => String(location ?? "").trim().slice(0, 300))
  .middleware([accessMiddleware])
  .handler(async ({ context, data: location }) => {
    await requirePermission(context.userId, "canUseEvidence");
    const groupId = await connectedGroupId();
    if (!groupId || !isGroupInstance(location, groupId)) return { inGroup: false };
    await markSeenInGroupInstance([{ userId: context.userId, location }]);
    return { inGroup: true };
  });

/** PATCH-artig: on | off | away. Boolean-API bleibt für Alt-Clients. */
export const setDuty = createServerFn({ method: "POST" })
  .validator((input: boolean | { status?: DutyStatus; onDuty?: boolean }) => {
    if (typeof input === "boolean") return { status: (input ? "on" : "off") as DutyStatus };
    if (input?.status === "on" || input?.status === "off" || input?.status === "away") return { status: input.status };
    return { status: (input?.onDuty ? "on" : "off") as DutyStatus };
  })
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    const me = await requirePermission(context.userId, "canUseEvidence");
    const sql = await getSql();
    const before = await sql<{ on_duty: boolean; status: string | null }>`
      select on_duty, status from mod_duty where user_id = ${context.userId}`;
    const prev = normalizeStatus(before[0]?.status, Boolean(before[0]?.on_duty));
    const next = data.status;
    const on = next === "on";
    await sql`
      insert into mod_duty (user_id, on_duty, status, updated_at) values (${context.userId}, ${on}, ${next}, now())
      on conflict (user_id) do update set on_duty = excluded.on_duty, status = excluded.status, updated_at = now(),
        discord_until = null,
        -- "Aus" by hand while in a group instance: no automatic "anwesend" in that instance.
        vrchat_optout = case when ${next} = 'off' and mod_duty.vrchat_until > now() then mod_duty.vrchat_location else null end`;
    if (prev !== next) {
      const logKind: DutyLogEntry["kind"] = next === "away" ? "away" : next === "on" ? "on" : "off";
      await writeLog(context.userId, `${me.displayName} (${me.roleLabel})`, logKind, null);
      appendAuditLater({
        source: "furrbox",
        action: `duty.${next}`,
        actorId: context.userId,
        actorName: me.displayName,
      });
      publishAlertLater({
        kind: "duty.change",
        severity: "info",
        title: `Duty: ${next}`,
        body: `${me.displayName} → ${next}`,
        dedupKey: `duty:${context.userId}:${next}`,
        payload: { userId: context.userId, status: next },
        channels: ["bot", "desktop", "vr"],
      });
    }
    return { onDuty: on, status: next };
  });

/** "Erledigt" on a vote kick warning: goes into the duty log. */
export const markVotekickDone = createServerFn({ method: "POST" })
  .validator((input: { target: string; initiator?: string | null; world?: string | null; caseId?: string | null }) => ({
    target: String(input.target ?? "").trim().slice(0, 100),
    initiator: input.initiator ? String(input.initiator).slice(0, 100) : null,
    world: input.world ? String(input.world).slice(0, 150) : null,
    caseId: input.caseId ? String(input.caseId).trim().slice(0, 80) : null,
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    const me = await requirePermission(context.userId, "canUseEvidence");
    if (!data.target) throw new Error("Kein Votekick angegeben.");
    const detail = `gegen ${data.target}${data.initiator ? `, gestartet von ${data.initiator}` : ""}${data.world ? ` (${data.world})` : ""}`;
    await writeLog(context.userId, `${me.displayName} (${me.roleLabel})`, "votekick", detail);
    appendAuditLater({
      source: "furrbox",
      action: "votekick.done",
      actorId: context.userId,
      actorName: me.displayName,
      targetName: data.target,
      caseId: data.caseId,
      detail,
    });
    publishAlertLater({
      kind: "incident.mark",
      severity: "info",
      title: "Votekick erledigt",
      body: detail,
      dedupKey: `vkdone:${data.target}:${Math.floor(Date.now() / 60_000)}`,
      payload: { target: data.target, caseId: data.caseId },
    });
    return { ok: true };
  });

export type HandoverNote = { id: string; userId: string; name: string; text: string; at: string };

/** Übergabe-Notiz at the end of a duty: what the next one should know. */
export const saveHandover = createServerFn({ method: "POST" })
  .validator((text: string) => String(text ?? "").trim().slice(0, 1000))
  .middleware([accessMiddleware])
  .handler(async ({ context, data: text }) => {
    const me = await requirePermission(context.userId, "canUseEvidence");
    if (!text) throw new Error("Die Notiz ist leer.");
    const sql = await getSql();
    await sql`insert into duty_handover (id, user_id, text) values (${newId()}, ${context.userId}, ${text})`;
    appendAuditLater({
      source: "furrbox",
      action: "duty.handover",
      actorId: context.userId,
      actorName: me.displayName,
      detail: text.slice(0, 300),
    });
    return { ok: true as const };
  });

/** The latest handover notes of the team (two weeks back), newest first. */
export const listHandovers = createServerFn({ method: "GET" })
  .middleware([accessMiddleware])
  .handler(async ({ context }): Promise<HandoverNote[]> => {
    await requirePermission(context.userId, "canUseEvidence");
    const sql = await getSql();
    const rows = await sql<{ id: string; user_id: string; text: string; created_at: unknown; name: string | null }>`
      select h.id, h.user_id, h.text, h.created_at, p.display_name as name
      from duty_handover h left join furr_profile p on p.user_id = h.user_id
      where h.created_at > now() - interval '14 days'
      order by h.created_at desc limit 20`;
    return rows.map((r) => ({ id: r.id, userId: r.user_id, name: r.name ?? "Unbekannt", text: r.text, at: iso(r.created_at) ?? "" }));
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
    return rows.map((r) => ({
      id: r.id,
      name: r.name ?? "Unbekannt",
      kind: r.kind as DutyLogEntry["kind"],
      detail: r.detail,
      at: iso(r.created_at) ?? "",
    }));
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

/** Hilfsfunktion Bridge: niemand anwesend bei offener Instanz → Alert. */
export async function alertIfNoOneOnDuty(headline: string) {
  const sql = await getSql();
  const rows = await sql.query<{ n: number }>(
    `select count(*)::int as n
    from mod_duty d
    left join furr_presence pr on pr.user_id = d.user_id
    where ${DUTY_ON_SQL}`,
    [],
  );
  if ((rows[0]?.n ?? 0) > 0) return;
  publishAlertLater({
    kind: "duty.empty",
    severity: "critical",
    title: "Instanz offen – niemand anwesend",
    body: headline,
    dedupKey: `dutyempty:${Math.floor(Date.now() / 120_000)}`,
    payload: { headline },
    channels: ["bot", "desktop", "vr"],
  });
}
