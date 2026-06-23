"use client";

import { create } from "zustand";

export type FurrNotificationPayload = {
  version: string;
  title: string;
  description: string;
  progressPercent?: number;
  meta?: string;
  persist?: boolean;
  dedupeKey?: string;
};

export type FurrNotification = FurrNotificationPayload & {
  id: string;
  createdAt: number;
  durationMs: number;
};

type NotificationStore = {
  notifications: FurrNotification[];
  notify: (payload: FurrNotificationPayload) => string;
  dismiss: (id: string) => void;
  dismissByKey: (dedupeKey: string) => void;
};

const notificationDurationMs = 5_000;

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],
  notify: (payload) => {
    const id = payload.dedupeKey || crypto.randomUUID();
    const notification: FurrNotification = {
      ...payload,
      id,
      createdAt: Date.now(),
      durationMs: payload.persist ? Number.MAX_SAFE_INTEGER : notificationDurationMs
    };
    set((state) => {
      const existing = state.notifications.find((item) => item.id === id);
      if (existing) {
        return {
          notifications: state.notifications.map((item) =>
            item.id === id ? { ...existing, ...payload, id, durationMs: notification.durationMs } : item
          )
        };
      }
      return { notifications: [notification, ...state.notifications].slice(0, 4) };
    });
    if (!payload.persist) {
      window.setTimeout(() => {
        set((state) => ({ notifications: state.notifications.filter((item) => item.id !== id || item.persist) }));
      }, notificationDurationMs);
    }
    return id;
  },
  dismiss: (id) => set((state) => ({ notifications: state.notifications.filter((item) => item.id !== id) })),
  dismissByKey: (dedupeKey) => set((state) => ({ notifications: state.notifications.filter((item) => item.dedupeKey !== dedupeKey && item.id !== dedupeKey) }))
}));
