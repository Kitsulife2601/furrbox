"use client";

import { API_URL } from "@/lib/config";

export type ChatChannel = "team" | "private";

export type ChatMessage = {
  id: string;
  channel: ChatChannel;
  senderId: string;
  senderName: string;
  recipientId: string | null;
  recipientName: string | null;
  content: string;
  createdAt: string;
};

async function authedFetch<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init.headers }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Request failed." }));
    throw new Error(body.error || "Request failed.");
  }
  return response.json() as Promise<T>;
}

export async function getChatSettings(token: string) {
  return authedFetch<{ retentionDays: number }>("/api/chat/settings", token);
}

export async function updateChatSettings(token: string, retentionDays: number) {
  return authedFetch<{ retentionDays: number }>("/api/chat/settings", token, {
    method: "PUT",
    body: JSON.stringify({ retentionDays })
  });
}

export async function listChatMessages(token: string, channel: ChatChannel, partnerId?: string) {
  const params = new URLSearchParams({ channel });
  if (partnerId) params.set("partnerId", partnerId);
  const data = await authedFetch<{ messages: ChatMessage[] }>(`/api/chat/messages?${params.toString()}`, token);
  return data.messages;
}

export async function sendChatMessage(token: string, payload: { channel: ChatChannel; content: string; recipientId?: string }) {
  const data = await authedFetch<{ message: ChatMessage }>("/api/chat/messages", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return data.message;
}
