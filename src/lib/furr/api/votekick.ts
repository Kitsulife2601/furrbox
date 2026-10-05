// Votekick-Backend: Session create / cast / tally / expire – Idempotenz + Fairness.
import { createServerFn } from "@tanstack/react-start";
import { accessMiddleware } from "../access";
import { appendAuditLater } from "../audit";
import { publishAlert, publishAlertLater } from "../alerts";
import { getSetting, getSql, iso, newId, requirePermission, setSetting } from "../core";
import { TtlCache } from "../cache";

export type VotekickStatus = "open" | "passed" | "failed" | "expired" | "cancelled";

export type VotekickSessionDto = {
  id: string;
  targetUsr: string;
  targetName: string | null;
  initiatorUsr: string | null;
  initiatorName: string | null;
  world: string | null;
  instanceId: string | null;
  status: VotekickStatus;
  yesCount: number;
  noCount: number;
  quorum: number;
  createdAt: string;
  expiresAt: string;
  closedAt: string | null;
  resultDetail: string | null;
};

const USR = /^usr_[0-9a-f-]{36}$/i;
const settingsCache = new TtlCache<{ quorum: number; cooldownSec: number; ttlSec: number }>(10_000, 4);

async function voteSettings() {
  return settingsCache.get("v", async () => {
    const [q, c, t] = await Promise.all([
      getSetting("votekick_quorum", "3"),
      getSetting("votekick_cooldown_sec", "120"),
      getSetting("votekick_ttl_sec", "60"),
    ]);
    return {
      quorum: Math.max(1, Math.min(50, Number(q) || 3)),
      cooldownSec: Math.max(30, Math.min(3600, Number(c) || 120)),
      ttlSec: Math.max(20, Math.min(300, Number(t) || 60)),
    };
  });
}

function rowToDto(r: {
  id: string;
  target_usr: string;
  target_name: string | null;
  initiator_usr: string | null;
  initiator_name: string | null;
  world: string | null;
  instance_id: string | null;
  status: string;
  yes_count: number;
  no_count: number;
  quorum: number;
  created_at: unknown;
  expires_at: unknown;
  closed_at: unknown;
  result_detail: string | null;
}): VotekickSessionDto {
  return {
    id: r.id,
    targetUsr: r.target_usr,
    targetName: r.target_name,
    initiatorUsr: r.initiator_usr,
    initiatorName: r.initiator_name,
    world: r.world,
    instanceId: r.instance_id,
    status: r.status as VotekickStatus,
    yesCount: Number(r.yes_count),
    noCount: Number(r.no_count),
    quorum: Number(r.quorum),
    createdAt: iso(r.created_at) ?? "",
    expiresAt: iso(r.expires_at) ?? "",
    closedAt: iso(r.closed_at),
    resultDetail: r.result_detail,
  };
}

async function expireOpen(sql: Awaited<ReturnType<typeof getSql>>) {
  const expired = await sql<{ id: string; target_usr: string; target_name: string | null; yes_count: number; quorum: number }>`
    update votekick_session set status = 'expired', closed_at = now(),
      result_detail = coalesce(result_detail, 'Zeit abgelaufen')
    where status = 'open' and expires_at < now()
    returning id, target_usr, target_name, yes_count, quorum`;
  for (const e of expired) {
    publishAlertLater({
      kind: "vote.result",
      severity: "info",
      title: "Votekick abgelaufen",
      body: `${e.target_name || e.target_usr}: ${e.yes_count}/${e.quorum} Ja`,
      dedupKey: `vote:${e.id}:expired`,
      payload: { sessionId: e.id, status: "expired" },
      channels: ["bot", "desktop", "vr"],
    });
  }
}

export const getVotekickSettings = createServerFn({ method: "GET" })
  .middleware([accessMiddleware])
  .handler(async ({ context }) => {
    await requirePermission(context.userId, "canUseEvidence");
    return voteSettings();
  });

