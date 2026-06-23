"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Socket } from "socket.io-client";
import type { ChatMessage, FurrFile, FurrUser, PresenceUser } from "@/lib/types";

type MobileTab = "home" | "files" | "chat" | "team";

type MobileStore = {
  token: string | null;
  user: FurrUser | null;
  socket: Socket | null;
  connected: boolean;
  tab: MobileTab;
  files: FurrFile[];
  presenceUsers: PresenceUser[];
  chatMessages: ChatMessage[];
  setSession: (token: string, user: FurrUser) => void;
  setSocket: (socket: Socket | null) => void;
  setConnected: (connected: boolean) => void;
  setTab: (tab: MobileTab) => void;
  setFiles: (files: FurrFile[]) => void;
  setPresenceUsers: (users: PresenceUser[]) => void;
  setChatMessages: (messages: ChatMessage[]) => void;
  addChatMessage: (message: ChatMessage) => void;
  logout: () => void;
};

export const useMobileStore = create<MobileStore>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      socket: null,
      connected: false,
      tab: "home",
      files: [],
      presenceUsers: [],
      chatMessages: [],
      setSession: (token, user) => set({ token, user }),
      setSocket: (socket) => set({ socket }),
      setConnected: (connected) => set({ connected }),
      setTab: (tab) => set({ tab }),
      setFiles: (files) => set({ files }),
      setPresenceUsers: (presenceUsers) => set({ presenceUsers }),
      setChatMessages: (chatMessages) => set({ chatMessages }),
      addChatMessage: (message) =>
        set((state) => ({
          chatMessages: state.chatMessages.some((item) => item.id === message.id) ? state.chatMessages : [...state.chatMessages, message]
        })),
      logout: () =>
        set((state) => {
          state.socket?.disconnect();
          return { token: null, user: null, socket: null, connected: false, files: [], presenceUsers: [], chatMessages: [], tab: "home" };
        })
    }),
    {
      name: "furrbox-mobile-session",
      partialize: (state) => ({ token: state.token, user: state.user, tab: state.tab })
    }
  )
);
