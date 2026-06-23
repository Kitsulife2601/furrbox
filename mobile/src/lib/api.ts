import { API_URL } from "@/lib/config";
import type { ChatMessage, FurrFile, FurrUser, PresenceUser } from "@/lib/types";

type AuthResponse = {
  token: string;
  user: FurrUser;
};

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = typeof data?.error === "string" ? data.error : `Request failed (${response.status}).`;
    throw new Error(error);
  }
  return data as T;
}

export async function login(username: string, password: string) {
  const response = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  return readJson<AuthResponse>(response);
}

export async function me(token: string) {
  const response = await fetch(`${API_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  return readJson<{ user: FurrUser }>(response);
}

export async function listFiles(token: string, scope: "private" | "public") {
  const response = await fetch(`${API_URL}/api/files?scope=${scope}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  const data = await readJson<{ files: FurrFile[] }>(response);
  return data.files;
}

export async function uploadFile(token: string, scope: "private" | "public", file: File) {
  const form = new FormData();
  form.append("scope", scope);
  form.append("virtualPath", scope === "public" ? "Public/Mobile Uploads" : "Dokumente/Mobile Uploads");
  form.append("file", file);
  const response = await fetch(`${API_URL}/api/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  const data = await readJson<{ file: FurrFile }>(response);
  return data.file;
}

export async function listPresenceUsers(token: string, view: "team" | "global" = "team") {
  const response = await fetch(`${API_URL}/api/presence/users?view=${view}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  const data = await readJson<{ users: PresenceUser[] }>(response);
  return data.users;
}

export async function listChatMessages(token: string, channel: "team" | "private", partnerId?: string) {
  const params = new URLSearchParams({ channel });
  if (partnerId) params.set("partnerId", partnerId);
  const response = await fetch(`${API_URL}/api/chat/messages?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  const data = await readJson<{ messages: ChatMessage[] }>(response);
  return data.messages;
}

export async function sendChatMessage(token: string, payload: { channel: "team" | "private"; content: string; recipientId?: string }) {
  const response = await fetch(`${API_URL}/api/chat/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
  const data = await readJson<{ message: ChatMessage }>(response);
  return data.message;
}
