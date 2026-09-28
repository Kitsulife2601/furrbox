import { create } from "zustand";

export type Toast = {
  id: string;
  version: string;
  title: string;
  description: string;
  createdAt: number;
  onClick?: () => void;
};

type NotificationStore = {
  toasts: Toast[];
  /** Info-Center history (newest first). */
  history: Toast[];
  notify: (payload: Omit<Toast, "id" | "createdAt"> & { id?: string }) => void;
  dismiss: (id: string) => void;
  clearHistory: () => void;
};

const DURATION_MS = 5_000;

export const useNotifications = create<NotificationStore>((set) => ({
  toasts: [],
  history: [],
  notify: (payload) => {
    const toast: Toast = { ...payload, id: payload.id ?? crypto.randomUUID(), createdAt: Date.now() };
    set((s) => ({
      toasts: [toast, ...s.toasts.filter((t) => t.id !== toast.id)].slice(0, 4),
      history: [toast, ...s.history.filter((t) => t.id !== toast.id)].slice(0, 50),
    }));
    window.setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== toast.id) })), DURATION_MS);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clearHistory: () => set({ history: [] }),
}));

export function notifyError(error: unknown, title = "Fehler") {
  useNotifications.getState().notify({
    version: "FurrBox",
    title,
    description: error instanceof Error ? error.message : String(error),
  });
}
