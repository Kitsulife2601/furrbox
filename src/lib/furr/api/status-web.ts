// Read-only Status für Web-Companion (Duty/Presence/Alerts) – Idle-sparsam.
import { createServerFn } from "@tanstack/react-start";
import { accessMiddleware } from "../access";
import { listAlertsSince } from "../alerts";
import { BRIDGE_STATUS_CACHE_MS, bridgeStatus, getSetting, getSql, requirePermission } from "../core";
import { TtlCache } from "../cache";
import { DUTY_FRESH_MINUTES, type DutyStatus } from "./duty";

export type StatusWebSnapshot = {
  at: string;
  pollMs: number;
  bridgeOnline: boolean;
  duty: Array<{ userId: string; name: string | null; status: DutyStatus; onDuty: boolean }>;
  presenceOnline: number;
  alerts: Array<{ id: string; kind: string; title: string; severity: string; at: string }>;
  auth: { mode: "session"; note: string };
};

const snapCache = new TtlCache<StatusWebSnapshot>(5_000, 4);

export async function loadStatusWebSnapshot(): Promise<StatusWebSnapshot> {
  const pollMs = Math.max(5_000, Math.min(60_000, Number(await getSetting("status_web_poll_ms", "15000")) || 15_000));
  return snapCache.get("snap", async () => {
    const sql = await getSql();
    const [bot, dutyRows, presenceRows, alerts] = await Promise.all([
      bridgeStatus(BRIDGE_STATUS_CACHE_MS),
      sql<{ user_id: string; on_duty: boolean; status: string | null; name: string | null; fresh: boolean }>`
        select d.user_id, d.on_duty, d.status, p.display_name as name,
               coalesce(pr.last_heartbeat_at > now() - (${DUTY_FRESH_MINUTES}::int * interval '1 minute'), false) as fresh
        from mod_duty d
        left join furr_profile p on p.user_id = d.user_id
        left join furr_presence pr on pr.user_id = d.user_id`,
      sql<{ n: number }>`
        select count(*)::int as n from furr_presence
        where last_heartbeat_at > now() - interval '90 seconds'`,
      listAlertsSince(null, 5),
    ]);
    const duty = dutyRows.map((r) => {
      const raw = (r.status === "on" || r.status === "off" || r.status === "away" ? r.status : r.on_duty ? "on" : "off") as DutyStatus;
      const status: DutyStatus = r.fresh ? raw : "off";
      return {
        userId: r.user_id,
        name: r.name,
        status,
        onDuty: status === "on",
      };
    });
    return {
      at: new Date().toISOString(),
      pollMs,
      bridgeOnline: bot.connected,
      duty,
      presenceOnline: presenceRows[0]?.n ?? 0,
      alerts: alerts.map((a) => ({
        id: a.id,
        kind: a.kind,
        title: a.title,
        severity: a.severity,
        at: a.at,
      })),
      auth: {
        mode: "session",
        note: "Wie übrige Furr-APIs: eingeloggte Staff-Session. Kein Bot-Token im Browser.",
      },
    };
  });
}

export const getStatusWebSnapshot = createServerFn({ method: "GET" })
  .middleware([accessMiddleware])
  .handler(async ({ context }): Promise<StatusWebSnapshot> => {
    await requirePermission(context.userId, "canUseEvidence");
    return loadStatusWebSnapshot();
  });
