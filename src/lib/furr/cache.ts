// Kleine In-Memory-Caches für den Server (pro Prozess / Serverless-Instanz).
// Nur für Daten, bei denen wenige Sekunden Verzögerung unkritisch sind – nie für
// Moderations-Ergebnisse oder Job-Status. Fehler werden NICHT gecacht.

type Entry<T> = { at: number; promise: Promise<T> };

/**
 * TTL-Cache mit In-Flight-Dedup: parallele Aufrufe mit gleichem Key teilen sich
 * eine einzige DB-Abfrage. Abgelehnte Promises werden sofort verworfen.
 */
export class TtlCache<T> {
  private entries = new Map<string, Entry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 500,
  ) {}

  get(key: string, load: () => Promise<T>, ttlMs = this.ttlMs): Promise<T> {
    const now = Date.now();
    const hit = this.entries.get(key);
    if (hit && now - hit.at < ttlMs) return hit.promise;
    const promise = load();
    this.store(key, promise, now);
    return promise;
  }

  /** Frisch geladenen Wert übernehmen (z. B. nach einem Write). */
  set(key: string, value: T) {
    this.store(key, Promise.resolve(value), Date.now());
  }

  peek(key: string, ttlMs = this.ttlMs): Promise<T> | undefined {
    const hit = this.entries.get(key);
    return hit && Date.now() - hit.at < ttlMs ? hit.promise : undefined;
  }

  delete(key: string) {
    this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
  }

  private store(key: string, promise: Promise<T>, at: number) {
    if (this.entries.size >= this.maxEntries) this.prune(at);
    const entry = { at, promise };
    this.entries.set(key, entry);
    promise.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
  }

  private prune(now: number) {
    for (const [key, entry] of this.entries) {
      if (now - entry.at >= this.ttlMs) this.entries.delete(key);
    }
    // Immer noch voll: älteste Einträge (Map = Einfügereihenfolge) verwerfen.
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

/** Gibt `true` zurück, wenn seit dem letzten `true` mindestens `ms` vergangen sind. */
export function createThrottle(ms: number) {
  let last = 0;
  return (now = Date.now()) => {
    if (now - last < ms) return false;
    last = now;
    return true;
  };
}
