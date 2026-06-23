import { API_URL } from "@/lib/config";

export type PresenceStatus = "online" | "offline";

export type PresenceUser = {
  id: string;
  username: string;
  displayName: string;
  discordId: string | null;
  discordUsername: string | null;
  nickname: string | null;
  roleName: string;
  roleNames: string[];
  status: PresenceStatus;
  isExeOnline: boolean;
  isDiscordOnline: boolean;
  discordStatus: "online" | "idle" | "dnd" | "offline";
  dualPresenceLabel: string;
  connectedAt: string | null;
  lastHeartbeatAt: string | null;
  lastSeenAt: string | null;
};

export type PresenceLog = {
  fileName: string;
  virtualPath: string;
  updatedAt: string;
  content: string;
};

export type ForceRegisterPayload = {
  discordId: string;
  displayName: string;
  role: "Dev" | "Fish Nagie Owner" | "Fish Moderator" | "Supporter" | "Member";
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

export async function listPresenceUsers(token: string, view: "team" | "global" = "global"): Promise<PresenceUser[]> {
  const data = await authedFetch<{ users: PresenceUser[] }>(`/api/presence/users?view=${view}`, token);
  return data.users;
}

export async function listPresenceLogs(token: string, discordId: string): Promise<PresenceLog[]> {
  const data = await authedFetch<{ logs: PresenceLog[] }>(`/api/presence/users/${encodeURIComponent(discordId)}/logs`, token);
  return data.logs;
}

export async function forceRegisterUser(token: string, payload: ForceRegisterPayload): Promise<void> {
  await authedFetch<{ user: unknown; member: unknown }>("/api/admin/force-register", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
