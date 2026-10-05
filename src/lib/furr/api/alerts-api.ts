// ServerFn-Fassade für Alert-Bus (Desktop/VR-Polling mit Backoff – Idle-freundlich).
import { createServerFn } from "@tanstack/react-start";
import { accessMiddleware } from "../access";
import { listAlertsSince, publishAlert, type AlertKind, type AlertSeverity } from "../alerts";
import { requirePermission } from "../core";

export const pollAlerts = createServerFn({ method: "GET" })
  .validator((input: { afterId?: string | null; limit?: number } | null) => ({
    afterId: input?.afterId ? String(input.afterId).trim() : null,
    limit: Math.min(100, Math.max(1, Number(input?.limit) || 30)),
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    await requirePermission(context.userId, "canUseEvidence");
    const alerts = await listAlertsSince(data.afterId, data.limit);
    // Hinweis für Idle: Client soll bei leerer Liste Backoff erhöhen (z. B. 5→15→30 s).
    return { alerts, suggestedPollMs: alerts.length ? 5_000 : 15_000 };
  });

export const markIncidentAlert = createServerFn({ method: "POST" })
  .validator((input: { title: string; body?: string; caseId?: string; severity?: AlertSeverity }) => ({
    title: String(input.title ?? "").trim().slice(0, 200),
    body: String(input.body ?? "").trim().slice(0, 1000),
    caseId: input.caseId ? String(input.caseId).trim().slice(0, 80) : null,
    severity: (input.severity === "critical" || input.severity === "warn" ? input.severity : "warn") as AlertSeverity,
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    await requirePermission(context.userId, "canUseEvidence");
    if (!data.title) throw new Error("Titel fehlt.");
    const id = await publishAlert({
      kind: "incident.mark" as AlertKind,
      title: data.title,
      body: data.body,
      severity: data.severity,
      dedupKey: data.caseId ? `incident:${data.caseId}` : undefined,
      payload: { caseId: data.caseId, by: context.userId },
    });
    return { id };
  });
