export type FurrUser = {
  id: string;
  username: string;
  displayName: string;
  discordId: string | null;
  sessionRole?: "Super_Admin" | "User";
};

export type FurrFile = {
  id: string;
  name: string;
  originalName: string;
  displayName: string;
  virtualPath: string;
  size: number;
  mimeType: string;
  scope: "private" | "public";
  ownerId: string | null;
  uploadedAt: string;
  url: string;
};

export type PresenceUser = {
  id: string;
  username: string;
  displayName: string;
  discordId: string | null;
  discordUsername: string | null;
  nickname: string | null;
  roleName: string;
  roleNames: string[];
  status: "online" | "offline";
  isExeOnline: boolean;
  isDiscordOnline: boolean;
  discordStatus: "online" | "idle" | "dnd" | "offline";
  dualPresenceLabel: string;
  connectedAt: string | null;
  lastHeartbeatAt: string | null;
  lastSeenAt: string | null;
};

export type ChatMessage = {
  id: string;
  channel: "team" | "private";
  senderId: string;
  senderName: string;
  recipientId: string | null;
  recipientName: string | null;
  content: string;
  createdAt: string;
};