export const setVotekickSettings = createServerFn({ method: "POST" })
  .validator((input: { quorum?: number; cooldownSec?: number; ttlSec?: number }) => ({
    quorum: input.quorum != null ? Math.max(1, Math.min(50, Math.trunc(Number(input.quorum)))) : null,
    cooldownSec: input.cooldownSec != null ? Math.max(30, Math.min(3600, Math.trunc(Number(input.cooldownSec)))) : null,
    ttlSec: input.ttlSec != null ? Math.max(20, Math.min(300, Math.trunc(Number(input.ttlSec)))) : null,
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    await requirePermission(context.userId, "canManageVrchat");
    if (data.quorum != null) await setSetting("votekick_quorum", String(data.quorum));
    if (data.cooldownSec != null) await setSetting("votekick_cooldown_sec", String(data.cooldownSec));
    if (data.ttlSec != null) await setSetting("votekick_ttl_sec", String(data.ttlSec));
    settingsCache.clear();
    return voteSettings();
  });

export const createVotekick = createServerFn({ method: "POST" })
  .validator(
    (input: {
      targetUsr: string;
      targetName?: string;
      initiatorUsr?: string;
      initiatorName?: string;
      world?: string;
      instanceId?: string;
      clientKey?: string;
    }) => ({
      targetUsr: String(input.targetUsr ?? "").trim(),
      targetName: input.targetName ? String(input.targetName).trim().slice(0, 100) : null,
      initiatorUsr: input.initiatorUsr ? String(input.initiatorUsr).trim() : null,
      initiatorName: input.initiatorName ? String(input.initiatorName).trim().slice(0, 100) : null,
      world: input.world ? String(input.world).trim().slice(0, 150) : null,
      instanceId: input.instanceId ? String(input.instanceId).trim().slice(0, 120) : null,
      clientKey: input.clientKey ? String(input.clientKey).trim().slice(0, 80) : null,
    }),
  )
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    await requirePermission(context.userId, "canUseEvidence");
    if (!USR.test(data.targetUsr)) throw new Error("Ziel braucht eine gültige usr_-ID.");
    const sql = await getSql();
    await expireOpen(sql);
    const cfg = await voteSettings();

    if (data.clientKey) {
      const existing = await sql<Parameters<typeof rowToDto>[0]>`
        select * from votekick_session where client_key = ${data.clientKey} limit 1`;
      if (existing[0]) return { session: rowToDto(existing[0]), reused: true as const };
    }

    const cooldown = await sql<{ id: string }>`
      select id from votekick_session
      where target_usr = ${data.targetUsr}
        and created_at > now() - (${cfg.cooldownSec}::int * interval '1 second')
      order by created_at desc limit 1`;
    if (cooldown.length) throw new Error(`Cooldown aktiv – warte noch ${cfg.cooldownSec} s vor dem nächsten Vote gegen dieselbe Person.`);

    const id = newId();
    const rows = await sql<Parameters<typeof rowToDto>[0]>`
      insert into votekick_session (
        id, target_usr, target_name, initiator_usr, initiator_name, world, instance_id,
        quorum, client_key, created_by, expires_at
      ) values (
        ${id}, ${data.targetUsr}, ${data.targetName}, ${data.initiatorUsr}, ${data.initiatorName},
        ${data.world}, ${data.instanceId}, ${cfg.quorum}, ${data.clientKey}, ${context.userId},
        now() + (${cfg.ttlSec}::int * interval '1 second')
      )
      returning *`;
    appendAuditLater({
      source: "furrbox",
      action: "votekick.create",
      actorId: context.userId,
      targetId: data.targetUsr,
      targetName: data.targetName,
      detail: data.world,
    });
    return { session: rowToDto(rows[0]), reused: false as const };
  });

