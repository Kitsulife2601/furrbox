// Alert-Bus: kritische Events an Bot / Desktop / VR â€“ Dedup + Rate-Limit.
import { getSql, getSetting, iso, newId } from "./core";
import { createThrottle } from "./cache";
import { runSideEffect } from "./http";

export type AlertKind =
  | "vote.result"
  | "whitelist.deny"
  | "duty.change"
  | "duty.empty"
  | "incident.mark"
  | "watchlist.join"
  | "ban.applied"
  | "ban.undo"
  | "anti_troll"
  | "chatbox.hint"
  | "sanction.change"
  | "changelog"
  | "system.event";

export type AlertSeverity = "info" | "warn" | "critical";
export type AlertChannel = "bot" | "desktop" | "vr";

export type PublishAlertInput = {
  kind: AlertKind;
  title: string;
  body?: string;
  severity?: AlertSeverity;
  dedupKey?: string | null;
  channels?: AlertChannel[];
  payload?: Record<string, string | number | boolean | null> | null;
  ttlMinutes?: number;
};

const RATE_WINDOW_MS = 2_000;
const rateOk = createThrottle(RATE_WINDOW_MS);
let burst = 0;
const BURST_MAX = 20;

function resetBurst() {
  burst = 0;
}
try { const t = setInterval(resetBurst, 60_000); (t as NodeJS.Timeout).unref?.(); } catch { /* ignore */ }

/** Publiziert ein Alert; Dedup innerhalb alert_dedup_sec; weiches Rate-Limit. */
export async function publishAlert(input: PublishAlertInput): Promise<string | null> {
  if (burst >= BURST_MAX) {
    console.warn("[furrbox] alert rate-limit burst", input.kind);
    return null;
  }
  if (!rateOk() && burst > 5) {
    // Kurze SchÃ¼be ok, Dauerfeuer nicht.
  }
  burst += 1;

  const sql = await getSql();
  const dedupSec = Math.max(5, Number(await getSetting("alert_dedup_sec", "30")) || 30);
  if (input.dedupKey) {
    const recent = await sql<{ id: string }>`
      select id from alert_event
      where dedup_key = ${input.dedupKey} and created_at > now() - (${dedupSec}::int * interval '1 second')
      limit 1`;
    if (recent.length) return recent[0].id;
  }

  const id = newId();
  const channels = JSON.stringify(input.channels ?? ["bot", "desktop", "vr"]);
  const ttl = Math.max(5, Math.min(180, input.ttlMinutes ?? 30));
  await sql`
    insert into alert_event (id, kind, severity, title, body, payload_json, dedup_key, channels, expires_at)
    values (
      ${id},
      ${input.kind},
      ${input.severity ?? "info"},
      ${input.title.slice(0, 200)},
      ${(input.body ?? "").slice(0, 1000)},
      ${input.payload ? JSON.stringify(input.payload).slice(0, 4000) : null},
      ${input.dedupKey ?? null},
      ${channels},
      now() + (${ttl}::int * interval '1 minute')
    )`;
  return id;
}

export function publishAlertLater(input: PublishAlertInput) {
  void runSideEffect(() => publishAlert(input), "publish-alert");
}

export type AlertDto = {
  id: string;
  kind: string;
  severity: string;
  title: string;
  body: string;
  payload: Record<string, string | number | boolean | null> | null;
  channels: string[];
  at: string;
};

export async function listAlertsSince(afterId: string | null, limit = 50): Promise<AlertDto[]> {
  const sql = await getSql();
  const lim = Math.min(100, Math.max(1, limit));
  const rows = afterId
    ? await sql<{
        id: string;
        kind: string;
        severity: string;
        title: string;
        body: string;
        payload_json: string | null;
        channels: string;
        created_at: unknown;
      }>`
        select id, kind, severity, title, body, payload_json, channels, created_at
        from alert_event
        where created_at > coalesce((select created_at from alert_event where id = ${afterId}), '1970-01-01')
          and expires_at > now()
        order by created_at asc
        limit ${lim}`
    : await sql<{
        id: string;
        kind: string;
        severity: string;
        title: string;
        body: string;
        payload_json: string | null;
        channels: string;
        created_at: unknown;
      }>`
        select id, kind, severity, title, body, payload_json, channels, created_at
        from alert_event
        where expires_at > now() and created_at > now() - interval '30 minutes'
        order by created_at desc
        limit ${lim}`;

  return rows.map((r) => {
    let payload: Record<string, string | number | boolean | null> | null = null;
    let channels: string[] = ["bot", "desktop", "vr"];
    try {
      payload = r.payload_json ? (JSON.parse(r.payload_json) as Record<string, string | number | boolean | null>) : null;
    } catch {
      payload = null;
    }
    try {
      const parsed = JSON.parse(r.channels);
      if (Array.isArray(parsed)) channels = parsed.map(String);
    } catch {
      /* keep default */
    }
    return {
      id: r.id,
      kind: r.kind,
      severity: r.severity,
      title: r.title,
      body: r.body,
      payload,
      channels,
      at: iso(r.created_at) ?? new Date().toISOString(),
    };
  });
}

/** FÃ¼r Bridge-Queue: ungelieferte Bot-Alerts markieren und zurÃ¼ckgeben. */
export async function takeBotAlerts(limit = 20) {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    kind: string;
    severity: string;
    title: string;
    body: string;
    payload_json: string | null;
  }>`
    update alert_event set delivered_bot = true
    where id in (
      select id from alert_event
      where not delivered_bot and expires_at > now()
        and channels like '%bot%'
      order by created_at limit ${limit}
    )
    returning id, kind, severity, title, body, payload_json`;
  return rows.map((r) => ({
    alertId: r.id,
    kind: r.kind,
    severity: r.severity,
    title: r.title,
    body: r.body,
    payload: r.payload_json ? safeParse(r.payload_json) : null,
  }));
}

function safeParse(raw: string) {
  try {
    return JSON.parse(raw) as Record<string, string | number | boolean | null>;
  } catch {
    return null;
  }
}

