// Watchlist / Personenakte auf usr_-ID. Sightings kommen von Desktop/Bridge – kein Server-Polling.
import { createServerFn } from "@tanstack/react-start";
import { accessMiddleware } from "../access";
import { appendAuditLater } from "../audit";
import { publishAlertLater } from "../alerts";
import { getSetting, getSql, iso, newId, requirePermission } from "../core";
import { TtlCache } from "../cache";

const USR = /^usr_[0-9a-f-]{36}$/i;
const watchCache = new TtlCache<Set<string>>(30_000, 4);

export type WatchlistEntryDto = {
  usrId: string;
  displayName: string | null;
  note: string;
  alarmJoin: boolean;
  addedBy: string;
  createdAt: string;
};

export type SightingDto = {
  id: string;
  usrId: string;
  displayName: string | null;
  kind: string;
  world: string | null;
  instanceId: string | null;
  hopping: boolean;
  source: string;
  seenAt: string;
};

async function watchedSet() {
  return watchCache.get("all", async () => {
    const sql = await getSql();
    const rows = await sql<{ usr_id: string }>`select usr_id from watchlist_entry`;
    return new Set(rows.map((r) => r.usr_id));
  });
}

export function invalidateWatchlistCache() {
  watchCache.clear();
}

export const listWatchlist = createServerFn({ method: "GET" })
  .middleware([accessMiddleware])
  .handler(async ({ context }): Promise<WatchlistEntryDto[]> => {
    await requirePermission(context.userId, "canUseEvidence");
    const sql = await getSql();
    const rows = await sql<{
      usr_id: string;
      display_name: string | null;
      note: string;
      alarm_join: boolean;
      added_by: string;
      created_at: unknown;
    }>`select usr_id, display_name, note, alarm_join, added_by, created_at from watchlist_entry order by created_at desc`;
    return rows.map((r) => ({
      usrId: r.usr_id,
      displayName: r.display_name,
      note: r.note,
      alarmJoin: Boolean(r.alarm_join),
      addedBy: r.added_by,
      createdAt: iso(r.created_at) ?? "",
    }));
  });

