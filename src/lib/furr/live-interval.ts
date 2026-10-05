/** Sichtbarkeit + Live-Intervalle für React Query / Polling – spart CPU/Netz im Idle und bei verstecktem Fenster. */
import { useEffect, useState } from "react";

/** `true`, solange das Dokument sichtbar ist (`visibilityState === "visible"`). */
export function useDocumentVisible() {
  const [visible, setVisible] = useState(() =>
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  );
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}

/**
 * Für `refetchInterval`: liefert `ms` nur wenn der Tab sichtbar ist (und `enabled`),
 * sonst `false` → React Query pollt nicht.
 */
export function useLiveInterval(ms: number, enabled = true): number | false {
  const visible = useDocumentVisible();
  if (!enabled || !visible) return false;
  return ms;
}

/**
 * Isolierte Uhr: tickt nur in dieser Komponente/Hook, ohne die Desktop-Shell neu zu rendern.
 * `intervalMs` z. B. 1000 (Sekunden) oder 30_000 (nur HH:mm).
 */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
