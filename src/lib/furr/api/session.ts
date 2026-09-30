import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { accessMiddleware } from "../access";
import { bridgeStatus, getSql, iso, loadMe } from "../core";
import type { Platform, SystemNotification } from "../types";
import UPDATES from "../updates.json";

export const getMe = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => loadMe(context.userId));

/** Replaces the Socket.io presence heartbeat: called every 15s while the desktop is open. */
export const heartbeat = createServerFn({ method: "POST" })
  .validator((platform: Platform) => (platform === "mobile" ? "mobile" : "desktop") as Platform)
  .middleware([accessMiddleware])
  .handler(async ({ context, data: platform }) => {
    const sql = await getSql();
    await sql`
      insert into furr_presence (user_id, platform, connected_at, last_heartbeat_at)
      values (${context.userId}, ${platform}, now(), now())
      on conflict (user_id) do update set
        platform = excluded.platform,
        connected_at = case
          when furr_presence.last_heartbeat_at is null
            or furr_presence.last_heartbeat_at < now() - interval '90 seconds'
          then now() else furr_presence.connected_at end,
        last_heartbeat_at = now()`;
    return { ok: true, at: new Date().toISOString() };
  });

export const goOffline = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await sql`
      update furr_presence set last_heartbeat_at = null, connected_at = null, last_seen_at = now()
      where user_id = ${context.userId}`;
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
    const me = await loadMe(context.userId);
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
  .handler(async () => bridgeStatus());

/** The deployed build id + its update history, so open apps can notice a newer FurrBox. */
export const getAppBuild = createServerFn({ method: "GET" }).handler(async () => ({
  build: __FURRBOX_BUILD__,
  updates: UPDATES as { date: string; version?: string; title: string; items: string[] }[],
}));
