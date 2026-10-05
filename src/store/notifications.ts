import { create } from "zustand";
import { MOTION } from "@/lib/furr/motion";

export type Toast = {
  id: string;
  version: string;
  title: string;
  description: string;
  createdAt: number;
  onClick?: () => void;
  /** Fade-out in progress (MOTION.toastOutMs). */
  exiting?: boolean;
};

type NotificationStore = {
  toasts: Toast[];
  /** Info-Center history (newest first). */
  history: Toast[];
  notify: (payload: Omit<Toast, "id" | "createdAt" | "exiting"> & { id?: string }) => void;
  dismiss: (id: string) => void;
  clearHistory: () => void;
};

const DURATION_MS = MOTION.toastMs;
const OUT_MS = MOTION.toastOutMs;

function beginExit(id: string, set: (fn: (s: NotificationStore) => Partial<NotificationStore>) => void) {
  set((s) => ({
    toasts: s.toasts.map((t) => (t.id === id ? { ...t, exiting: true } : t)),
  }));
  window.setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), OUT_MS);
}

export const useNotifications = create<NotificationStore>((set) => ({
  toasts: [],
  history: [],
  notify: (payload) => {
    const toast: Toast = { ...payload, id: payload.id ?? crypto.randomUUID(), createdAt: Date.now() };
    set((s) => ({
      toasts: [toast, ...s.toasts.filter((t) => t.id !== toast.id)].slice(0, 4),
      history: [toast, ...s.history.filter((t) => t.id !== toast.id)].slice(0, 50),
    }));
    window.setTimeout(() => beginExit(toast.id, set), DURATION_MS);
  },
  dismiss: (id) => beginExit(id, set),
  clearHistory: () => set({ history: [] }),
}));

export function notifyError(error: unknown, title = "Fehler") {
  useNotifications.getState().notify({
    version: "FurrBox",
    title,
    description: error instanceof Error ? error.message : String(error),
  });
}
