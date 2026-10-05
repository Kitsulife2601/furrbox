// Shared server helpers: timeouts, consistent bridge JSON, background side-effects.
// Only import from createServerFn handlers or API routes (server-only).

export const UPSTREAM_TIMEOUT_MS = 8_000;
/** Soft ceiling so bridge/bot never waits on slow audit-log writes. */
export const SIDE_EFFECT_TIMEOUT_MS = 4_000;
/** Queued/dispatched bot jobs older than this are failed (same as bridge queue cleanup). */
export const BOT_JOB_STALE_MS = 12 * 60_000;
export const BOT_JOB_STALE_MSG = "Der Discord-Bot hat nicht reagiert. Läuft er auf dem PC?";

export class TimeoutError extends Error {
  readonly code = "TIMEOUT" as const;
  constructor(label = "Upstream") {
    super(`${label}: Zeitüberschreitung – Anfrage abgebrochen, damit nichts hängt.`);
    this.name = "TimeoutError";
  }
}

/** Rejects if `promise` takes longer than `ms`. Clears the timer on settle. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label?: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label)), ms);
    promise.then(
      (value) => {
        if (timer) clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** fetch with AbortSignal timeout (Discord / other upstreams). */
export async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = UPSTREAM_TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run a side-effect with a hard timeout; never throws.
 * Use after the critical DB write so the HTTP response stays fast.
 */
export async function runSideEffect(task: () => Promise<unknown>, label: string, ms = SIDE_EFFECT_TIMEOUT_MS): Promise<void> {
  try {
    await withTimeout(Promise.resolve().then(task), ms, label);
  } catch (err) {
    console.warn(`[furrbox] side-effect ${label} failed`, err instanceof Error ? err.message : err);
  }
}

function statusCode(status: number): string {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 408 || status === 504) return "TIMEOUT";
  if (status === 503) return "UNAVAILABLE";
  return "ERROR";
}

/** Bridge/bot JSON response – additive `code` field, same shapes as before. */
export function bridgeJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export function bridgeError(message: string, status: number, code?: string): Response {
  return bridgeJson({ ok: false, error: message, code: code ?? statusCode(status) }, status);
}

/** Safe JSON.parse – returns fallback instead of throwing. */
export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