export const addToWatchlist = createServerFn({ method: "POST" })
  .validator((input: { usrId: string; displayName?: string; note?: string; alarmJoin?: boolean }) => ({
    usrId: String(input.usrId ?? "").trim(),
    displayName: input.displayName ? String(input.displayName).trim().slice(0, 100) : null,
    note: String(input.note ?? "").trim().slice(0, 500),
    alarmJoin: input.alarmJoin !== false,
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    await requirePermission(context.userId, "canUseEvidence");
    if (!USR.test(data.usrId)) throw new Error("usr_-ID ungültig.");
    const sql = await getSql();
    await sql`
      insert into watchlist_entry (usr_id, display_name, note, alarm_join, added_by)
      values (${data.usrId}, ${data.displayName}, ${data.note}, ${data.alarmJoin}, ${context.userId})
      on conflict (usr_id) do update set
        display_name = coalesce(excluded.display_name, watchlist_entry.display_name),
        note = excluded.note, alarm_join = excluded.alarm_join`;
    invalidateWatchlistCache();
    appendAuditLater({
      source: "furrbox",
      action: "watchlist.add",
      actorId: context.userId,
      targetId: data.usrId,
      targetName: data.displayName,
      detail: data.note || null,
    });
    return { ok: true as const };
  });

export const removeFromWatchlist = createServerFn({ method: "POST" })
  .validator((usrId: string) => String(usrId ?? "").trim())
  .middleware([accessMiddleware])
  .handler(async ({ context, data: usrId }) => {
    await requirePermission(context.userId, "canUseEvidence");
    const sql = await getSql();
    await sql`delete from watchlist_entry where usr_id = ${usrId}`;
    invalidateWatchlistCache();
    appendAuditLater({
      source: "furrbox",
      action: "watchlist.remove",
      actorId: context.userId,
      targetId: usrId,
    });
    return { ok: true as const };
  });

/**
 * Desktop/Bridge meldet Join/Leave aus bestehendem VRChat-Log – Server pollt nicht.
 * Rejoin innerhalb hop_window → hopping-Flag + optional Anti-Troll.
 */
export const reportWatchlistSighting = createServerFn({ method: "POST" })
  .validator(
    (input: {
      usrId: string;
      displayName?: string;
      kind?: "join" | "leave" | "rejoin";
      world?: string;
      instanceId?: string;
      source?: "desktop" | "bridge" | "vr";
      at?: string;
    }) => ({
      usrId: String(input.usrId ?? "").trim(),
      displayName: input.displayName ? String(input.displayName).trim().slice(0, 100) : null,
      kind: (input.kind === "leave" || input.kind === "rejoin" ? input.kind : "join") as "join" | "leave" | "rejoin",
      world: input.world ? String(input.world).trim().slice(0, 150) : null,
      instanceId: input.instanceId ? String(input.instanceId).trim().slice(0, 120) : null,
      source: (input.source === "bridge" || input.source === "vr" ? input.source : "desktop") as "desktop" | "bridge" | "vr",
      at: input.at ? String(input.at) : null,
    }),
  )
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    await requirePermission(context.userId, "canUseEvidence");
    if (!USR.test(data.usrId)) throw new Error("usr_-ID ungültig.");
    const watched = await watchedSet();
    const onList = watched.has(data.usrId);
    const sql = await getSql();
    const hopSec = Math.max(30, Number(await getSetting("watchlist_hop_window_sec", "90")) || 90);

    const recent = await sql<{ id: string; kind: string; seen_at: unknown }>`
      select id, kind, seen_at from watchlist_sighting
      where usr_id = ${data.usrId} and seen_at > now() - (${hopSec}::int * interval '1 second')
      order by seen_at desc limit 5`;
    const hopping =
      data.kind !== "leave" &&
      recent.some((r) => r.kind === "join" || r.kind === "rejoin");

    const id = newId();
    const seenAt = data.at && !Number.isNaN(Date.parse(data.at)) ? data.at : new Date().toISOString();
    await sql`
      insert into watchlist_sighting (id, usr_id, display_name, kind, world, instance_id, hopping, source, seen_at)
      values (${id}, ${data.usrId}, ${data.displayName}, ${hopping && data.kind === "join" ? "rejoin" : data.kind},
              ${data.world}, ${data.instanceId}, ${hopping}, ${data.source}, ${seenAt})`;

    if (onList && data.kind !== "leave") {
      const entry = await sql<{ note: string; alarm_join: boolean; display_name: string | null }>`
        select note, alarm_join, display_name from watchlist_entry where usr_id = ${data.usrId}`;
      if (entry[0]?.alarm_join) {
        publishAlertLater({
          kind: "watchlist.join",
          severity: hopping ? "critical" : "warn",
          title: hopping ? "Watchlist: Rejoin-Hopping" : "Watchlist: Join",
          body: `${data.displayName || entry[0].display_name || data.usrId}${data.world ? ` @ ${data.world}` : ""}`,
          dedupKey: `wl:${data.usrId}:${data.kind}:${Math.floor(Date.now() / 30_000)}`,
          payload: { usrId: data.usrId, hopping, sightingId: id, note: entry[0].note },
        });
      }
    }

    if (hopping) {
      // Anti-Troll Signal – kein Auto-Ban.
      const existing = await sql<{ id: string; score: number }>`
        select id, score from anti_troll_flag
        where target_key = ${data.usrId} and kind = 'rejoin_hopping'
          and updated_at > now() - interval '24 hours'
        order by updated_at desc limit 1`;
      let score = 1;
      if (existing[0]) {
        score = existing[0].score + 1;
        await sql`
          update anti_troll_flag set score = ${score}, updated_at = now(), detail = ${data.world}, notified_bot = false
          where id = ${existing[0].id}`;
      } else {
        await sql`
          insert into anti_troll_flag (id, target_key, platform, kind, score, detail)
          values (${newId()}, ${data.usrId}, 'vrchat', 'rejoin_hopping', 1, ${data.world})`;
      }
      if (score >= 3) {
        publishAlertLater({
          kind: "anti_troll",
          severity: "warn",
          title: "Anti-Troll: Rejoin-Hopping",
          body: `${data.displayName || data.usrId} – Score ${score}`,
          dedupKey: `at:${data.usrId}:hop`,
          payload: { targetKey: data.usrId, kind: "rejoin_hopping", score },
          channels: ["bot", "desktop"],
        });
      }
    }

    return { id, onList, hopping };
  });

export const listWatchlistSightings = createServerFn({ method: "GET" })
  .validator((input: { usrId?: string; limit?: number } | null) => ({
    usrId: input?.usrId ? String(input.usrId).trim() : null,
    limit: Math.min(100, Math.max(1, Number(input?.limit) || 40)),
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }): Promise<SightingDto[]> => {
    await requirePermission(context.userId, "canUseEvidence");
    const sql = await getSql();
    const rows = data.usrId
      ? await sql<{
          id: string;
          usr_id: string;
          display_name: string | null;
          kind: string;
          world: string | null;
          instance_id: string | null;
          hopping: boolean;
          source: string;
          seen_at: unknown;
        }>`
          select id, usr_id, display_name, kind, world, instance_id, hopping, source, seen_at
          from watchlist_sighting where usr_id = ${data.usrId}
          order by seen_at desc limit ${data.limit}`
      : await sql<{
          id: string;
          usr_id: string;
          display_name: string | null;
          kind: string;
          world: string | null;
          instance_id: string | null;
          hopping: boolean;
          source: string;
          seen_at: unknown;
        }>`
          select id, usr_id, display_name, kind, world, instance_id, hopping, source, seen_at
          from watchlist_sighting order by seen_at desc limit ${data.limit}`;
    return rows.map((r) => ({
      id: r.id,
      usrId: r.usr_id,
      displayName: r.display_name,
      kind: r.kind,
      world: r.world,
      instanceId: r.instance_id,
      hopping: Boolean(r.hopping),
      source: r.source,
      seenAt: iso(r.seen_at) ?? "",
    }));
  });
