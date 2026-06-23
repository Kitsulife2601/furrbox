"use client";

import { create } from "zustand";

export type FurrNotificationPayload = {
  version: string;
  title: string;
  description: string;
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
};

const notificationDurationMs = 5_000;

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],
  notify: (payload) => {
    const id = crypto.randomUUID();
    const notification: FurrNotification = {
      ...payload,
      id,
      createdAt: Date.now(),
      durationMs: notificationDurationMs
    };
    set((state) => ({ notifications: [notification, ...state.notifications].slice(0, 4) }));
    window.setTimeout(() => {
      set((state) => ({ notifications: state.notifications.filter((item) => item.id !== id) }));
    }, notificationDurationMs);
    return id;
  },
  dismiss: (id) => set((state) => ({ notifications: state.notifications.filter((item) => item.id !== id) }))
}));
