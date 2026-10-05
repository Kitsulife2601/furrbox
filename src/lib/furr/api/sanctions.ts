// Persistente Strafen (Mute/Timeout/Ban) – Bot reconciled beim Start.
import { createServerFn } from "@tanstack/react-start";
import { accessMiddleware } from "../access";
import { appendAudit, appendAuditLater } from "../audit";
import { publishAlertLater } from "../alerts";
import { getSql, iso, newId, requirePermission } from "../core";

export type SanctionType = "mute" | "timeout" | "ban" | "warn";
export type SanctionPlatform = "discord" | "vrchat";

export type SanctionDto = {
  id: string;
  platform: SanctionPlatform;
  targetId: string;
  targetName: string | null;
  type: SanctionType;
  reason: string;
  caseId: string | null;
  expiresAt: string | null;
  createdBy: string;
  createdAt: string;
  active: boolean;
};

const TYPES = new Set(["mute", "timeout", "ban", "warn"]);
const PLATFORMS = new Set(["discord", "vrchat"]);

function toDto(r: {
  id: string;
  platform: string;
  target_id: string;
  target_name: string | null;
  type: string;
  reason: string;
  case_id: string | null;
  expires_at: unknown;
  created_by: string;
  created_at: unknown;
  active: boolean;
}): SanctionDto {
  return {
    id: r.id,
    platform: r.platform as SanctionPlatform,
    targetId: r.target_id,
    targetName: r.target_name,
    type: r.type as SanctionType,
    reason: r.reason,
    caseId: r.case_id,
    expiresAt: iso(r.expires_at),
    createdBy: r.created_by,
    createdAt: iso(r.created_at) ?? "",
    active: Boolean(r.active),
  };
}

/** Aktive Strafen (für UI). Abgelaufene werden soft-deaktiviert. */
export const listSanctions = createServerFn({ method: "GET" })
  .validator((input: { platform?: string; targetId?: string; includeInactive?: boolean } | null) => ({
    platform: input?.platform && PLATFORMS.has(input.platform) ? input.platform : null,
    targetId: input?.targetId ? String(input.targetId).trim().slice(0, 80) : null,
    includeInactive: Boolean(input?.includeInactive),
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    await requirePermission(context.userId, "canUseEvidence");
    const sql = await getSql();
    // Abgelaufene aktiv → inactive (billig, kein Cron nötig).
    await sql`
      update mod_sanction set active = false
      where active and expires_at is not null and expires_at < now()`;
    const rows = await sql.query<{
      id: string;
      platform: string;
      target_id: string;
      target_name: string | null;
      type: string;
      reason: string;
      case_id: string | null;
      expires_at: unknown;
      created_by: string;
      created_at: unknown;
      active: boolean;
    }>(
      `select id, platform, target_id, target_name, type, reason, case_id, expires_at, created_by, created_at, active
       from mod_sanction
       where ($1::text is null or platform = $1)
         and ($2::text is null or target_id = $2)
         and ($3::boolean or active)
       order by created_at desc limit 200`,
      [data.platform, data.targetId, data.includeInactive],
    );
    return rows.map(toDto);
  });

export const upsertSanction = createServerFn({ method: "POST" })
  .validator(
    (input: {
      platform: SanctionPlatform;
      targetId: string;
      targetName?: string;
      type: SanctionType;
      reason: string;
      caseId?: string | null;
      expiresAt?: string | null;
      durationMs?: number | null;
    }) => ({
      platform: (PLATFORMS.has(input.platform) ? input.platform : "discord") as SanctionPlatform,
      targetId: String(input.targetId ?? "").trim(),
      targetName: input.targetName ? String(input.targetName).trim().slice(0, 100) : null,
      type: (TYPES.has(input.type) ? input.type : "mute") as SanctionType,
      reason: String(input.reason ?? "").trim().slice(0, 512),
      caseId: input.caseId ? String(input.caseId).trim().slice(0, 80) : null,
      expiresAt: input.expiresAt ? String(input.expiresAt) : null,
      durationMs: input.durationMs != null ? Number(input.durationMs) : null,
    }),
  )
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    await requirePermission(context.userId, "canUseEvidence");
    if (!data.targetId) throw new Error("Ziel fehlt.");
    if (data.reason.length < 3) throw new Error("Begründung mindestens 3 Zeichen.");
    let expiresAt: string | null = data.expiresAt;
    if (!expiresAt && data.durationMs && data.durationMs > 0) {
      expiresAt = new Date(Date.now() + data.durationMs).toISOString();
    }
    const sql = await getSql();
    const id = newId();
    await sql`
      insert into mod_sanction (id, platform, target_id, target_name, type, reason, case_id, expires_at, created_by, active)
      values (${id}, ${data.platform}, ${data.targetId}, ${data.targetName}, ${data.type}, ${data.reason},
              ${data.caseId}, ${expiresAt}, ${context.userId}, true)`;
    appendAuditLater({
      source: "furrbox",
      action: `sanction.${data.type}`,
      actorId: context.userId,
      targetId: data.targetId,
      targetName: data.targetName,
      caseId: data.caseId,
      detail: data.reason,
    });
    publishAlertLater({
      kind: "sanction.change",
      severity: data.type === "ban" ? "critical" : "warn",
      title: `Sanktion: ${data.type}`,
      body: `${data.targetName || data.targetId} – ${data.reason}`,
      dedupKey: `sanction:${data.platform}:${data.targetId}:${data.type}`,
      payload: { sanctionId: id, platform: data.platform, type: data.type, caseId: data.caseId },
    });
    return { id, ok: true as const };
  });

