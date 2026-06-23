"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Socket } from "socket.io-client";

export type FurrFile = {
  id: string;
  name: string;
  originalName: string;
  displayName?: string;
  virtualPath?: string;
  size: number;
  mimeType: string;
  scope: "private" | "public";
  ownerId: string | null;
  uploadedAt: string;
  url: string;
};

export type WindowKey = "furrfs" | "terminal" | "settings" | "browser" | "evidence" | "presence" | "accounts";
export type Wallpaper = "bloom" | "aurora" | "ink";
export type AuthStage = "lock" | "login" | "desktop";
export type TerminalProfile = {
  id: "auto" | "linux-bash" | "linux-wsl" | "windows-powershell" | "windows-cmd";
  label: string;
  family: "linux" | "windows" | "auto";
  command: string;
  args: string[];
  available: boolean;
  reason?: string;
};
export type DiscordBotStatus = {
  connected: boolean;
  connectedAt?: string;
  disconnectedAt?: string;
};
export type UserProfile = {
  id: string;
  username: string;
  displayName: string;
  discordId?: string | null;
  sessionRole?: "Super_Admin" | "User";
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
  terminalProfiles: TerminalProfile[];
  activeTerminalProfileId: TerminalProfile["id"];
  discordBotStatus: DiscordBotStatus;
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
  setTerminal: (chunks: string[]) => void;
  appendTerminal: (data: string) => void;
  setTerminalProfileState: (activeProfileId: TerminalProfile["id"], profiles: TerminalProfile[]) => void;
  setDiscordBotStatus: (status: DiscordBotStatus) => void;
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
      terminalProfiles: [],
      activeTerminalProfileId: "auto",
      discordBotStatus: { connected: false },
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
      setTerminal: (terminal) => set({ terminal }),
      appendTerminal: (data) => set((state) => ({ terminal: [...state.terminal.slice(-180), data] })),
      setTerminalProfileState: (activeTerminalProfileId, terminalProfiles) => set({ activeTerminalProfileId, terminalProfiles }),
      setDiscordBotStatus: (discordBotStatus) => set({ discordBotStatus })
    }),
    {
      name: "furrbox-session",
      partialize: (state) => ({ token: state.token, user: state.user, wallpaper: state.wallpaper })
    }
  )
);
