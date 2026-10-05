import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { accessMiddleware } from "../access";
import { BRIDGE_STATUS_CACHE_MS, bridgeStatus, getSetting, getSql, iso, loadMe, loadMeCached } from "../core";
import { invalidatePresenceCache } from "../presence-cache";
import type { Platform, SystemNotification } from "../types";
import UPDATES from "../updates.json";

export const getMe = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => loadMe(context.userId, context.bearerToken));

/**
 * Presence-Heartbeat. Desktop darf bei Minimieren auf ~60 s drosseln.
 * Online-Fenster (Presence) = duty_heartbeat_grace_sec (Default 120 s) → 60 s-Takt bleibt frisch.
 */
export const heartbeat = createServerFn({ method: "POST" })
  .validator((input: Platform | { platform?: Platform; mode?: "normal" | "throttled" }) => {
    if (typeof input === "string") {
      return { platform: (input === "mobile" ? "mobile" : "desktop") as Platform, mode: "normal" as const };
    }
    return {
      platform: (input?.platform === "mobile" ? "mobile" : "desktop") as Platform,
      mode: input?.mode === "throttled" ? ("throttled" as const) : ("normal" as const),
    };
  })
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const graceSec = Math.max(90, Number(await getSetting("duty_heartbeat_grace_sec", "120")) || 120);
    // connected_at nur zurücksetzen wenn länger als Grace offline – passt zu 60 s Throttle.
    await sql.query(
      `insert into furr_presence (user_id, platform, connected_at, last_heartbeat_at)
       values ($1, $2, now(), now())
       on conflict (user_id) do update set
         platform = excluded.platform,
         connected_at = case
           when furr_presence.last_heartbeat_at is null
             or furr_presence.last_heartbeat_at < now() - ($3::int * interval '1 second')
           then now() else furr_presence.connected_at end,
         last_heartbeat_at = now()`,
      [context.userId, data.platform, graceSec],
    );
    // Throttled: Client soll ~60 s bleiben; normal: 15–45 s wie bisher.
    const nextMs = data.mode === "throttled" ? 60_000 : 30_000;
    return { ok: true as const, at: new Date().toISOString(), nextMs, graceSec };
  });

export const goOffline = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await sql`
      update furr_presence set last_heartbeat_at = null, connected_at = null, last_seen_at = now()
      where user_id = ${context.userId}`;
    invalidatePresenceCache();
    return { ok: true };
  });

export const updateMyProfile = createServerFn({ method: "POST" })
  .validator((input: { displayName: string }) => ({ displayName: String(input.displayName ?? "").trim() }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    if (data.displayName.length < 2 || data.displayName.length > 80) {
      throw new Error("Anzeigename muss 2-80 Zeichen lang sein.");
    }
    const sql = await getSql();
    await sql`update furr_profile set display_name = ${data.displayName} where user_id = ${context.userId}`;
    return loadMe(context.userId);
  });

/** System notifications (replaces the `system:notification` socket event). */
export const listNotifications = createServerFn({ method: "GET" })
  .validator((afterId: number) => (Number.isFinite(afterId) ? Math.max(0, Math.trunc(afterId)) : 0))
  .middleware([accessMiddleware])
  .handler(async ({ context, data: afterId }): Promise<SystemNotification[]> => {
    const me = await loadMeCached(context.userId);
    const sql = await getSql();
    const rows = await sql<{ id: number; version: string; title: string; description: string; created_at: unknown }>`
      select id, version, title, description, created_at from furr_notification
      where id > ${afterId} and (audience = 'all' or ${me.permissions.isTeam})
      order by id desc limit 20`;
    return rows.map((r) => ({
      id: Number(r.id),
      version: r.version,
      title: r.title,
      description: r.description,
      createdAt: iso(r.created_at) ?? new Date().toISOString(),
    }));
  });

export const getBridgeStatus = createServerFn({ method: "GET" })
  .middleware([accessMiddleware])
  .handler(async () => bridgeStatus(BRIDGE_STATUS_CACHE_MS));

/** The deployed build id + its update history, so open apps can notice a newer FurrBox. */
export const getAppBuild = createServerFn({ method: "GET" }).handler(async () => ({
  build: __FURRBOX_BUILD__,
  updates: UPDATES as { date: string; version?: string; title: string; items: string[] }[],
}));
