import { create } from "zustand";
import { MOTION } from "@/lib/furr/motion";
import { sendXsoNotification } from "@/lib/furr/xsoverlay";

/** Alert-Typen für Toasts + Info-Center-Filter (Windows-ähnliche Benachrichtigungsgruppen). */
export type NotifyKind = "vote" | "whitelist" | "incident" | "duty" | "chat" | "clip" | "update" | "system";

export const NOTIFY_KIND_LABEL: Record<NotifyKind, string> = {
  vote: "Votekick",
  whitelist: "Whitelist",
  incident: "Fälle",
  duty: "Anwesenheit",
  chat: "Chat",
  clip: "Clips",
  update: "Updates",
  system: "System",
};

export type Toast = {
  id: string;
  version: string;
  title: string;
  description: string;
  createdAt: number;
  /** Gruppe für Info-Center-Filter; fehlt → aus id/version abgeleitet. */
  kind?: NotifyKind;
  /** Ton/Akzent: Fehler rot, Erfolg grün. */
  tone?: "info" | "success" | "error" | "alert";
  /** Anzeigedauer (Standard MOTION.toastMs) – z. B. 10 s für „Rückgängig“. */
  durationMs?: number;
  /** Beschriftung des Klick-Ziels (z. B. „Rückgängig“, „Öffnen“). */
  actionLabel?: string;
  onClick?: () => void;
  /** Nur ins Info-Center (kein Toast) – z. B. wenn ein eigenes Panel den Alarm zeigt. */
  silent?: boolean;
  /** Fade-out in progress (MOTION.toastOutMs). */
  exiting?: boolean;
};

type NotifyPayload = Omit<Toast, "id" | "createdAt" | "exiting"> & { id?: string; kind?: NotifyKind };

type NotificationStore = {
  toasts: Toast[];
  /** Info-Center history (newest first). */
  history: Toast[];
  /** Zeitpunkt, an dem das Info-Center zuletzt geöffnet war (für „neu“-Badge). */
  seenAt: number;
  notify: (payload: NotifyPayload) => void;
  dismiss: (id: string) => void;
  removeHistory: (id: string) => void;
  clearHistory: (kind?: NotifyKind) => void;
  markSeen: () => void;
};

const DURATION_MS = MOTION.toastMs;
const OUT_MS = MOTION.toastOutMs;

/** Leitet den Typ aus bestehenden ids/Versionen ab, damit alte Aufrufer ohne `kind` korrekt einsortiert werden. */
export function kindOf(t: Pick<Toast, "id" | "version" | "kind">): NotifyKind {
  if (t.kind) return t.kind;
  const id = t.id;
  const v = t.version.toLowerCase();
  if (id.startsWith("vote-") || v.includes("votekick")) return "vote";
  if (id.startsWith("chat-") || v.includes("furrchat")) return "chat";
  if (id.startsWith("clip-") || v.startsWith("clips")) return "clip";
  if (v.includes("whitelist")) return "whitelist";
  if (v.includes("evidence") || v.includes("fall")) return "incident";
  if (v.includes("anwesen") || v.includes("duty")) return "duty";
  if (v.includes("update")) return "update";
  return "system";
}

function beginExit(id: string, set: (fn: (s: NotificationStore) => Partial<NotificationStore>) => void) {
  set((s) => ({
    toasts: s.toasts.map((t) => (t.id === id ? { ...t, exiting: true } : t)),
  }));
  window.setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), OUT_MS);
}

export const useNotifications = create<NotificationStore>((set) => ({
  toasts: [],
  history: [],
  seenAt: Date.now(),
  notify: (payload) => {
    const base = { ...payload, id: payload.id ?? crypto.randomUUID(), createdAt: Date.now() };
    const toast: Toast = { ...base, kind: kindOf(base) };
    set((s) => ({
      toasts: payload.silent ? s.toasts : [toast, ...s.toasts.filter((t) => t.id !== toast.id)].slice(0, 4),
      history: [toast, ...s.history.filter((t) => t.id !== toast.id)].slice(0, 80),
    }));
    if (payload.silent) return;
    // Optional: Alert an XSOverlay (Default aus, fail-silent).
    const sev = toast.tone === "error" || toast.tone === "alert" || toast.kind === "vote" || toast.kind === "incident";
    void sendXsoNotification({
      title: toast.title,
      content: toast.description,
      timeout: Math.max(3, Math.round((payload.durationMs ?? DURATION_MS) / 1000)),
      audioPath: sev ? "default" : "",
    });
    window.setTimeout(() => beginExit(toast.id, set), payload.durationMs ?? DURATION_MS);
  },
  dismiss: (id) => beginExit(id, set),
  removeHistory: (id) => set((s) => ({ history: s.history.filter((t) => t.id !== id) })),
  clearHistory: (kind) => set((s) => ({ history: kind ? s.history.filter((t) => kindOf(t) !== kind) : [] })),
  markSeen: () => set({ seenAt: Date.now() }),
}));

export function notifyError(error: unknown, title = "Fehler") {
  useNotifications.getState().notify({
    version: "FurrBox",
    title,
    tone: "error",
    description: error instanceof Error ? error.message : String(error),
  });
}
