// Verzögerte, rückgängig machbare Aktionen (z. B. Bann): erst nach UNDO_MS wird wirklich ausgeführt.
// Läuft unabhängig vom Fenster – wer das Fenster schließt, bannt trotzdem (der Toast bietet weiter „Rückgängig“).
import { create } from "zustand";
import { useNotifications } from "@/store/notifications";

export const UNDO_MS = 10_000;

export type PendingAction = { id: string; label: string; runAt: number };

type UndoStore = {
  pending: PendingAction[];
  add: (p: PendingAction) => void;
  remove: (id: string) => void;
};

export const useUndo = create<UndoStore>((set) => ({
  pending: [],
  add: (p) => set((s) => ({ pending: [...s.pending.filter((x) => x.id !== p.id), p] })),
  remove: (id) => set((s) => ({ pending: s.pending.filter((x) => x.id !== id) })),
}));

const timers = new Map<string, number>();

/**
 * Plant `run` in UNDO_MS. Gibt `cancel` zurück. Zeigt einen 10-s-Toast mit „Rückgängig“.
 * `onDone`/`onError` werden nach der echten Ausführung aufgerufen.
 */
export function scheduleWithUndo(opts: {
  label: string;
  description: string;
  run: () => Promise<void>;
  onDone?: () => void;
  onError?: (error: unknown) => void;
  onCancel?: () => void;
  ms?: number;
}) {
  const id = crypto.randomUUID();
  const ms = opts.ms ?? UNDO_MS;
  const notifications = useNotifications.getState();
  const cancel = () => {
    const t = timers.get(id);
    if (t === undefined) return false;
    window.clearTimeout(t);
    timers.delete(id);
    useUndo.getState().remove(id);
    notifications.dismiss(`undo-${id}`);
    useNotifications.getState().notify({
      id: `undo-${id}-cancel`,
      version: "FurrBox",
      kind: "incident",
      tone: "success",
      title: "Rückgängig gemacht",
      description: `${opts.label} wurde nicht ausgeführt.`,
    });
    opts.onCancel?.();
    return true;
  };
  const t = window.setTimeout(() => {
    timers.delete(id);
    useUndo.getState().remove(id);
    void opts.run().then(
      () => opts.onDone?.(),
      (error) => opts.onError?.(error),
    );
  }, ms);
  timers.set(id, t);
  useUndo.getState().add({ id, label: opts.label, runAt: Date.now() + ms });
  notifications.notify({
    id: `undo-${id}`,
    version: "FurrBox · Moderation",
    kind: "incident",
    tone: "alert",
    title: `${opts.label} in ${Math.round(ms / 1000)} s`,
    description: opts.description,
    actionLabel: "Rückgängig",
    durationMs: ms,
    onClick: () => void cancel(),
  });
  return { id, cancel };
}
