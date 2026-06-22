"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Socket } from "socket.io-client";

export type FurrFile = {
  id: string;
  name: string;
  originalName: string;
  size: number;
  mimeType: string;
  scope: "private" | "public";
  ownerId: string | null;
  uploadedAt: string;
  url: string;
};

export type WindowKey = "furrfs" | "terminal" | "settings";
export type Wallpaper = "bloom" | "aurora" | "ink";
export type AuthStage = "lock" | "login" | "desktop";
export type UserProfile = {
  id: string;
  username: string;
  displayName: string;
};

type UiState = {
  activeWindow: WindowKey;
  wallpaper: Wallpaper;
  startOpen: boolean;
};

type Store = UiState & {
  authStage: AuthStage;
  token: string | null;
  user: UserProfile | null;
  socket: Socket | null;
  connected: boolean;
  files: FurrFile[];
  activeFileScope: "private" | "public";
  uploadProgress: number;
  terminal: string[];
  setAuthStage: (stage: AuthStage) => void;
  setSession: (token: string, user: UserProfile) => void;
  logout: () => void;
  setSocket: (socket: Socket | null) => void;
  setConnected: (connected: boolean) => void;
  setFiles: (files: FurrFile[]) => void;
  setActiveFileScope: (scope: "private" | "public") => void;
  addFile: (file: FurrFile) => void;
  setUploadProgress: (progress: number) => void;
  patchUi: (patch: Partial<UiState>, broadcast?: boolean) => void;
  appendTerminal: (data: string) => void;
};

export const useFurrBoxStore = create<Store>()(
  persist(
    (set, get) => ({
      authStage: "lock",
      token: null,
      user: null,
      socket: null,
      connected: false,
      files: [],
      activeFileScope: "private",
      uploadProgress: 0,
      terminal: ["FurrBox shared terminal initializing...\r\n"],
      activeWindow: "furrfs",
      wallpaper: "bloom",
      startOpen: false,
      setAuthStage: (authStage) => set({ authStage }),
      setSession: (token, user) => set({ token, user, authStage: "desktop" }),
      logout: () => {
        get().socket?.disconnect();
        set({ token: null, user: null, socket: null, connected: false, files: [], terminal: [], authStage: "login" });
      },
      setSocket: (socket) => set({ socket }),
      setConnected: (connected) => set({ connected }),
      setFiles: (files) => set({ files }),
      setActiveFileScope: (activeFileScope) => set({ activeFileScope }),
      addFile: (file) => set((state) => ({ files: [file, ...state.files.filter((item) => item.id !== file.id)] })),
      setUploadProgress: (uploadProgress) => set({ uploadProgress }),
      patchUi: (patch, broadcast = true) => {
        set(patch);
        if (broadcast) get().socket?.emit("ui-state:update", patch);
      },
      appendTerminal: (data) => set((state) => ({ terminal: [...state.terminal.slice(-180), data] }))
    }),
    {
      name: "furrbox-session",
      partialize: (state) => ({ token: state.token, user: state.user, wallpaper: state.wallpaper })
    }
  )
);
