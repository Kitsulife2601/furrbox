"use client";

import { API_URL } from "@/lib/config";
import type { FurrFile } from "@/store/furrbox-store";

export type EvidencePayload = {
  platform: "Discord" | "VRChat";
  targetPrimary: string;
  targetDiscordId?: string;
  targetDisplayName?: string;
  targetSecondary: string;
  messageId?: string;
  messageProof?: DiscordMessageProof | null;
  violationCategory: string;
  notes: string;
  files: File[];
};

export type DiscordMemberOption = {
  discordId: string;
  username: string;
  nickname: string | null;
  displayName: string;
  label: string;
  roles: string[];
  roleNames: string[];
  highestPrivilege: string;
};

export type DiscordMessageProof = {
  requestId: string;
  messageId: string;
  found: boolean;
  content: string;
  authorId?: string;
  authorName?: string;
  channelId?: string;
  channelName?: string;
  createdAt?: string;
  error?: string;
};

export type EvidenceResponse = {
  caseId: string;
  casePath: string;
  files: FurrFile[];
};

export async function saveEvidenceCase(token: string, payload: EvidencePayload): Promise<EvidenceResponse> {
  const form = new FormData();
  form.append("platform", payload.platform);
  form.append("targetPrimary", payload.targetPrimary);
  if (payload.targetDiscordId) form.append("targetDiscordId", payload.targetDiscordId);
  if (payload.targetDisplayName) form.append("targetDisplayName", payload.targetDisplayName);
  form.append("targetSecondary", payload.targetSecondary);
  if (payload.messageId) form.append("messageId", payload.messageId);
  if (payload.messageProof) form.append("messageProof", JSON.stringify(payload.messageProof));
  form.append("violationCategory", payload.violationCategory);
  form.append("notes", payload.notes);
  for (const file of payload.files) form.append("evidence", file);

  const response = await fetch(`${API_URL}/api/evidence`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Failed to save evidence case.");
  return data as EvidenceResponse;
}

export async function listDiscordMembers(token: string): Promise<DiscordMemberOption[]> {
  const response = await fetch(`${API_URL}/api/discord/members`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Failed to load Discord members.");
  return data.members as DiscordMemberOption[];
}

export async function inspectDiscordMessage(token: string, messageId: string): Promise<DiscordMessageProof> {
  const response = await fetch(`${API_URL}/api/discord/message-inspect`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messageId })
  });
  const data = await response.json();
  if (!response.ok && !data.message) throw new Error(data.error || "Message inspection failed.");
  return data.message as DiscordMessageProof;
}
