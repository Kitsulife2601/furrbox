// Soft-Notify-Kanal fuer Overlay (Changelog / Gruppen-Event).
// Getrennt von Staff-Alert-Queue (vr-alerts.ts, max 2 kritisch) – kein Kollisionsrisiko.
import { MOTION } from "@/lib/furr/motion";

export type VrSoftKind = "changelog" | "group-event" | "system";
export type VrSoftTone = "blue" | "green" | "amber";

export type VrSoftNotify = {
  id: string;
  kind: VrSoftKind;
  tone: VrSoftTone;
  title: string;
  text: string;
  at: number;
  ttlMs: number;
};

const MAX_QUEUE = 2;
const DEFAULT_TTL = MOTION.toastMs;

type Listener = (items: VrSoftNotify[]) => void;

let queue: VrSoftNotify[] = [];
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

/** Soft-Toast einreihen. Dedup ueber id; Staff-Alerts bleiben unberuehrt. */
export function pushVrSoftNotify(input: Omit<VrSoftNotify, "at" | "ttlMs"> & { ttlMs?: number }) {
  if (seen.has(input.id)) return;
  seen.add(input.id);
  if (seen.size > 60) {
    for (const id of [...seen].slice(0, seen.size - 40)) seen.delete(id);
  }
  const item: VrSoftNotify = {
    ...input,
    at: Date.now(),
    ttlMs: input.ttlMs ?? DEFAULT_TTL,
  };
  queue = [item, ...queue.filter((a) => a.id !== item.id)].slice(0, MAX_QUEUE);
  emit();
  timers.set(item.id, setTimeout(() => drop(item.id), item.ttlMs));
}

export function dismissVrSoftNotify(id: string) {
  drop(id);
}

export function subscribeVrSoftNotify(listener: Listener) {
  listeners.add(listener);
  listener(queue.slice());
  return () => {
    listeners.delete(listener);
  };
}