export const castVotekick = createServerFn({ method: "POST" })
  .validator((input: { sessionId: string; voterKey: string; vote: "yes" | "no" }) => ({
    sessionId: String(input.sessionId ?? "").trim(),
    voterKey: String(input.voterKey ?? "").trim().slice(0, 80),
    vote: input.vote === "no" ? ("no" as const) : ("yes" as const),
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    await requirePermission(context.userId, "canUseEvidence");
    if (!data.voterKey) throw new Error("voterKey fehlt.");
    const sql = await getSql();
    await expireOpen(sql);
    const sessions = await sql<Parameters<typeof rowToDto>[0]>`
      select * from votekick_session where id = ${data.sessionId}`;
    const session = sessions[0];
    if (!session) throw new Error("Session nicht gefunden.");
    if (session.status !== "open") return { session: rowToDto(session), accepted: false as const };

    await sql`
      insert into votekick_vote (session_id, voter_key, vote)
      values (${data.sessionId}, ${data.voterKey}, ${data.vote})
      on conflict (session_id, voter_key) do update set vote = excluded.vote`;

    const counts = await sql<{ yes: number; no: number }>`
      select count(*) filter (where vote = 'yes')::int as yes,
             count(*) filter (where vote = 'no')::int as no
      from votekick_vote where session_id = ${data.sessionId}`;
    const yes = counts[0]?.yes ?? 0;
    const no = counts[0]?.no ?? 0;
    await sql`update votekick_session set yes_count = ${yes}, no_count = ${no} where id = ${data.sessionId}`;

    let status: VotekickStatus = "open";
    if (yes >= session.quorum) {
      status = "passed";
      await sql`
        update votekick_session set status = 'passed', closed_at = now(),
          result_detail = ${`Quorum erreicht (${yes}/${session.quorum})`}
        where id = ${data.sessionId} and status = 'open'`;
      await publishAlert({
        kind: "vote.result",
        severity: "critical",
        title: "Votekick angenommen",
        body: `${session.target_name || session.target_usr} – ${yes}/${session.quorum} Ja`,
        dedupKey: `vote:${data.sessionId}:passed`,
        payload: { sessionId: data.sessionId, status: "passed", targetUsr: session.target_usr },
      });
      appendAuditLater({
        source: "furrbox",
        action: "votekick.passed",
        actorId: context.userId,
        targetId: session.target_usr,
        targetName: session.target_name,
        detail: `${yes}/${session.quorum}`,
      });
    }

    const fresh = await sql<Parameters<typeof rowToDto>[0]>`select * from votekick_session where id = ${data.sessionId}`;
    return { session: rowToDto(fresh[0] ?? { ...session, yes_count: yes, no_count: no, status }), accepted: true as const };
  });

export const getVotekick = createServerFn({ method: "GET" })
  .validator((sessionId: string) => String(sessionId ?? "").trim())
  .middleware([accessMiddleware])
  .handler(async ({ context, data: sessionId }) => {
    await requirePermission(context.userId, "canUseEvidence");
    const sql = await getSql();
    await expireOpen(sql);
    const rows = await sql<Parameters<typeof rowToDto>[0]>`select * from votekick_session where id = ${sessionId}`;
    if (!rows[0]) throw new Error("Session nicht gefunden.");
    return rowToDto(rows[0]);
  });

export const listVotekick = createServerFn({ method: "GET" })
  .validator((limit?: number) => Math.min(50, Math.max(1, Number(limit) || 20)))
  .middleware([accessMiddleware])
  .handler(async ({ context, data: limit }) => {
    await requirePermission(context.userId, "canUseEvidence");
    const sql = await getSql();
    await expireOpen(sql);
    const rows = await sql<Parameters<typeof rowToDto>[0]>`
      select * from votekick_session order by created_at desc limit ${limit}`;
    return rows.map(rowToDto);
  });

export const expireVotekick = createServerFn({ method: "POST" })
  .validator((sessionId?: string) => (sessionId ? String(sessionId).trim() : null))
  .middleware([accessMiddleware])
  .handler(async ({ context, data: sessionId }) => {
    await requirePermission(context.userId, "canUseEvidence");
    const sql = await getSql();
    if (sessionId) {
      await sql`
        update votekick_session set status = 'expired', closed_at = now(),
          result_detail = coalesce(result_detail, 'Manuell beendet')
        where id = ${sessionId} and status = 'open'`;
    } else {
      await expireOpen(sql);
    }
    return { ok: true as const };
  });
