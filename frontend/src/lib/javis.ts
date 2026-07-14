"use client";

import { API_URL } from "@/lib/config";

export type JavisRole = "user" | "assistant";

export type JavisMessage = {
  id: string;
  role: JavisRole;
  content: string;
  source?: "javis" | "llm";
  createdAt: string;
};

export type JavisStatus = {
  llmConfigured: boolean;
  model: string | null;
  reminders: { id: string; text: string; dueAt: number }[];
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

export async function getJavisStatus(token: string) {
  return authedFetch<JavisStatus>("/api/javis/status", token);
}

export async function sendJavisMessage(token: string, message: string, history: { role: JavisRole; content: string }[]) {
  return authedFetch<{ reply: string; source: "javis" | "llm" }>("/api/javis/chat", token, {
    method: "POST",
    body: JSON.stringify({ message, history })
  });
}