export const liftSanction = createServerFn({ method: "POST" })
  .validator((input: { id: string; reason?: string }) => ({
    id: String(input.id ?? "").trim(),
    reason: input.reason ? String(input.reason).trim().slice(0, 200) : null,
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    await requirePermission(context.userId, "canUseEvidence");
    const sql = await getSql();
    const rows = await sql<{ id: string; target_id: string; type: string; case_id: string | null }>`
      update mod_sanction set active = false, lifted_at = now(), lifted_by = ${context.userId}
      where id = ${data.id} and active
      returning id, target_id, type, case_id`;
    if (!rows.length) throw new Error("Sanktion nicht gefunden oder schon beendet.");
    appendAuditLater({
      source: "furrbox",
      action: "sanction.lift",
      actorId: context.userId,
      targetId: rows[0].target_id,
      caseId: rows[0].case_id,
      detail: data.reason,
    });
    return { ok: true as const };
  });

/**
 * Bot-Reconcile: aktive + noch nicht abgelaufene Strafen.
 * Bridge: GET /api/bridge/sanctions-active
 * (ServerFn hier für Desktop-Debug / Admin.)
 */
export const listActiveSanctionsForReconcile = createServerFn({ method: "GET" })
  .middleware([accessMiddleware])
  .handler(async ({ context }) => {
    await requirePermission(context.userId, "canManageVrchat");
    return loadActiveSanctions();
  });

export async function loadActiveSanctions() {
  const sql = await getSql();
  await sql`
    update mod_sanction set active = false
    where active and expires_at is not null and expires_at < now()`;
  const rows = await sql<{
    id: string;
    platform: string;
    target_id: string;
    target_name: string | null;
    type: string;
    reason: string;
    case_id: string | null;
    expires_at: unknown;
    created_by: string;
    created_at: unknown;
    active: boolean;
  }>`
    select id, platform, target_id, target_name, type, reason, case_id, expires_at, created_by, created_at, active
    from mod_sanction where active
    order by created_at`;
  return rows.map(toDto);
}

/** Bot schreibt Sanktion nach erfolgreicher Discord-Aktion (Bridge). */
export async function upsertSanctionFromBot(input: {
  platform: SanctionPlatform;
  targetId: string;
  targetName?: string | null;
  type: SanctionType;
  reason: string;
  caseId?: string | null;
  expiresAt?: string | null;
  createdBy: string;
}) {
  const sql = await getSql();
  const id = newId();
  await sql`
    insert into mod_sanction (id, platform, target_id, target_name, type, reason, case_id, expires_at, created_by, active)
    values (${id}, ${input.platform}, ${input.targetId}, ${input.targetName ?? null}, ${input.type}, ${input.reason},
            ${input.caseId ?? null}, ${input.expiresAt ?? null}, ${input.createdBy}, true)`;
  await appendAudit({
    source: "bot",
    action: `sanction.${input.type}`,
    actorId: input.createdBy,
    targetId: input.targetId,
    targetName: input.targetName,
    caseId: input.caseId,
    detail: input.reason,
  });
  return id;
}
