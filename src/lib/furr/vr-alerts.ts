// VR-Overlay: kleine Alert-Queue (max. 2), wake-on-event – kein Dauer-Polling.
// Speist sich aus lokalen Desktop-/Log-Ereignissen; Server-Bus kann später pushen.

export type VrAlertTone = "red" | "amber" | "blue" | "green";

export type VrAlert = {
  id: string;
  tone: VrAlertTone;
  title: string;
  text: string;
  /** Erzeugt um (ms). */
  at: number;
  /** Anzeige-Dauer (ms), typisch 3–5 s. */
  ttlMs: number;
  kind: "vote-result" | "watchlist-join" | "whitelist-fail" | "report" | "hint" | "clip" | "generic";
};

/** Short buzz on the arm (desktop app with SteamVR only; does nothing elsewhere or when switched off). */
export function vrHaptic(strong = false) {
  try {
    const bridge = (window as { furrbox?: { vr?: { haptic?(strong: boolean): Promise<boolean>; reveal?(ms: number): Promise<boolean> } } }).furrbox?.vr;
    // The panel may be hidden while nobody looks at it – an alarm brings it back for a moment.
    void bridge?.reveal?.(strong ? 12_000 : 6_000)?.catch(() => undefined);
    if (localStorage.getItem("furrbox-vr-haptic") === "off") return;
    void bridge?.haptic?.(strong)?.catch(() => undefined);
  } catch {
    // no desktop app
  }
}

const MAX_QUEUE = 2;
const DEFAULT_TTL = 4_000;

type Listener = (alerts: VrAlert[]) => void;

let queue: VrAlert[] = [];
const listeners = new Set<Listener>();
const seen = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function emit() {
  const snap = queue.slice();
  for (const l of listeners) l(snap);
}

function drop(id: string) {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  queue = queue.filter((a) => a.id !== id);
  emit();
}

/** Neuen Alert einreihen. Dedup über id; bei vollem Queue fällt der älteste weg. */
export function pushVrAlert(input: Omit<VrAlert, "at" | "ttlMs"> & { ttlMs?: number }) {
  if (seen.has(input.id)) return;
  seen.add(input.id);
  // Dedup-Set begrenzen
  if (seen.size > 80) {
    const dropIds = [...seen].slice(0, seen.size - 60);
    for (const id of dropIds) seen.delete(id);
  }
  const alert: VrAlert = {
    ...input,
    at: Date.now(),
    ttlMs: input.ttlMs ?? DEFAULT_TTL,
  };
  queue = [alert, ...queue.filter((a) => a.id !== alert.id)].slice(0, MAX_QUEUE);
  emit();
  if (alert.tone === "red" || alert.tone === "amber") vrHaptic(alert.tone === "red");
  const timer = setTimeout(() => drop(alert.id), alert.ttlMs);
  timers.set(alert.id, timer);
}

export function dismissVrAlert(id: string) {
  drop(id);
}

export function subscribeVrAlerts(listener: Listener) {
  listeners.add(listener);
  listener(queue.slice());
  return () => {
    listeners.delete(listener);
  };
}

export function clearVrAlerts() {
  for (const id of [...timers.keys()]) drop(id);
  queue = [];
  emit();
}
