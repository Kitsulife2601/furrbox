// VRChat Group Calendar Bridge – Events listen + starting-soon Hook.
// Auth läuft über den Discord-Bot (Cookie auf dem PC). Server hält Cache + Mock.
import { createServerFn } from "@tanstack/react-start";
import { accessMiddleware } from "../access";
import { appendAuditLater } from "../audit";
import { publishAlertLater } from "../alerts";
import { bridgeStatus, getSetting, getSql, iso, newId, requirePermission, setSetting } from "../core";
import { BOT_JOB_STALE_MSG } from "../http";
import { TtlCache } from "../cache";

export type CalendarEventDto = {
  id: string;
  groupId: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  category: string | null;
  imageUrl: string | null;
  source: string;
};

type ListResult = { events: CalendarEventDto[]; source: string; groupId: string | null };

const listCache = new TtlCache<ListResult>(8_000, 8);

/** Rate-Limits (VRChat API, Community-Docs): typisch soft ~1 Req/s; wir cachen und pollen idle. */
export const CALENDAR_RATE_NOTES = {
  endpoint: "GET https://api.vrchat.cloud/api/1/calendar/{groupId}",
  query: "date (month), n (1–100, default 60), offset",
  auth: "VRChat authCookie – nur Bot/Desktop, nie im Server speichern",
  serverPoll: "Refresh max. alle 5 min oder on-demand; List-Cache 8 s",
  mockDefault: true,
};

async function groupIdConfigured() {
  const fromSetting = (await getSetting("vrchat_calendar_group_id", "")).trim();
  if (fromSetting.startsWith("grp_")) return fromSetting;
  const sql = await getSql();
  const rows = await sql<{ group_id: string | null }>`select group_id from vrchat_connection where id = 1`;
  return rows[0]?.group_id?.startsWith("grp_") ? rows[0].group_id : null;
}

function mockEvents(groupId: string): CalendarEventDto[] {
  const now = Date.now();
  return [
    {
      id: "cal_mock_soon",
      groupId,
      title: "FurrBox Staff Huddle (Mock)",
      description: "Mock-Event – Bot-Refresh ersetzt dies, wenn vrchat_calendar_mock=false.",
      startsAt: new Date(now + 20 * 60_000).toISOString(),
      endsAt: new Date(now + 80 * 60_000).toISOString(),
      category: "social",
      imageUrl: null,
      source: "mock",
    },
    {
      id: "cal_mock_later",
      groupId,
      title: "Community Hangout (Mock)",
      description: null,
      startsAt: new Date(now + 2 * 24 * 3600_000).toISOString(),
      endsAt: new Date(now + 2 * 24 * 3600_000 + 2 * 3600_000).toISOString(),
      category: "hangout",
      imageUrl: null,
      source: "mock",
    },
  ];
}

async function loadCached(groupId: string): Promise<CalendarEventDto[]> {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    group_id: string;
    title: string;
    description: string | null;
    starts_at: unknown;
    ends_at: unknown;
    category: string | null;
    image_url: string | null;
    source: string;
  }>`
    select id, group_id, title, description, starts_at, ends_at, category, image_url, source
    from group_calendar_event
    where group_id = ${groupId} and starts_at > now() - interval '1 day'
    order by starts_at asc limit 100`;
  return rows.map((r) => ({
    id: r.id,
    groupId: r.group_id,
    title: r.title,
    description: r.description,
    startsAt: iso(r.starts_at) ?? "",
    endsAt: iso(r.ends_at),
    category: r.category,
    imageUrl: r.image_url,
    source: r.source,
  }));
}

export const getCalendarConfig = createServerFn({ method: "GET" })
  .middleware([accessMiddleware])
  .handler(async ({ context }) => {
    await requirePermission(context.userId, "canUseEvidence");
    const [groupId, mock, soon] = await Promise.all([
      groupIdConfigured(),
      getSetting("vrchat_calendar_mock", "true"),
      getSetting("calendar_soon_minutes", "30"),
    ]);
    return {
      groupId,
      mock: mock === "true",
      soonMinutes: Math.max(5, Math.min(180, Number(soon) || 30)),
      rateNotes: CALENDAR_RATE_NOTES,
    };
  });

export const setCalendarGroupId = createServerFn({ method: "POST" })
  .validator((groupId: string) => String(groupId ?? "").trim())
  .middleware([accessMiddleware])
  .handler(async ({ context, data: groupId }) => {
    await requirePermission(context.userId, "canManageVrchat");
    if (groupId && !groupId.startsWith("grp_")) throw new Error("Group-ID muss mit grp_ beginnen.");
    await setSetting("vrchat_calendar_group_id", groupId);
    listCache.clear();
    return { groupId: groupId || null };
  });

