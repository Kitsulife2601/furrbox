// Replaces FurrBox's Socket.io client: heartbeat (presence), system notifications
// and incoming chat messages are polled from server functions.
import { playSound } from "@/lib/furr/sounds";
import { useEffect, useRef } from "react";
import { create } from "zustand";
import { latestIncoming } from "@/lib/furr/api/chat";
import { goOffline, heartbeat, listNotifications } from "@/lib/furr/api/session";
import { detectPlatform } from "@/lib/furr/client";
import { useDesktop } from "@/store/desktop";
import { useNotifications } from "@/store/notifications";

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

const HEARTBEAT_MS = 15_000;
const NOTIFY_MS = 10_000;
const CHAT_MS = 5_000;

export function useFurrSync(active: boolean) {
  const lastNotificationId = useRef<number | null>(null);
  const lastChatAt = useRef<string | null>(null);

  useEffect(() => {
    if (!active) return;
    const platform = detectPlatform();
    let stopped = false;

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

    void beat();
    void pollNotifications();
    void pollChat();
    const timers = [
      window.setInterval(beat, HEARTBEAT_MS),
      window.setInterval(pollNotifications, NOTIFY_MS),
      window.setInterval(pollChat, CHAT_MS),
    ];
    const onVisible = () => {
      if (document.visibilityState === "visible") void beat();
    };
    const onPageHide = () => void goOffline().catch(() => undefined);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      stopped = true;
      timers.forEach((t) => window.clearInterval(t));
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [active]);
}
