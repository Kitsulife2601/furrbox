// Gemeinsames Audit-Log: Query last-N + Filter case_id / source / action.
import { createServerFn } from "@tanstack/react-start";
import { accessMiddleware } from "../access";
import { appendAudit } from "../audit";
import { getSql, iso, requirePermission } from "../core";

export type AuditEntryDto = {
  id: string;
  at: string;
  source: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  targetId: string | null;
  targetName: string | null;
  caseId: string | null;
  detail: string | null;
  meta: Record<string, string | number | boolean | null> | null;
};

export const listAuditLog = createServerFn({ method: "GET" })
  .validator(
    (input: {
      limit?: number;
      caseId?: string | null;
      source?: string | null;
      action?: string | null;
      after?: string | null;
    } | null) => ({
      limit: Math.min(500, Math.max(1, Number(input?.limit) || 100)),
      caseId: input?.caseId ? String(input.caseId).trim().slice(0, 80) : null,
      source: input?.source ? String(input.source).trim().slice(0, 40) : null,
      action: input?.action ? String(input.action).trim().slice(0, 80) : null,
      after: input?.after ? String(input.after) : null,
    }),
  )
  .middleware([accessMiddleware])
  .handler(async ({ context, data }): Promise<AuditEntryDto[]> => {
    await requirePermission(context.userId, "canUseEvidence");
    const sql = await getSql();
    const rows = await sql.query<{
      id: string;
      at: unknown;
      source: string;
      actor_id: string | null;
      actor_name: string | null;
      action: string;
      target_id: string | null;
      target_name: string | null;
      case_id: string | null;
      detail: string | null;
      meta_json: string | null;
    }>(
      `select id, at, source, actor_id, actor_name, action, target_id, target_name, case_id, detail, meta_json
       from furr_audit
       where ($1::text is null or case_id = $1)
         and ($2::text is null or source = $2)
         and ($3::text is null or action = $3)
         and ($4::timestamptz is null or at < $4::timestamptz)
       order by at desc
       limit $5`,
      [data.caseId, data.source, data.action, data.after, data.limit],
    );
    return rows.map((r) => {
      let meta: Record<string, string | number | boolean | null> | null = null;
      if (r.meta_json) {
        try {
          meta = JSON.parse(r.meta_json) as Record<string, string | number | boolean | null>;
        } catch {
          meta = null;
        }
      }
      return {
        id: r.id,
        at: iso(r.at) ?? "",
        source: r.source,
        actorId: r.actor_id,
        actorName: r.actor_name,
        action: r.action,
        targetId: r.target_id,
        targetName: r.target_name,
        caseId: r.case_id,
        detail: r.detail,
        meta,
      };
    });
  });

/** Manueller Audit-Eintrag (z. B. Desktop markiert Incident). */
export const writeAuditEntry = createServerFn({ method: "POST" })
  .validator(
    (input: {
      action: string;
      source?: "discord" | "vrchat" | "furrbox" | "desktop" | "bot";
      targetId?: string;
      targetName?: string;
      caseId?: string;
      detail?: string;
    }) => ({
      action: String(input.action ?? "").trim().slice(0, 80),
      source: (["discord", "vrchat", "furrbox", "desktop", "bot"].includes(String(input.source))
        ? input.source
        : "desktop") as "discord" | "vrchat" | "furrbox" | "desktop" | "bot",
      targetId: input.targetId ? String(input.targetId).trim().slice(0, 80) : null,
      targetName: input.targetName ? String(input.targetName).trim().slice(0, 100) : null,
      caseId: input.caseId ? String(input.caseId).trim().slice(0, 80) : null,
      detail: input.detail ? String(input.detail).trim().slice(0, 1000) : null,
    }),
  )
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    const me = await requirePermission(context.userId, "canUseEvidence");
    if (!data.action) throw new Error("action fehlt.");
    const id = await appendAudit({
      source: data.source,
      action: data.action,
      actorId: context.userId,
      actorName: me.displayName,
      targetId: data.targetId,
      targetName: data.targetName,
      caseId: data.caseId,
      detail: data.detail,
    });
    return { id };
  });
