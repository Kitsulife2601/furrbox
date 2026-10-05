// Gemeinsamer Kurzzeit-Cache für die Presence-Liste (server-only).
// Presence wird von jedem offenen Client alle 5–15 s abgefragt; die Abfrage ist ein UNION über
// alle Profile + alle Discord-Mitglieder. Online-Fenster = 90 s → 4 s Cache ist unkritisch.
import { TtlCache } from "./cache";
import type { PresenceUser } from "./types";

export const PRESENCE_CACHE_MS = 4_000;

/** Key: "email" | "plain" (mit/ohne E-Mail-Spalte). */
export const presenceCache = new TtlCache<PresenceUser[]>(PRESENCE_CACHE_MS, 4);

/** Nach Bot-Pushes (members/presence) oder goOffline sofort neu laden. */
export function invalidatePresenceCache() {
  presenceCache.clear();
}
