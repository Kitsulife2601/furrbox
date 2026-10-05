// Einheitlicher Event-Feed (Changelog, System, VR, Bot) – baut auf Alert-Bus auf.
import { createServerFn } from "@tanstack/react-start";
import { accessMiddleware } from "../access";
import { listAlertsSince, publishAlert, type AlertKind, type AlertSeverity } from "../alerts";
import { getSql, iso, newId, requirePermission } from "../core";
import { TtlCache } from "../cache";

export type FeedEventType = "changelog" | "system" | "vr" | "bot" | "alert";

export type FeedEventDto = {
  id: string;
  type: FeedEventType;
  title: string;
  body: string;
  at: string;
  severity: string;
  sourceKind: string;
};

const feedCache = new TtlCache<FeedEventDto[]>(4_000, 8);

function mapAlertKind(kind: string): FeedEventType {
  if (kind.startsWith("duty.") || kind === "chatbox.hint") return "system";
  if (kind.startsWith("vote.") || kind === "watchlist.join") return "vr";
  if (kind === "whitelist.deny" || kind.startsWith("ban.") || kind === "sanction.change" || kind === "anti_troll") return "bot";
  if (kind === "changelog") return "changelog";
  return "alert";
}

/** GET/Listen: gemischter Feed, Idle-Hinweis suggestedPollMs. */
export const listEventFeed = createServerFn({ method: "GET" })
  .validator((input: { afterId?: string | null; limit?: number } | null) => ({
    afterId: input?.afterId ? String(input.afterId).trim() : null,
    limit: Math.min(100, Math.max(1, Number(input?.limit) || 30)),
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    await requirePermission(context.userId, "canUseEvidence");
    const key = `${data.afterId ?? ""}:${data.limit}`;
    const events = await feedCache.get(key, async () => {
      const alerts = await listAlertsSince(data.afterId, data.limit);
      return alerts.map(
        (a): FeedEventDto => ({
          id: a.id,
          type: mapAlertKind(a.kind),
          title: a.title,
          body: a.body,
          at: a.at,
          severity: a.severity,
          sourceKind: a.kind,
        }),
      );
    });
    return {
      events,
      suggestedPollMs: events.length ? 5_000 : 15_000,
      authNote: "Session wie übrige FurrBox-ServerFns (accessMiddleware). Bridge-Token nur für Bot-Queue.",
    };
  });

/** Stub-Push: Changelog- oder System-Event in den Alert-Bus. */
export const pushFeedEvent = createServerFn({ method: "POST" })
  .validator((input: { type: "changelog" | "system"; title: string; body?: string; severity?: AlertSeverity }) => ({
    type: input.type === "changelog" ? ("changelog" as const) : ("system" as const),
    title: String(input.title ?? "").trim().slice(0, 200),
    body: String(input.body ?? "").trim().slice(0, 1000),
    severity: (input.severity === "critical" || input.severity === "warn" ? input.severity : "info") as AlertSeverity,
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    await requirePermission(context.userId, "canManageVrchat");
    if (!data.title) throw new Error("Titel fehlt.");
    const id = await publishAlert({
      kind: (data.type === "changelog" ? "changelog" : "system.event") as AlertKind,
      title: data.type === "changelog" ? `[Changelog] ${data.title}` : data.title,
      body: data.body,
      severity: data.severity,
      dedupKey: `${data.type}:${data.title.slice(0, 40)}:${Math.floor(Date.now() / 60_000)}`,
      payload: { feedType: data.type },
      channels: ["desktop", "vr", "bot"],
    });
    feedCache.clear();
    return { id };
  });

/** Persistierte Changelog-Notizen (kurz, optional neben Alert). */
export const listChangelogNotes = createServerFn({ method: "GET" })
  .middleware([accessMiddleware])
  .handler(async ({ context }) => {
    await requirePermission(context.userId, "canUseEvidence");
    const sql = await getSql();
    try {
      const rows = await sql<{ id: string; title: string; body: string; created_at: unknown }>`
        select id, title, body, created_at from furr_changelog order by created_at desc limit 20`;
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        at: iso(r.created_at) ?? "",
      }));
    } catch {
      return [] as Array<{ id: string; title: string; body: string; at: string }>;
    }
  });

export const addChangelogNote = createServerFn({ method: "POST" })
  .validator((input: { title: string; body?: string }) => ({
    title: String(input.title ?? "").trim().slice(0, 200),
    body: String(input.body ?? "").trim().slice(0, 2000),
  }))
  .middleware([accessMiddleware])
  .handler(async ({ context, data }) => {
    await requirePermission(context.userId, "canManageVrchat");
    if (!data.title) throw new Error("Titel fehlt.");
    const sql = await getSql();
    const id = newId();
    try {
      await sql`insert into furr_changelog (id, title, body, created_by) values (${id}, ${data.title}, ${data.body}, ${context.userId})`;
    } catch {
      // Tabelle kommt mit 0018; ohne Migration nur Alert-Pfad
    }
    await publishAlert({
      kind: "incident.mark",
      title: `[Changelog] ${data.title}`,
      body: data.body,
      severity: "info",
      dedupKey: `changelog:${id}`,
      payload: { feedType: "changelog", noteId: id },
      channels: ["desktop", "vr", "bot"],
    });
    feedCache.clear();
    return { id };
  });

