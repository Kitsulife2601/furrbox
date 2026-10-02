import type { Permissions, Role } from "./roles";

export type Scope = "private" | "public";

export type Me = {
  userId: string;
  email: string | null;
  username: string;
  displayName: string;
  discordId: string | null;
  role: Role;
  roleLabel: string;
  permissions: Permissions;
  /** On the Fish server and (Discord staff, manually promoted, whitelisted or whitelist off). */
  hasAccess: boolean;
  /** Why access is denied: not on the Fish Discord server, or not on the whitelist. */
  accessReason: "ok" | "not_in_guild" | "not_whitelisted" | "no_credentials" | "needs_password" | "must_change_password";
  /** FurrBox login name from the whitelist (whitelisted non-staff users only). */
  whitelistUsername: string | null;
};

export type FurrFile = {
  id: string;
  scope: Scope;
  ownerId: string | null;
  folder: string;
  name: string;
  path: string;
  isFolder: boolean;
  mimeType: string;
  size: number;
  createdAt: string;
  updatedAt: string;
  /** Big evidence file stored on the Discord bot's PC (content is fetched on demand). */
  onBot?: boolean;
  botState?: "uploading" | "stored" | "failed" | null;
};

export type Platform = "desktop" | "mobile";
export type DiscordStatus = "online" | "idle" | "dnd" | "offline";

export type PresenceUser = {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  discordId: string | null;
  discordUsername: string | null;
  nickname: string | null;
  role: Role;
  roleLabel: string;
  hasAccount: boolean;
  isAppOnline: boolean;
  isDiscordOnline: boolean;
  discordStatus: DiscordStatus;
  platform: Platform | null;
  connectedAt: string | null;
  lastHeartbeatAt: string | null;
  lastSeenAt: string | null;
};

export type PresenceLog = {
  id: string;
  name: string;
  path: string;
  updatedAt: string;
  content: string;
};

export type ChatChannel = "team" | "private";

export type ChatMessage = {
  id: string;
  channel: ChatChannel;
  senderId: string;
  senderName: string;
  senderRoleLabel: string;
  recipientId: string | null;
  recipientName: string | null;
  content: string;
  createdAt: string;
  kind: ChatKind;
  attachment: ChatAttachment | null;
};

export type ChatKind = "text" | "sticker" | "case" | "file";
export type ChatAttachment =
  | { type: "sticker"; stickerId: string }
  | { type: "case"; path: string; caseId: string; platform: string }
  | { type: "file"; id: string; name: string; mimeType: string; size: number };

export type SystemNotification = {
  id: number;
  version: string;
  title: string;
  description: string;
  createdAt: string;
};

export type DiscordMemberOption = {
  discordId: string;
  username: string;
  nickname: string | null;
  displayName: string;
  label: string;
  roleNames: string[];
  highestPrivilege: string;
};

export type MessageProof = {
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

export type ModerationEntry = {
  id: string;
  action: string;
  targetDiscordId: string;
  targetName: string;
  moderatorName: string;
  reason: string;
  durationMs: number | null;
  status: "queued" | "dispatched" | "success" | "failed";
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type EvidenceCase = {
  path: string;
  platform: string;
  caseId: string;
  createdAt: string;
  fileCount: number;
};

export type BridgeStatus = { connected: boolean; lastSeenAt: string | null; configured: boolean };
