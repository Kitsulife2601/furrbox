"use client";

import { io } from "socket.io-client";
import { API_URL } from "@/lib/config";
import { useFurrBoxStore, type FurrFile } from "@/store/furrbox-store";

let initialized = false;
let activeToken: string | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function stopHeartbeat() {
  if (!heartbeatTimer) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function startHeartbeat(socket: ReturnType<typeof io>) {
  stopHeartbeat();
  socket.emit("presence:heartbeat");
  heartbeatTimer = setInterval(() => {
    if (socket.connected) socket.emit("presence:heartbeat");
  }, 5_000);
}

export function resetFurrSocket() {
  const state = useFurrBoxStore.getState();
  state.socket?.disconnect();
  stopHeartbeat();
  state.setSocket(null);
  state.setConnected(false);
  initialized = false;
  activeToken = null;
}

export function initFurrSocket(token: string) {
  if (initialized && activeToken === token) return;
  resetFurrSocket();
  initialized = true;
  activeToken = token;

  const socket = io(API_URL, {
    auth: { token },
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 600
  });

  const store = useFurrBoxStore.getState();
  store.setSocket(socket);

  socket.on("connect", () => {
    useFurrBoxStore.getState().setConnected(true);
    startHeartbeat(socket);
    socket.emit("terminal:create");
  });

  socket.on("disconnect", () => {
    stopHeartbeat();
    useFurrBoxStore.getState().setConnected(false);
  });

  socket.on("connect_error", () => {
    stopHeartbeat();
    useFurrBoxStore.getState().setConnected(false);
  });

  socket.on("file-uploaded", (file: FurrFile) => {
    const state = useFurrBoxStore.getState();
    if (file.scope === state.activeFileScope) state.addFile(file);
  });

  socket.on("files-refreshed", ({ files }: { reason: string; files: FurrFile[] }) => {
    const state = useFurrBoxStore.getState();
    state.setFiles(files.filter((file) => file.scope === state.activeFileScope));
  });

  socket.on("public-files-refreshed", ({ files }: { reason: string; files: FurrFile[] }) => {
    const state = useFurrBoxStore.getState();
    if (state.activeFileScope === "public") state.setFiles(files);
  });

  socket.on("ui-state", (state) => {
    useFurrBoxStore.getState().patchUi(state, false);
  });

  socket.on("terminal:data", (data: string) => {
    useFurrBoxStore.getState().appendTerminal(data);
  });

  socket.on("terminal:reset", () => {
    useFurrBoxStore.getState().setTerminal([]);
  });

  socket.on("terminal:profile", ({ activeProfileId, profiles }) => {
    if (!activeProfileId || !Array.isArray(profiles)) return;
    useFurrBoxStore.getState().setTerminalProfileState(activeProfileId, profiles);
  });

  socket.on("terminal:ready", ({ activeProfileId, profiles }) => {
    if (!activeProfileId || !Array.isArray(profiles)) return;
    useFurrBoxStore.getState().setTerminalProfileState(activeProfileId, profiles);
  });

  socket.on("discord:bot-status", (status) => {
    useFurrBoxStore.getState().setDiscordBotStatus({
      connected: Boolean(status?.connected),
      connectedAt: typeof status?.connectedAt === "string" ? status.connectedAt : undefined,
      disconnectedAt: typeof status?.disconnectedAt === "string" ? status.disconnectedAt : undefined
    });
  });
}
