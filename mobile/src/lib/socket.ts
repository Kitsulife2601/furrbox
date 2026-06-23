"use client";

import { io } from "socket.io-client";
import { API_URL } from "@/lib/config";
import type { ChatMessage, PresenceUser } from "@/lib/types";
import { useMobileStore } from "@/store/mobile-store";

let heartbeat: ReturnType<typeof setInterval> | null = null;

export function connectMobileSocket(token: string) {
  const existing = useMobileStore.getState().socket;
  if (existing?.connected) return existing;

  existing?.disconnect();
  if (heartbeat) clearInterval(heartbeat);

  const socket = io(API_URL, {
    auth: { token },
    transports: ["websocket", "polling"]
  });

  socket.on("connect", () => {
    useMobileStore.getState().setConnected(true);
    socket.emit("presence:heartbeat");
    heartbeat = setInterval(() => socket.connected && socket.emit("presence:heartbeat"), 5000);
  });

  socket.on("disconnect", () => {
    useMobileStore.getState().setConnected(false);
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  });

  socket.on("chat:message", (message: ChatMessage) => {
    useMobileStore.getState().addChatMessage(message);
  });

  socket.on("presence:snapshot", ({ users }: { users?: PresenceUser[] }) => {
    if (Array.isArray(users)) useMobileStore.getState().setPresenceUsers(users);
  });

  socket.on("presence:update", ({ user }: { user?: PresenceUser }) => {
    if (!user) return;
    const current = useMobileStore.getState().presenceUsers;
    useMobileStore.getState().setPresenceUsers([user, ...current.filter((item) => item.id !== user.id)]);
  });

  useMobileStore.getState().setSocket(socket);
  return socket;
}
