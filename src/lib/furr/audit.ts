// Append-only Audit-Helfer (server-only). Keine Secrets in detail/meta.
import { getSql, newId } from "./core";
import { runSideEffect } from "./http";

export type AuditSource = "discord" | "vrchat" | "furrbox" | "desktop" | "bot";

export type AuditInput = {
  source: AuditSource;
  action: string;
  actorId?: string | null;
  actorName?: string | null;
  targetId?: string | null;
  targetName?: string | null;
  caseId?: string | null;
  detail?: string | null;
  meta?: Record<string, string | number | boolean | null> | null;
};

function scrub(value: string | null | undefined, max = 2000): string | null {
  if (!value) return null;
  // Passwort-/Token-ähnliche Fragmente nicht persistieren.
  const cleaned = value
    .replace(/(password|token|secret|authorization|cookie)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .slice(0, max);
  return cleaned;
}

/** Schreibt einen unveränderlichen Audit-Eintrag. Wirft nicht nach außen, wenn als Side-Effect genutzt. */
export async function appendAudit(input: AuditInput): Promise<string> {
  const sql = await getSql();
  const id = newId();
  const metaJson = input.meta ? scrub(JSON.stringify(input.meta), 4000) : null;
  await sql`
    insert into furr_audit (id, source, actor_id, actor_name, action, target_id, target_name, case_id, detail, meta_json)
    values (
      ${id},
      ${input.source},
      ${input.actorId ?? null},
      ${scrub(input.actorName, 200)},
      ${input.action.slice(0, 80)},
      ${input.targetId ?? null},
      ${scrub(input.targetName, 200)},
      ${input.caseId ?? null},
      ${scrub(input.detail)},
      ${metaJson}
    )`;
  return id;
}

/** Fire-and-forget mit Timeout – für Pfade, die die HTTP-Antwort nicht blockieren dürfen. */
export function appendAuditLater(input: AuditInput) {
  void runSideEffect(() => appendAudit(input), "append-audit");
}