export const listGroupCalendar = createServerFn({ method: "GET" })
  .middleware([accessMiddleware])
  .handler(async ({ context }): Promise<ListResult> => {
    await requirePermission(context.userId, "canUseEvidence");
    const groupId = await groupIdConfigured();
    if (!groupId) return { events: [], source: "none", groupId: null };
    return listCache.get(groupId, async () => {
      const mock = (await getSetting("vrchat_calendar_mock", "true")) === "true";
      let events = await loadCached(groupId);
      let source = events[0]?.source ?? "cache";
      if (!events.length && mock) {
        events = mockEvents(groupId);
        source = "mock";
        const sql = await getSql();
        for (const e of events) {
          await sql`
            insert into group_calendar_event (id, group_id, title, description, starts_at, ends_at, category, image_url, source)
            values (${e.id}, ${e.groupId}, ${e.title}, ${e.description}, ${e.startsAt}, ${e.endsAt}, ${e.category}, ${e.imageUrl}, 'mock')
            on conflict (id) do update set title = excluded.title, starts_at = excluded.starts_at, updated_at = now()`;
        }
      }
      return { events, source, groupId };
    });
  });

/** Bot pusht Events nach Fetch (Bridge POST calendar-events). */
export async function replaceCalendarEvents(
  groupId: string,
  entries: Array<{
    id: string;
    title: string;
    description?: string | null;
    startsAt: string;
    endsAt?: string | null;
    category?: string | null;
    imageUrl?: string | null;
  }>,
) {
  const sql = await getSql();
  await sql`delete from group_calendar_event where group_id = ${groupId} and source <> 'mock'`;
  for (const e of entries.slice(0, 100)) {
    if (!e.id || !e.title || !e.startsAt) continue;
    await sql`
      insert into group_calendar_event (id, group_id, title, description, starts_at, ends_at, category, image_url, source)
      values (${e.id.slice(0, 80)}, ${groupId}, ${e.title.slice(0, 200)}, ${(e.description ?? "").slice(0, 1000) || null},
              ${e.startsAt}, ${e.endsAt ?? null}, ${e.category ?? null}, ${e.imageUrl ?? null}, 'vrchat')
      on conflict (id) do update set
        title = excluded.title, description = excluded.description, starts_at = excluded.starts_at,
        ends_at = excluded.ends_at, category = excluded.category, image_url = excluded.image_url,
        source = 'vrchat', updated_at = now()`;
  }
  listCache.clear();
  await setSetting("vrchat_calendar_mock", "false");
}

/** Enqueue Bot-Job calendar-fetch (wenn Bot online). */
export const refreshGroupCalendar = createServerFn({ method: "POST" })
  .middleware([accessMiddleware])
  .handler(async ({ context }) => {
    await requirePermission(context.userId, "canManageVrchat");
    const groupId = await groupIdConfigured();
    if (!groupId) throw new Error("Keine Group-ID – unter VRChat verbinden oder calendar groupId setzen.");
    const bot = await bridgeStatus();
    if (!bot.configured || !bot.connected) throw new Error(BOT_JOB_STALE_MSG);
    const sql = await getSql();
    const id = newId();
    await sql`
      insert into vrchat_job (id, kind, payload_json, requested_by)
      values (${id}, ${"calendar-fetch"}, ${JSON.stringify({ groupId })}, ${context.userId})`;
    appendAuditLater({
      source: "furrbox",
      action: "calendar.refresh",
      actorId: context.userId,
      detail: groupId,
    });
    return { jobId: id, groupId };
  });

/**
 * starting-soon Hook: Events in Fenster → Alert einmalig.
 * Aufruf idle-freundlich (z. B. aus Bridge-Queue max. 1×/min).
 */
export async function fireStartingSoonReminders() {
  const soonMin = Math.max(5, Math.min(180, Number(await getSetting("calendar_soon_minutes", "30")) || 30));
  const sql = await getSql();
  const rows = await sql<{ id: string; title: string; group_id: string; starts_at: unknown }>`
    select e.id, e.title, e.group_id, e.starts_at
    from group_calendar_event e
    left join group_calendar_reminder r on r.event_id = e.id and r.kind = 'starting_soon'
    where r.event_id is null
      and e.starts_at > now()
      and e.starts_at <= now() + (${soonMin}::int * interval '1 minute')
    order by e.starts_at limit 10`;
  for (const r of rows) {
    await sql`insert into group_calendar_reminder (event_id, kind) values (${r.id}, 'starting_soon') on conflict do nothing`;
    publishAlertLater({
      kind: "incident.mark",
      severity: "info",
      title: "Event startet bald",
      body: `${r.title} (in ≤ ${soonMin} Min.)`,
      dedupKey: `calsoon:${r.id}`,
      payload: { eventId: r.id, groupId: r.group_id, startsAt: iso(r.starts_at) },
      channels: ["bot", "desktop", "vr"],
    });
  }
  return { fired: rows.length, soonMin };
}

export const checkCalendarStartingSoon = createServerFn({ method: "POST" })
  .middleware([accessMiddleware])
  .handler(async ({ context }) => {
    await requirePermission(context.userId, "canUseEvidence");
    return fireStartingSoonReminders();
  });
