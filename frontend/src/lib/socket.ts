"use client";

import { io } from "socket.io-client";
import { API_URL } from "@/lib/config";
import { useFurrBoxStore, type FurrFile } from "@/store/furrbox-store";

let initialized = false;
let activeToken: string | null = null;

export function resetFurrSocket() {
  const state = useFurrBoxStore.getState();
  state.socket?.disconnect();
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
    socket.emit("terminal:create");
  });

  socket.on("disconnect", () => {
    useFurrBoxStore.getState().setConnected(false);
  });

  socket.on("connect_error", () => {
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
}
