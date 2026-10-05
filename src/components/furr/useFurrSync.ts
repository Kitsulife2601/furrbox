// Replaces FurrBox's Socket.io client: heartbeat (presence), system notifications
// and incoming chat messages are polled from server functions.
import { playSound } from "@/lib/furr/sounds";
import { useEffect, useRef } from "react";
import { create } from "zustand";
import { latestIncoming } from "@/lib/furr/api/chat";
import { goOffline, heartbeat, listNotifications } from "@/lib/furr/api/session";
import { detectPlatform } from "@/lib/furr/client";
import { useDesktop } from "@/store/desktop";
import { useNotifications, type NotifyKind } from "@/store/notifications";
import { pollAlerts } from "@/lib/furr/api/alerts-api";

/** Server-Alert-Bus (alerts.ts) → Info-Center-Gruppen. */
function alertKind(kind: string): NotifyKind {
  if (kind.startsWith("vote")) return "vote";
  if (kind.startsWith("whitelist")) return "whitelist";
  if (kind.startsWith("duty")) return "duty";
  if (kind === "chatbox.hint") return "system";
  return "incident";
}

type SyncState = {
  connected: boolean;
  lastSyncAt: string | null;
  unreadChat: number;
  set: (patch: Partial<Omit<SyncState, "set">>) => void;
};

export const useSync = create<SyncState>((set) => ({
  connected: false,
  lastSyncAt: null,
  unreadChat: 0,
  set: (patch) => set(patch),
}));

/** Aktiv (sichtbar + Nutzer aktiv / Chat offen) */
const HEARTBEAT_MS = 15_000;
const NOTIFY_MS = 10_000;
const CHAT_MS = 5_000;
/** Idle (sichtbar, aber ruhig) */
const HEARTBEAT_IDLE_MS = 45_000;
const NOTIFY_IDLE_MS = 30_000;
const CHAT_IDLE_MS = 15_000;
/**
 * Minimiert/versteckt: Heartbeat läuft gedrosselt weiter (Duty „Anwesend“ zählt nur mit frischem
 * Heartbeat < 15 Min., VRChat-Jobs brauchen ihn auch). Notify/Chat pausieren komplett.
 */
const HEARTBEAT_HIDDEN_MS = 60_000;
/** Nach so langer Ruhe → Idle-Backoff */
const IDLE_AFTER_MS = 45_000;

