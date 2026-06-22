"use client";

import { API_URL } from "@/lib/config";
import type { UserProfile } from "@/store/furrbox-store";

type AuthResponse = {
  token: string;
  user: UserProfile;
};

async function authRequest(path: string, body: Record<string, string>): Promise<AuthResponse> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Authentication failed.");
  return data as AuthResponse;
}

export function login(username: string, password: string) {
  return authRequest("/api/auth/login", { username, password });
}

export function register(username: string, displayName: string, password: string) {
  return authRequest("/api/auth/register", { username, displayName, password });
}

export async function me(token: string): Promise<UserProfile> {
  const response = await fetch(`${API_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Session expired.");
  return data.user as UserProfile;
}
