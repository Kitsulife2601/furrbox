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

export type AccountRole = "Member" | "Supporter" | "Fish Moderator" | "Fish Nagie Owner";

export type CreateUserPayload = {
  username: string;
  discordId: string;
  password?: string;
  role: AccountRole;
};

export type UpdateMemberIdPayload = {
  targetUserId: string;
  discordId: string;
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

export async function createAdminUser(token: string, payload: CreateUserPayload): Promise<void> {
  await authedFetch<{ user: PresenceUser }>("/api/admin/create-user", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function deleteAdminUser(token: string, targetUserId: string): Promise<void> {
  await authedFetch<{ ok: boolean }>("/api/admin/delete-user", token, {
    method: "DELETE",
    body: JSON.stringify({ targetUserId })
  });
}

export async function updateMemberDiscordId(token: string, payload: UpdateMemberIdPayload): Promise<void> {
  await authedFetch<{ user: PresenceUser }>("/api/admin/update-member-id", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