export function useFurrSync(active: boolean) {
  const lastNotificationId = useRef<number | null>(null);
  const lastChatAt = useRef<string | null>(null);
  const lastActivityAt = useRef(Date.now());
  const lastAlertId = useRef<string | null>(null);
  const alertBaseline = useRef(false);
  /** Kein Staff (pollAlerts → Rechtefehler): Alert-Polling für diese Sitzung aus. */
  const alertsOff = useRef(false);

  useEffect(() => {
    if (!active) return;
    const platform = detectPlatform();
    let stopped = false;
    let heartbeatTimer: number | undefined;
    let notifyTimer: number | undefined;
    let chatTimer: number | undefined;

    const markActivity = () => {
      lastActivityAt.current = Date.now();
    };

    const isHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

    const isIdle = () => {
      if (useDesktop.getState().chatOpen) return false;
      return Date.now() - lastActivityAt.current >= IDLE_AFTER_MS;
    };

    const beat = async () => {
      try {
        const res = await heartbeat({ data: platform });
        if (!stopped) useSync.getState().set({ connected: true, lastSyncAt: res.at });
      } catch {
        if (!stopped) useSync.getState().set({ connected: false });
      }
    };

    const pollNotifications = async () => {
      try {
        const items = await listNotifications({ data: lastNotificationId.current ?? 0 });
        if (lastNotificationId.current === null) {
          // First poll only establishes the baseline; no toast storm on login.
          lastNotificationId.current = items[0]?.id ?? 0;
          return;
        }
        for (const n of [...items].reverse()) {
          useNotifications.getState().notify({ id: `sys-${n.id}`, version: n.version, title: n.title, description: n.description });
        }
        if (items[0]) lastNotificationId.current = items[0].id;
      } catch {
        /* offline — heartbeat reports it */
      }
      // Team-Alerts (Votekick-Ergebnis, Bann/Undo, Incident, Duty leer …) im gleichen Takt – kein extra Timer.
      if (alertsOff.current) return;
      try {
        const { alerts } = await pollAlerts({ data: { afterId: lastAlertId.current, limit: 20 } });
        if (!alertBaseline.current) {
          // Baseline (neueste zuerst) – kein Toast-Sturm beim Login.
          alertBaseline.current = true;
          lastAlertId.current = alerts[0]?.id ?? null;
          return;
        }
        if (!alerts.length) return;
        // Mit afterId kommen die Alerts aufsteigend; ohne (noch nie einer) absteigend.
        const ordered = lastAlertId.current ? alerts : [...alerts].reverse();
        lastAlertId.current = ordered[ordered.length - 1].id;
        for (const a of ordered) {
          if (a.channels.length && !a.channels.includes("desktop")) continue;
          useNotifications.getState().notify({
            id: `alert-${a.id}`,
            version: "FurrBox · Team-Alert",
            kind: alertKind(a.kind),
            tone: a.severity === "critical" ? "alert" : a.severity === "warn" ? "info" : undefined,
            title: a.title,
            description: a.body,
          });
        }
      } catch (e) {
        if (/recht|erlaubt|permission|zugriff/i.test(String((e as Error)?.message ?? e))) alertsOff.current = true;
      }
    };

    const pollChat = async () => {
      try {
        const messages = await latestIncoming();
        const newest = messages[0]?.createdAt ?? null;
        if (lastChatAt.current === null) {
          lastChatAt.current = newest ?? new Date(0).toISOString();
          return;
        }
        const fresh = messages.filter((m) => m.createdAt > (lastChatAt.current ?? ""));
        if (!fresh.length) return;
        lastChatAt.current = fresh[0].createdAt;
        const chatOpen = useDesktop.getState().chatOpen;
        if (!chatOpen) {
          useSync.getState().set({ unreadChat: useSync.getState().unreadChat + fresh.length });
          const m = fresh[0];
          playSound("chat", { eventId: m.id });
          useNotifications.getState().notify({
            id: `chat-${m.id}`,
            version: m.channel === "team" ? "FurrChat · Team" : "FurrChat · Privat",
            title: m.senderName,
            description: m.content.length > 120 ? `${m.content.slice(0, 117)}…` : m.content,
            onClick: () => useDesktop.getState().toggleChat(true),
          });
        }
      } catch {
        /* ignore */
      }
    };

    const schedule = (
      kind: "heartbeat" | "notify" | "chat",
      run: () => Promise<void>,
      activeMs: number,
      idleMs: number,
    ) => {
      const arm = () => {
        if (stopped) return;
        const hidden = isHidden();
        // Versteckt: nur der Heartbeat läuft weiter (60 s), Notify/Chat pausieren bis visibilitychange.
        if (hidden && kind !== "heartbeat") return;
        const delay = hidden ? HEARTBEAT_HIDDEN_MS : isIdle() ? idleMs : activeMs;
        const id = window.setTimeout(async () => {
          if (stopped || (isHidden() && kind !== "heartbeat")) return;
          await run();
          arm();
        }, delay);
        if (kind === "heartbeat") heartbeatTimer = id;
        else if (kind === "notify") notifyTimer = id;
        else chatTimer = id;
      };
      arm();
    };

    const clearTimers = () => {
      if (heartbeatTimer !== undefined) window.clearTimeout(heartbeatTimer);
      if (notifyTimer !== undefined) window.clearTimeout(notifyTimer);
      if (chatTimer !== undefined) window.clearTimeout(chatTimer);
      heartbeatTimer = notifyTimer = chatTimer = undefined;
    };

    const startLoops = () => {
      clearTimers();
      if (stopped) return;
      if (isHidden()) {
        schedule("heartbeat", beat, HEARTBEAT_MS, HEARTBEAT_IDLE_MS);
        return;
      }
      void beat();
      void pollNotifications();
      void pollChat();
      schedule("heartbeat", beat, HEARTBEAT_MS, HEARTBEAT_IDLE_MS);
      schedule("notify", pollNotifications, NOTIFY_MS, NOTIFY_IDLE_MS);
      schedule("chat", pollChat, CHAT_MS, CHAT_IDLE_MS);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        markActivity();
        startLoops();
      } else {
        // Minimiert: Notify/Chat stoppen, Heartbeat gedrosselt (60 s) weiterlaufen lassen.
        startLoops();
      }
    };

    const onPageHide = () => void goOffline().catch(() => undefined);
    const onActivity = () => {
      const wasIdle = isIdle();
      markActivity();
      // Nach Idle sofort wieder auf kurze Intervalle, nicht erst nach dem restlichen Timeout.
      if (wasIdle && !isHidden()) startLoops();
    };

    startLoops();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    return () => {
      stopped = true;
      clearTimers();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
    };
  }, [active]);
}
