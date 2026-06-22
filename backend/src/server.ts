import { PrismaClient, type FileScope, type User } from "@prisma/client";
import bcrypt from "bcryptjs";
import cors from "cors";
import express from "express";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import http from "node:http";
import jwt from "jsonwebtoken";
import multer from "multer";
import path from "node:path";
import pty from "node-pty";
import si from "systeminformation";
import { Server } from "socket.io";

type AuthUser = Pick<User, "id" | "username" | "displayName" | "discordId">;
type JwtPayload = { sub: string; username: string; displayName: string; discordId?: string | null };
type AuthedRequest = express.Request & { user?: AuthUser };
type FileDto = {
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
type UiState = {
  activeWindow: "furrfs" | "terminal" | "settings" | "browser" | "evidence" | "presence";
  wallpaper: "bloom" | "aurora" | "ink";
  startOpen: boolean;
};
type DiscordPrivilege = "none" | "supporter" | "moderator" | "owner" | "dev";
type DiscordMemberSnapshot = {
  discordId: string;
  username: string;
  nickname: string | null;
  displayName: string;
  roles: string[];
  roleNames: string[];
  highestPrivilege: DiscordPrivilege;
  isSupporter: boolean;
  isModerator: boolean;
  isOwner: boolean;
  isDev: boolean;
};
type ModerationAction = "ban" | "warn" | "timeout" | "mute";
type ModerationRequest = {
  requestId: string;
  source: "dashboard";
  action: ModerationAction;
  moderatorId: string;
  targetId: string;
  reason: string;
  durationMs?: number;
};
type ModerationResult = ModerationRequest & {
  status: "success" | "failed";
  error?: string;
  completedAt: string;
  moderatorName?: string;
  moderatorRoleName?: string;
  targetName?: string;
  targetRoleName?: string;
};
type MessageInspectRequest = {
  requestId: string;
  messageId: string;
};
type MessageInspectResult = MessageInspectRequest & {
  found: boolean;
  content: string;
  authorId?: string;
  authorName?: string;
  channelId?: string;
  channelName?: string;
  createdAt?: string;
  error?: string;
};
type PresenceStatus = "online" | "offline";
type PresenceUserDto = {
  id: string;
  username: string;
  displayName: string;
  discordId: string | null;
  discordUsername: string | null;
  nickname: string | null;
  roleName: string;
  roleNames: string[];
  status: PresenceStatus;
  connectedAt: string | null;
  lastHeartbeatAt: string | null;
  lastSeenAt: string | null;
};
type PresenceRow = {
  id: string;
  username: string;
  displayName: string;
  discordId: string | null;
  discordUsername: string | null;
  nickname: string | null;
  roleNamesJson: string | null;
  highestPrivilege: string | null;
  status: PresenceStatus | null;
  connectedAt: Date | string | null;
  lastHeartbeatAt: Date | string | null;
  lastSeenAt: Date | string | null;
};
const DISCORD_PERMISSION_IDS = {
  dev: "1312104318006071328",
  owner: "1395506854549000202",
  moderator: "1397883231134547989",
  supporter: "1395506316801343558"
} as const;

const port = Number(process.env.PORT || 4000);
const storageDir = path.resolve(process.env.STORAGE_DIR || path.join(process.cwd(), "storage"));
const updatesDir = path.resolve(process.env.UPDATES_DIR || path.join(storageDir, "updates"));
const databaseUrl = process.env.DATABASE_URL || `file:${path.join(storageDir, "furrbox.db")}`;
process.env.DATABASE_URL = databaseUrl;
const prisma = new PrismaClient();
const corsOrigin = process.env.CORS_ORIGIN || "http://localhost:3000";
const allowedOrigins = corsOrigin.split(",").map((origin) => origin.trim()).filter(Boolean);
const jwtSecret = process.env.JWT_SECRET || "change-this-local-furrbox-secret";
const botBridgeToken = process.env.BOT_BRIDGE_TOKEN || "";
const app = express();
const server = http.createServer(app);

function isAllowedOrigin(origin?: string) {
  return (
    !origin ||
    origin === "null" ||
    origin.startsWith("file://") ||
    origin.startsWith("app://") ||
    allowedOrigins.includes(origin)
  );
}

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) callback(null, true);
      else callback(new Error(`Origin ${origin} is not allowed.`));
    },
    methods: ["GET", "POST", "DELETE"]
  }
});

let uiState: UiState = {
  activeWindow: "furrfs",
  wallpaper: "bloom",
  startOpen: false
};
let sharedTerminal: pty.IPty | null = null;
let terminalHistory = "FurrBox shared terminal ready.\r\n";
let hardwareInterval: NodeJS.Timeout | null = null;
let publicStorageWatcher: fsSync.FSWatcher | null = null;
let publicStorageBroadcastTimer: NodeJS.Timeout | null = null;
let botSocketId: string | null = null;
const activePresenceSockets = new Map<string, Set<string>>();
const moderationWaiters = new Map<string, { resolve: (result: ModerationResult) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }>();
const messageInspectWaiters = new Map<string, { resolve: (result: MessageInspectResult) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }>();

function sanitizeName(name: string) {
  return name.replace(/[^\w.\- ]+/g, "_").slice(0, 160);
}

function sanitizePathSegment(segment: string) {
  return sanitizeName(segment.trim().replace(/\s+/g, "_")).replace(/^\.+$/, "_") || "unknown";
}

function splitVirtualPath(originalName: string) {
  const normalized = originalName.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return {
      displayName: originalName,
      virtualPath: "Dokumente/virtuelle Privater desktop/release"
    };
  }
  return {
    displayName: parts.at(-1) || originalName,
    virtualPath: parts.slice(0, -1).join("/")
  };
}

function scopeFromInput(input: unknown): FileScope {
  return input === "public" || input === "PUBLIC" ? "PUBLIC" : "PRIVATE";
}

function scopeFolder(scope: FileScope, userId?: string) {
  if (scope === "PUBLIC") return path.join(storageDir, "public");
  if (!userId) throw new Error("Private file scope requires a user.");
  return path.join(storageDir, "users", userId);
}

function toDto(file: {
  id: string;
  name: string;
  originalName: string;
  size: number;
  mimeType: string;
  scope: FileScope;
  ownerId: string | null;
  uploadedAt: Date;
}): FileDto {
  const virtual = splitVirtualPath(file.originalName);
  return {
    id: file.id,
    name: file.name,
    originalName: file.originalName,
    displayName: virtual.displayName,
    virtualPath: virtual.virtualPath,
    size: file.size,
    mimeType: file.mimeType,
    scope: file.scope === "PUBLIC" ? "public" : "private",
    ownerId: file.ownerId,
    uploadedAt: file.uploadedAt.toISOString(),
    url: `/api/files/${file.id}/download`
  };
}

function safeJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function formatRoleName(row: Pick<PresenceRow, "highestPrivilege" | "roleNamesJson">) {
  if (row.highestPrivilege === "dev") return "Dev";
  if (row.highestPrivilege === "owner") return "Fish Nagie Owner";
  if (row.highestPrivilege === "moderator") return "Fish Moderator";
  if (row.highestPrivilege === "supporter") return "Supporter";
  return safeJsonArray(row.roleNamesJson)[0] || "User";
}

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function issueToken(user: AuthUser) {
  return jwt.sign({ sub: user.id, username: user.username, displayName: user.displayName, discordId: user.discordId }, jwtSecret, { expiresIn: "12h" });
}

async function getUserFromToken(token?: string): Promise<AuthUser | null> {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, jwtSecret) as JwtPayload;
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, username: true, displayName: true, discordId: true }
    });
    return user;
  } catch {
    return null;
  }
}

async function requireAuth(req: AuthedRequest, res: express.Response, next: express.NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : typeof req.query.token === "string" ? req.query.token : undefined;
  const user = await getUserFromToken(token);
  if (!user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  req.user = user;
  next();
}

async function listVisibleFiles(userId: string, scope?: FileScope) {
  return prisma.storedFile.findMany({
    where:
      scope === "PUBLIC"
        ? { scope: "PUBLIC" }
        : scope === "PRIVATE"
          ? { scope: "PRIVATE", ownerId: userId }
          : { OR: [{ scope: "PUBLIC" }, { scope: "PRIVATE", ownerId: userId }] },
    orderBy: { uploadedAt: "desc" }
  });
}

async function emitFilesForUser(userId: string, reason: string) {
  const files = (await listVisibleFiles(userId)).map(toDto);
  io.to(`user:${userId}`).emit("files-refreshed", { reason, files });
}

async function emitPublicFiles(reason: string) {
  const files = (await prisma.storedFile.findMany({ where: { scope: "PUBLIC" }, orderBy: { uploadedAt: "desc" } })).map(toDto);
  io.to("public").emit("public-files-refreshed", { reason, files });
}

function publicStorageDir() {
  return scopeFolder("PUBLIC");
}

function auditLogVirtualPath() {
  return "Dokumente/Moderation_Beweise/Discord_Logs/Audit_Log.txt";
}

function auditLogPhysicalPath() {
  return path.join(publicStorageDir(), "Dokumente", "Moderation_Beweise", "Discord_Logs", "Audit_Log.txt");
}

async function ensureStorage() {
  await fs.mkdir(storageDir, { recursive: true });
  await fs.mkdir(path.join(updatesDir, "standard"), { recursive: true });
  await fs.mkdir(path.join(updatesDir, "admin"), { recursive: true });
  await fs.mkdir(publicStorageDir(), { recursive: true });
  await fs.mkdir(path.join(storageDir, "users"), { recursive: true });
  await fs.mkdir(path.dirname(auditLogPhysicalPath()), { recursive: true });
  try {
    await fs.access(auditLogPhysicalPath());
  } catch {
    await fs.writeFile(auditLogPhysicalPath(), "FurrBox Discord Moderation Audit Log\r\n------------------------------------------------------------\r\n", "utf8");
  }
}

async function ensureDatabase() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "username" TEXT NOT NULL UNIQUE,
      "passwordHash" TEXT NOT NULL,
      "displayName" TEXT NOT NULL,
      "discordId" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN "discordId" TEXT;`).catch(() => undefined);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "User_discordId_key" ON "User"("discordId");`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "UserPresence" (
      "userId" TEXT NOT NULL PRIMARY KEY,
      "discordId" TEXT,
      "status" TEXT NOT NULL DEFAULT 'offline',
      "socketId" TEXT,
      "connectedAt" DATETIME,
      "lastHeartbeatAt" DATETIME,
      "lastSeenAt" DATETIME,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "UserPresence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "UserPresence_status_idx" ON "UserPresence"("status");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "UserPresence_discordId_idx" ON "UserPresence"("discordId");`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "StoredFile" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "originalName" TEXT NOT NULL,
      "size" INTEGER NOT NULL,
      "mimeType" TEXT NOT NULL,
      "scope" TEXT NOT NULL,
      "ownerId" TEXT,
      "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "StoredFile_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "StoredFile_scope_idx" ON "StoredFile"("scope");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "StoredFile_ownerId_idx" ON "StoredFile"("ownerId");`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "DiscordMember" (
      "discordId" TEXT NOT NULL PRIMARY KEY,
      "username" TEXT NOT NULL,
      "nickname" TEXT,
      "displayName" TEXT NOT NULL,
      "rolesJson" TEXT NOT NULL,
      "roleNamesJson" TEXT NOT NULL DEFAULT '[]',
      "highestPrivilege" TEXT NOT NULL,
      "isSupporter" BOOLEAN NOT NULL DEFAULT false,
      "isModerator" BOOLEAN NOT NULL DEFAULT false,
      "isOwner" BOOLEAN NOT NULL DEFAULT false,
      "isDev" BOOLEAN NOT NULL DEFAULT false,
      "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`ALTER TABLE "DiscordMember" ADD COLUMN "nickname" TEXT;`).catch(() => undefined);
  await prisma.$executeRawUnsafe(`ALTER TABLE "DiscordMember" ADD COLUMN "roleNamesJson" TEXT NOT NULL DEFAULT '[]';`).catch(() => undefined);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DiscordMember_highestPrivilege_idx" ON "DiscordMember"("highestPrivilege");`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "DiscordWarning" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "targetId" TEXT NOT NULL,
      "moderatorId" TEXT NOT NULL,
      "reason" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DiscordWarning_targetId_idx" ON "DiscordWarning"("targetId");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DiscordWarning_moderatorId_idx" ON "DiscordWarning"("moderatorId");`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ModerationAudit" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "requestId" TEXT,
      "source" TEXT NOT NULL,
      "action" TEXT NOT NULL,
      "moderatorId" TEXT NOT NULL,
      "targetId" TEXT NOT NULL,
      "reason" TEXT NOT NULL,
      "durationMs" INTEGER,
      "status" TEXT NOT NULL,
      "error" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ModerationAudit_requestId_idx" ON "ModerationAudit"("requestId");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ModerationAudit_targetId_idx" ON "ModerationAudit"("targetId");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ModerationAudit_moderatorId_idx" ON "ModerationAudit"("moderatorId");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ModerationAudit_createdAt_idx" ON "ModerationAudit"("createdAt");`);
}

async function syncDiscordMembers(members: DiscordMemberSnapshot[]) {
  await prisma.$transaction(
    members.map((member) =>
      prisma.discordMember.upsert({
        where: { discordId: member.discordId },
        update: {
          username: member.username,
          nickname: member.nickname,
          displayName: member.displayName,
          rolesJson: JSON.stringify(member.roles),
          roleNamesJson: JSON.stringify(member.roleNames),
          highestPrivilege: member.highestPrivilege,
          isSupporter: member.isSupporter,
          isModerator: member.isModerator,
          isOwner: member.isOwner,
          isDev: member.isDev
        },
        create: {
          discordId: member.discordId,
          username: member.username,
          nickname: member.nickname,
          displayName: member.displayName,
          rolesJson: JSON.stringify(member.roles),
          roleNamesJson: JSON.stringify(member.roleNames),
          highestPrivilege: member.highestPrivilege,
          isSupporter: member.isSupporter,
          isModerator: member.isModerator,
          isOwner: member.isOwner,
          isDev: member.isDev
        }
      })
    )
  );
  await emitPresenceSnapshot("discord-sync");
}

function toPresenceDto(row: PresenceRow): PresenceUserDto {
  const roleNames = safeJsonArray(row.roleNamesJson);
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    discordId: row.discordId,
    discordUsername: row.discordUsername,
    nickname: row.nickname,
    roleName: formatRoleName(row),
    roleNames,
    status: row.status === "online" ? "online" : "offline",
    connectedAt: iso(row.connectedAt),
    lastHeartbeatAt: iso(row.lastHeartbeatAt),
    lastSeenAt: iso(row.lastSeenAt)
  };
}

async function listPresenceUsers(): Promise<PresenceUserDto[]> {
  const rows = await prisma.$queryRawUnsafe<PresenceRow[]>(`
    SELECT
      u."id",
      u."username",
      u."displayName",
      u."discordId",
      dm."username" AS "discordUsername",
      dm."nickname",
      dm."roleNamesJson",
      dm."highestPrivilege",
      COALESCE(up."status", 'offline') AS "status",
      up."connectedAt",
      up."lastHeartbeatAt",
      up."lastSeenAt"
    FROM "User" u
    LEFT JOIN "DiscordMember" dm ON dm."discordId" = u."discordId"
    LEFT JOIN "UserPresence" up ON up."userId" = u."id"
    ORDER BY
      CASE WHEN COALESCE(up."status", 'offline') = 'online' THEN 0 ELSE 1 END,
      COALESCE(dm."nickname", dm."displayName", u."displayName", u."username") COLLATE NOCASE ASC
  `);
  return rows.map(toPresenceDto);
}

async function getPresenceUser(userId: string) {
  const rows = await prisma.$queryRawUnsafe<PresenceRow[]>(`
    SELECT
      u."id",
      u."username",
      u."displayName",
      u."discordId",
      dm."username" AS "discordUsername",
      dm."nickname",
      dm."roleNamesJson",
      dm."highestPrivilege",
      COALESCE(up."status", 'offline') AS "status",
      up."connectedAt",
      up."lastHeartbeatAt",
      up."lastSeenAt"
    FROM "User" u
    LEFT JOIN "DiscordMember" dm ON dm."discordId" = u."discordId"
    LEFT JOIN "UserPresence" up ON up."userId" = u."id"
    WHERE u."id" = ?
    LIMIT 1
  `, userId);
  return rows[0] ? toPresenceDto(rows[0]) : null;
}

async function emitPresenceSnapshot(reason: string) {
  const users = await listPresenceUsers();
  io.to("presence").emit("presence:snapshot", { reason, users, emittedAt: new Date().toISOString() });
}

async function emitPresenceUpdate(userId: string, reason: string) {
  const user = await getPresenceUser(userId);
  if (!user) return;
  io.to("presence").emit("presence:update", { ...user, reason, emittedAt: new Date().toISOString() });
}

async function markUserOnline(user: AuthUser, socketId: string) {
  const now = new Date().toISOString();
  const sockets = activePresenceSockets.get(user.id) ?? new Set<string>();
  sockets.add(socketId);
  activePresenceSockets.set(user.id, sockets);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "UserPresence" ("userId", "discordId", "status", "socketId", "connectedAt", "lastHeartbeatAt", "updatedAt")
    VALUES (?, ?, 'online', ?, ?, ?, ?)
    ON CONFLICT("userId") DO UPDATE SET
      "discordId" = excluded."discordId",
      "status" = 'online',
      "socketId" = excluded."socketId",
      "connectedAt" = COALESCE("connectedAt", excluded."connectedAt"),
      "lastHeartbeatAt" = excluded."lastHeartbeatAt",
      "updatedAt" = excluded."updatedAt"
  `, user.id, user.discordId, socketId, now, now, now);
  await emitPresenceUpdate(user.id, "connected");
}

async function markUserHeartbeat(user: AuthUser, socketId: string) {
  const now = new Date().toISOString();
  await prisma.$executeRawUnsafe(`
    INSERT INTO "UserPresence" ("userId", "discordId", "status", "socketId", "connectedAt", "lastHeartbeatAt", "updatedAt")
    VALUES (?, ?, 'online', ?, ?, ?, ?)
    ON CONFLICT("userId") DO UPDATE SET
      "discordId" = excluded."discordId",
      "status" = 'online',
      "socketId" = excluded."socketId",
      "lastHeartbeatAt" = excluded."lastHeartbeatAt",
      "updatedAt" = excluded."updatedAt"
  `, user.id, user.discordId, socketId, now, now, now);
  await emitPresenceUpdate(user.id, "heartbeat");
}

async function markUserOffline(user: AuthUser, socketId: string) {
  const sockets = activePresenceSockets.get(user.id);
  sockets?.delete(socketId);
  if (sockets && sockets.size > 0) return;
  activePresenceSockets.delete(user.id);
  const now = new Date().toISOString();
  await prisma.$executeRawUnsafe(`
    INSERT INTO "UserPresence" ("userId", "discordId", "status", "socketId", "lastSeenAt", "updatedAt")
    VALUES (?, ?, 'offline', NULL, ?, ?)
    ON CONFLICT("userId") DO UPDATE SET
      "discordId" = excluded."discordId",
      "status" = 'offline',
      "socketId" = NULL,
      "connectedAt" = NULL,
      "lastSeenAt" = excluded."lastSeenAt",
      "updatedAt" = excluded."updatedAt"
  `, user.id, user.discordId, now, now);
  await emitPresenceUpdate(user.id, "disconnected");
}

async function appendAuditLog(result: ModerationResult) {
  await prisma.moderationAudit.create({
    data: {
      id: crypto.randomUUID(),
      requestId: result.requestId,
      source: result.source,
      action: result.action,
      moderatorId: result.moderatorId,
      targetId: result.targetId,
      reason: result.reason,
      durationMs: result.durationMs ?? null,
      status: result.status,
      error: result.error ?? null
    }
  });

  const filePath = auditLogPhysicalPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const logBlock = [
    "------------------------------------------------------------",
    `Date: ${new Date(result.completedAt).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}`,
    `Status: ${result.status.toUpperCase()}`,
    `Action: ${result.action.toUpperCase()}`,
    `Moderator Name: ${result.moderatorName || result.moderatorId} [${result.moderatorRoleName || "Unknown"}]`,
    `Target Name: ${result.targetName || result.targetId} [${result.targetRoleName || "Unknown"}]`,
    `Request ID: ${result.requestId}`,
    result.durationMs ? `Duration: ${Math.round(result.durationMs / 1000)} seconds` : "Duration: Not set",
    "Reason:",
    result.reason,
    result.error ? `Error: ${result.error}` : "",
    "------------------------------------------------------------",
    ""
  ].filter(Boolean).join("\r\n");
  await fs.appendFile(filePath, `${logBlock}\r\n`, "utf8");

  const stats = await fs.stat(filePath);
  const existingAuditFile = await prisma.storedFile.findFirst({ where: { scope: "PUBLIC", name: auditLogVirtualPath() } });
  const storedFile = existingAuditFile
    ? await prisma.storedFile.update({
        where: { id: existingAuditFile.id },
        data: {
          originalName: auditLogVirtualPath(),
          size: stats.size,
          mimeType: "text/plain",
          scope: "PUBLIC",
          ownerId: null
        }
      })
    : await prisma.storedFile.create({
        data: {
      name: auditLogVirtualPath(),
      originalName: auditLogVirtualPath(),
      size: stats.size,
      mimeType: "text/plain",
      scope: "PUBLIC",
      ownerId: null
        }
      });
  io.to("public").emit("file-uploaded", toDto(storedFile));
  io.emit("moderation:audit", {
    requestId: result.requestId,
    status: result.status,
    action: result.action,
    moderatorName: result.moderatorName || result.moderatorId,
    moderatorRoleName: result.moderatorRoleName || "Unknown",
    targetName: result.targetName || result.targetId,
    targetRoleName: result.targetRoleName || "Unknown",
    createdAt: result.completedAt
  });
  await emitPublicFiles("moderation-audit");
}

function normalizeModerationRequest(body: Record<string, unknown>, fallbackModeratorId: string): ModerationRequest {
  const action = String(body.action || "").toLowerCase();
  if (!["ban", "warn", "timeout", "mute"].includes(action)) throw new Error("Invalid moderation action.");
  const targetId = String(body.targetId || "").trim();
  const moderatorId = String(body.moderatorDiscordId || body.moderatorId || fallbackModeratorId).trim();
  const reason = String(body.reason || "").trim();
  const durationMs = body.durationMs === undefined ? undefined : Number(body.durationMs);
  if (!/^\d{17,22}$/.test(moderatorId)) throw new Error("moderatorDiscordId must be a synced Discord user snowflake.");
  if (!/^\d{17,22}$/.test(targetId)) throw new Error("targetId must be a Discord snowflake.");
  if (reason.length < 3 || reason.length > 512) throw new Error("reason must be 3-512 characters.");
  if ((action === "timeout" || action === "mute") && (!durationMs || durationMs < 60_000 || durationMs > 2_419_200_000)) {
    throw new Error("durationMs must be between 60 seconds and 28 days for timeout/mute.");
  }
  return {
    requestId: crypto.randomUUID(),
    source: "dashboard",
    action: action as ModerationAction,
    moderatorId,
    targetId,
    reason,
    durationMs
  };
}

async function assertModeratorCanExecute(request: ModerationRequest) {
  if (request.moderatorId === DISCORD_PERMISSION_IDS.dev) return;
  const moderator = await prisma.discordMember.findUnique({ where: { discordId: request.moderatorId } });
  if (!moderator) throw new Error("Moderator is not synced from Discord yet.");
  if (moderator.isDev || moderator.isOwner || moderator.isModerator) return;
  if (moderator.isSupporter && (request.action === "warn" || request.action === "timeout")) return;
  if (moderator.isSupporter) {
    throw new Error("Supporter access only allows Timeout and Warn.");
  }
  throw new Error("Moderator must have Dev, Fish Nagie Owner, Fish Moderator, or Supporter access.");
}

function dispatchModerationRequest(request: ModerationRequest) {
  if (!botSocketId) throw new Error("Discord bot is not connected to the FurrBox bridge.");
  const socket = io.sockets.sockets.get(botSocketId);
  if (!socket) {
    botSocketId = null;
    throw new Error("Discord bot bridge connection is stale.");
  }
  return new Promise<ModerationResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      moderationWaiters.delete(request.requestId);
      reject(new Error("Discord bot did not respond before timeout."));
    }, 30_000);
    moderationWaiters.set(request.requestId, { resolve, reject, timeout });
    socket.emit("moderation:command", request);
  });
}

function dispatchMessageInspect(messageId: string) {
  if (!/^\d{17,22}$/.test(messageId)) throw new Error("Message ID must be a Discord snowflake.");
  if (!botSocketId) throw new Error("Discord bot is not connected to the FurrBox bridge.");
  const socket = io.sockets.sockets.get(botSocketId);
  if (!socket) {
    botSocketId = null;
    throw new Error("Discord bot bridge connection is stale.");
  }
  const request: MessageInspectRequest = { requestId: crypto.randomUUID(), messageId };
  return new Promise<MessageInspectResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      messageInspectWaiters.delete(request.requestId);
      reject(new Error("Discord bot did not return message inspection before timeout."));
    }, 30_000);
    messageInspectWaiters.set(request.requestId, { resolve, reject, timeout });
    socket.emit("message:inspect", request);
  });
}

async function resolveDiscordDisplayName(discordId: string) {
  const member = await prisma.discordMember.findUnique({ where: { discordId } });
  return member?.nickname || member?.displayName || member?.username || discordId;
}

async function writeDiscordReportFile(targetName: string, metadata: Record<string, unknown>) {
  const safeTarget = sanitizePathSegment(targetName);
  const virtualPath = `Dokumente/Moderation_Beweise/Discord_Logs/${safeTarget}_Report.txt`;
  const physicalPath = path.join(publicStorageDir(), "Dokumente", "Moderation_Beweise", "Discord_Logs", `${safeTarget}_Report.txt`);
  await fs.mkdir(path.dirname(physicalPath), { recursive: true });
  const messageProof = metadata.messageProof as { content?: string; authorName?: string; channelName?: string; createdAt?: string } | null;
  const payload = Buffer.from([
    "FurrBox Discord Evidence Report",
    "------------------------------------------------------------",
    `Date: ${new Date(String(metadata.createdAt || new Date().toISOString())).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}`,
    "Action: EVIDENCE REPORT",
    `Moderator Name: ${(metadata.createdBy as { displayName?: string; username?: string } | undefined)?.displayName || (metadata.createdBy as { username?: string } | undefined)?.username || "Unknown"} [FurrBox User]`,
    `Target Name: ${String(metadata.targetDisplayName || metadata.targetPrimary || "Unknown")}`,
    `Violation Category: ${String(metadata.violationCategory || "Other")}`,
    "------------------------------------------------------------",
    "Reason:",
    String(metadata.notes || "No additional notes."),
    "------------------------------------------------------------",
    messageProof?.content ? "Message Proof:" : "",
    messageProof?.content ? `Author: ${messageProof.authorName || "Unknown"}` : "",
    messageProof?.content ? `Channel: ${messageProof.channelName || "Unknown"}` : "",
    messageProof?.content ? `Created At: ${messageProof.createdAt || "Unknown"}` : "",
    messageProof?.content ? messageProof.content : "",
    "------------------------------------------------------------",
    ""
  ].filter(Boolean).join("\r\n"), "utf8");
  await fs.writeFile(physicalPath, payload);
  const existing = await prisma.storedFile.findFirst({ where: { scope: "PUBLIC", name: virtualPath } });
  return existing
    ? prisma.storedFile.update({ where: { id: existing.id }, data: { originalName: virtualPath, size: payload.length, mimeType: "text/plain" } })
    : prisma.storedFile.create({
        data: {
          name: virtualPath,
          originalName: virtualPath,
          size: payload.length,
          mimeType: "text/plain",
          scope: "PUBLIC",
          ownerId: null
        }
      });
}

async function listDiscordTextLogsForUser(discordId: string) {
  const user = await prisma.user.findUnique({ where: { discordId } }).catch(() => null);
  const member = await prisma.discordMember.findUnique({ where: { discordId } }).catch(() => null);
  const candidates = [
    discordId,
    user?.username,
    user?.displayName,
    member?.username,
    member?.nickname,
    member?.displayName
  ]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => [value.toLowerCase(), sanitizePathSegment(value).toLowerCase()]);

  const logsDir = path.join(publicStorageDir(), "Dokumente", "Moderation_Beweise", "Discord_Logs");
  const entries = await fs.readdir(logsDir, { withFileTypes: true }).catch(() => []);
  const logs = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".txt")) continue;
    const physicalPath = path.join(logsDir, entry.name);
    const content = await fs.readFile(physicalPath, "utf8").catch(() => "");
    const haystack = `${entry.name}\n${content}`.toLowerCase();
    if (!candidates.some((candidate) => candidate && haystack.includes(candidate))) continue;
    const stats = await fs.stat(physicalPath);
    logs.push({
      fileName: entry.name,
      virtualPath: `Dokumente/Moderation_Beweise/Discord_Logs/${entry.name}`,
      updatedAt: stats.mtime.toISOString(),
      content
    });
  }
  return logs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

const upload = multer({
  storage: multer.diskStorage({
    destination: async (req: AuthedRequest, _file, cb) => {
      try {
        const scope = scopeFromInput(req.body.scope);
        const destination = scopeFolder(scope, req.user?.id);
        await fs.mkdir(destination, { recursive: true });
        cb(null, destination);
      } catch (error) {
        cb(error as Error, storageDir);
      }
    },
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${crypto.randomUUID()}-${sanitizeName(file.originalname)}`);
    }
  }),
  limits: { fileSize: 1024 * 1024 * 250 }
});

const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 1024 * 1024 * 500,
    files: 32
  }
});

function ensureSharedTerminal() {
  if (sharedTerminal) return sharedTerminal;
  const shell = process.platform === "win32" ? "powershell.exe" : "bash";
  sharedTerminal = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols: 96,
    rows: 28,
    cwd: process.env.HOME || process.cwd(),
    env: process.env
  });

  terminalHistory += `Shared shell started with pid ${sharedTerminal.pid}.\r\n`;
  sharedTerminal.onData((data) => {
    terminalHistory = `${terminalHistory}${data}`.slice(-16000);
    io.to("terminal").emit("terminal:data", data);
  });
  sharedTerminal.onExit(() => {
    terminalHistory += "\r\nShared shell exited. Recreate terminal to start a new session.\r\n";
    sharedTerminal = null;
  });
  return sharedTerminal;
}

async function readHardwareStats() {
  const [load, memory, disks, diskIo, battery] = await Promise.all([si.currentLoad(), si.mem(), si.fsSize(), si.disksIO(), si.battery()]);
  const primaryDisk = disks.sort((a, b) => b.size - a.size)[0];
  return {
    cpuLoad: load.currentLoad,
    ramUsedGb: (memory.total - memory.available) / 1024 / 1024 / 1024,
    ramTotalGb: memory.total / 1024 / 1024 / 1024,
    ramUsedPercent: ((memory.total - memory.available) / memory.total) * 100,
    ramAvailableGb: memory.available / 1024 / 1024 / 1024,
    storageUsedPercent: primaryDisk?.use ?? 0,
    storageAvailableGb: (primaryDisk?.available ?? 0) / 1024 / 1024 / 1024,
    diskReadBytesPerSec: diskIo.rIO_sec ?? 0,
    diskWriteBytesPerSec: diskIo.wIO_sec ?? 0,
    battery: {
      hasBattery: battery.hasBattery,
      percent: battery.percent,
      isCharging: battery.isCharging,
      acConnected: battery.acConnected
    },
    sampledAt: new Date().toISOString()
  };
}

function ensureHardwareStream() {
  if (hardwareInterval) return;
  const tick = async () => {
    try {
      io.to("hardware").emit("hardware:stats", await readHardwareStats());
    } catch (error) {
      io.to("hardware").emit("hardware:error", error instanceof Error ? error.message : "Failed to read hardware stats.");
    }
  };
  tick();
  hardwareInterval = setInterval(tick, 1000);
}

function stopHardwareStreamIfIdle() {
  const room = io.sockets.adapter.rooms.get("hardware");
  if (room?.size || !hardwareInterval) return;
  clearInterval(hardwareInterval);
  hardwareInterval = null;
}

function schedulePublicStorageBroadcast(eventType: string, filename: string | null) {
  if (publicStorageBroadcastTimer) clearTimeout(publicStorageBroadcastTimer);
  publicStorageBroadcastTimer = setTimeout(async () => {
    publicStorageBroadcastTimer = null;
    io.to("public").emit("shared-storage:changed", {
      eventType,
      filename,
      scope: "public",
      changedAt: new Date().toISOString()
    });
    await emitPublicFiles("fs-watch");
  }, 120);
}

function ensurePublicStorageWatcher() {
  if (publicStorageWatcher) return;
  publicStorageWatcher = fsSync.watch(publicStorageDir(), { persistent: true }, (eventType, filename) => {
    schedulePublicStorageBroadcast(eventType, filename ? String(filename) : null);
  });
  publicStorageWatcher.on("error", (error) => {
    io.to("public").emit("shared-storage:error", error.message);
    publicStorageWatcher?.close();
    publicStorageWatcher = null;
  });
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) callback(null, true);
      else callback(new Error(`Origin ${origin} is not allowed.`));
    }
  })
);
app.use(express.json());
app.use("/updates", express.static(updatesDir, {
  immutable: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader("Cache-Control", "no-store");
  }
}));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "furrbox-backend", storageDir, updatesDir, databaseUrl });
});

app.post("/api/auth/register", async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim().toLowerCase();
    const discordId = String(req.body.discordId || "").trim();
    const displayName = String(req.body.displayName || username).trim();
    const password = String(req.body.password || "");

    if (!/^[a-z0-9_.-]{3,32}$/.test(username)) {
      res.status(400).json({ error: "Username must be 3-32 characters: letters, numbers, dot, dash, underscore." });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters." });
      return;
    }
    if (!/^\d{17,22}$/.test(discordId)) {
      res.status(400).json({ error: "Discord ID must be a numeric Discord snowflake." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { username, displayName, discordId, passwordHash },
      select: { id: true, username: true, displayName: true, discordId: true }
    });
    await fs.mkdir(scopeFolder("PRIVATE", user.id), { recursive: true });
    res.status(201).json({ token: issueToken(user), user });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      res.status(409).json({ error: "That username is already taken." });
      return;
    }
    next(error);
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      res.status(401).json({ error: "Invalid username or password." });
      return;
    }
    const profile = { id: user.id, username: user.username, displayName: user.displayName, discordId: user.discordId };
    res.json({ token: issueToken(profile), user: profile });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/me", requireAuth, (req: AuthedRequest, res) => {
  res.json({ user: req.user });
});

app.get("/api/discord/members", requireAuth, async (_req: AuthedRequest, res, next) => {
  try {
    const members = await prisma.discordMember.findMany({ orderBy: [{ displayName: "asc" }] });
    res.json({
      members: members.map((member) => ({
        discordId: member.discordId,
        username: member.username,
        nickname: member.nickname,
        displayName: member.displayName,
        label: member.nickname ? `${member.nickname} (${member.username})` : member.username,
        roles: JSON.parse(member.rolesJson) as string[],
        roleNames: JSON.parse(member.roleNamesJson) as string[],
        highestPrivilege: member.highestPrivilege,
        isSupporter: member.isSupporter,
        isModerator: member.isModerator,
        isOwner: member.isOwner,
        isDev: member.isDev,
        syncedAt: member.syncedAt
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/presence/users", requireAuth, async (_req: AuthedRequest, res, next) => {
  try {
    res.json({ users: await listPresenceUsers() });
  } catch (error) {
    next(error);
  }
});

app.get("/api/presence/users/:discordId/logs", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const discordId = String(req.params.discordId || "").trim();
    if (!/^\d{17,22}$/.test(discordId)) {
      res.status(400).json({ error: "Discord ID must be a numeric Discord snowflake." });
      return;
    }
    res.json({ logs: await listDiscordTextLogsForUser(discordId) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/discord/moderation", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const request = normalizeModerationRequest(req.body as Record<string, unknown>, req.user!.discordId || req.user!.id);
    await assertModeratorCanExecute(request);
    const result = await dispatchModerationRequest(request);
    res.status(result.status === "success" ? 200 : 502).json({ result });
  } catch (error) {
    next(error);
  }
});

app.post("/api/discord/message-inspect", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const messageId = String(req.body.messageId || "").trim();
    const result = await dispatchMessageInspect(messageId);
    res.status(result.found ? 200 : 404).json({ message: result });
  } catch (error) {
    next(error);
  }
});

app.get("/api/files", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const scope = req.query.scope === "public" ? "PUBLIC" : req.query.scope === "private" ? "PRIVATE" : undefined;
    res.json({ files: (await listVisibleFiles(req.user!.id, scope)).map(toDto) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/files", requireAuth, upload.single("file"), async (req: AuthedRequest, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded." });
      return;
    }

    const scope = scopeFromInput(req.body.scope);
    const file = await prisma.storedFile.create({
      data: {
        name: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype || "application/octet-stream",
        scope,
        ownerId: scope === "PRIVATE" ? req.user!.id : null
      }
    });

    const dto = toDto(file);
    if (scope === "PUBLIC") {
      io.to("public").emit("file-uploaded", dto);
      await emitPublicFiles("public-upload");
    } else {
      io.to(`user:${req.user!.id}`).emit("file-uploaded", dto);
    }
    await emitFilesForUser(req.user!.id, "upload");
    res.status(201).json({ file: dto });
  } catch (error) {
    next(error);
  }
});

app.post("/api/evidence", requireAuth, evidenceUpload.array("evidence", 32), async (req: AuthedRequest, res, next) => {
  try {
    const platform = String(req.body.platform || "").trim() === "VRChat" ? "VRChat" : "Discord";
    const targetPrimary = String(req.body.targetPrimary || "").trim();
    const targetDiscordId = String(req.body.targetDiscordId || "").trim();
    const targetDisplayName = String(req.body.targetDisplayName || "").trim();
    const targetSecondary = String(req.body.targetSecondary || "").trim();
    const messageId = String(req.body.messageId || "").trim();
    const messageProofRaw = String(req.body.messageProof || "").trim();
    const violationCategory = String(req.body.violationCategory || "").trim() || "Other";
    const notes = String(req.body.notes || "").trim();
    const uploadedFiles = (req.files || []) as Express.Multer.File[];
    const messageProof = messageProofRaw ? JSON.parse(messageProofRaw) as MessageInspectResult : null;

    if (!targetPrimary) {
      res.status(400).json({ error: "Target identification is required." });
      return;
    }
    if (!uploadedFiles.length && !messageProof?.found) {
      res.status(400).json({ error: "At least one evidence file or inspected Discord message is required." });
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const resolvedTargetName = targetDisplayName || (targetDiscordId ? await resolveDiscordDisplayName(targetDiscordId) : targetPrimary);
    const targetSlug = sanitizePathSegment(resolvedTargetName);
    const caseId = `${targetSlug}_${timestamp}`;
    const virtualCasePath = `Dokumente/Moderation_Beweise/${platform}/${caseId}`;
    const physicalCasePath = path.join(publicStorageDir(), "Dokumente", "Moderation_Beweise", platform, caseId);
    await fs.mkdir(physicalCasePath, { recursive: true });

    const metadata = {
      caseId,
      platform,
      targetPrimary,
      targetDiscordId,
      targetDisplayName: resolvedTargetName,
      targetSecondary,
      messageId,
      messageProof,
      violationCategory,
      notes,
      createdBy: req.user,
      createdAt: new Date().toISOString(),
      evidenceFiles: uploadedFiles.map((file) => ({
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size
      }))
    };

    const createdFiles = [];
    for (const file of uploadedFiles) {
      const safeOriginal = sanitizeName(file.originalname);
      const storedName = `${Date.now()}-${crypto.randomUUID()}-${safeOriginal}`;
      await fs.writeFile(path.join(physicalCasePath, storedName), file.buffer);
      const row = await prisma.storedFile.create({
        data: {
          name: path.join("Dokumente", "Moderation_Beweise", platform, caseId, storedName),
          originalName: `${virtualCasePath}/${safeOriginal}`,
          size: file.size,
          mimeType: file.mimetype || "application/octet-stream",
          scope: "PUBLIC",
          ownerId: null
        }
      });
      createdFiles.push(row);
    }

    const metadataName = "case_metadata.json";
    const metadataBuffer = Buffer.from(JSON.stringify(metadata, null, 2), "utf8");
    const storedMetadataName = `${Date.now()}-${crypto.randomUUID()}-${metadataName}`;
    await fs.writeFile(path.join(physicalCasePath, storedMetadataName), metadataBuffer);
    const metadataRow = await prisma.storedFile.create({
      data: {
        name: path.join("Dokumente", "Moderation_Beweise", platform, caseId, storedMetadataName),
        originalName: `${virtualCasePath}/${metadataName}`,
        size: metadataBuffer.length,
        mimeType: "application/json",
        scope: "PUBLIC",
        ownerId: null
      }
    });
    createdFiles.push(metadataRow);

    if (platform === "Discord") {
      const reportRow = await writeDiscordReportFile(resolvedTargetName, metadata);
      createdFiles.push(reportRow);
    }

    const files = createdFiles.map(toDto);
    io.to("public").emit("evidence:case-created", {
      caseId,
      casePath: virtualCasePath,
      platform,
      targetPrimary: resolvedTargetName,
      violationCategory,
      files
    });
    io.to("public").emit("shared-storage:changed", {
      eventType: "evidence-case-created",
      filename: virtualCasePath,
      scope: "public",
      changedAt: new Date().toISOString()
    });
    await emitPublicFiles("evidence-case-created");

    res.status(201).json({ caseId, casePath: virtualCasePath, files });
  } catch (error) {
    next(error);
  }
});

app.get("/api/files/:id/download", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const fileId = String(req.params.id);
    const file = await prisma.storedFile.findUnique({ where: { id: fileId } });
    if (!file || (file.scope === "PRIVATE" && file.ownerId !== req.user!.id)) {
      res.status(404).json({ error: "File not found." });
      return;
    }
    res.download(path.join(scopeFolder(file.scope, file.ownerId || undefined), file.name), file.originalName);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/files/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const fileId = String(req.params.id);
    const file = await prisma.storedFile.findUnique({ where: { id: fileId } });
    if (!file || (file.scope === "PRIVATE" && file.ownerId !== req.user!.id)) {
      res.status(404).json({ error: "File not found." });
      return;
    }

    await prisma.storedFile.delete({ where: { id: file.id } });
    await fs.unlink(path.join(scopeFolder(file.scope, file.ownerId || undefined), file.name)).catch(() => undefined);

    if (file.scope === "PUBLIC") {
      io.to("public").emit("file-deleted", toDto(file));
      await emitPublicFiles("public-delete");
    }
    await emitFilesForUser(req.user!.id, "delete");
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

io.use(async (socket, next) => {
  const presentedBotToken = typeof socket.handshake.auth.botToken === "string" ? socket.handshake.auth.botToken : undefined;
  if (botBridgeToken && presentedBotToken === botBridgeToken) {
    socket.data.bot = true;
    return next();
  }
  const token = typeof socket.handshake.auth.token === "string" ? socket.handshake.auth.token : undefined;
  const user = await getUserFromToken(token);
  if (!user) return next(new Error("Authentication required."));
  socket.data.user = user;
  next();
});

io.on("connection", async (socket) => {
  if (socket.data.bot) {
    botSocketId = socket.id;
    socket.join("bot-bridge");
    io.emit("discord:bot-status", { connected: true, connectedAt: new Date().toISOString() });

    socket.on("discord:members:sync", async ({ guildId, members }: { guildId?: string; members?: DiscordMemberSnapshot[] }) => {
      if (!Array.isArray(members)) return;
      await syncDiscordMembers(members);
      io.emit("discord:members-refreshed", {
        guildId,
        count: members.length,
        members,
        syncedAt: new Date().toISOString()
      });
    });

    socket.on("moderation:result", async (result: ModerationResult) => {
      const waiter = moderationWaiters.get(result.requestId);
      if (waiter) {
        clearTimeout(waiter.timeout);
        moderationWaiters.delete(result.requestId);
        waiter.resolve(result);
      }
      await appendAuditLog(result);
    });

    socket.on("message:inspect-result", (result: MessageInspectResult) => {
      const waiter = messageInspectWaiters.get(result.requestId);
      if (!waiter) return;
      clearTimeout(waiter.timeout);
      messageInspectWaiters.delete(result.requestId);
      waiter.resolve(result);
    });

    socket.on("disconnect", () => {
      if (botSocketId === socket.id) botSocketId = null;
      io.emit("discord:bot-status", { connected: false, disconnectedAt: new Date().toISOString() });
    });
    return;
  }

  const user = socket.data.user as AuthUser;
  socket.join(`user:${user.id}`);
  socket.join("public");
  await markUserOnline(user, socket.id);

  socket.emit("ui-state", uiState);
  socket.emit("files-refreshed", { reason: "connect", files: (await listVisibleFiles(user.id)).map(toDto) });
  socket.emit("public-files-refreshed", {
    reason: "connect",
    files: (await prisma.storedFile.findMany({ where: { scope: "PUBLIC" }, orderBy: { uploadedAt: "desc" } })).map(toDto)
  });

  socket.on("file-uploaded", async ({ scope }: { scope?: "private" | "public" } = {}) => {
    if (scope === "public") await emitPublicFiles("client-refresh");
    await emitFilesForUser(user.id, "client-refresh");
  });

  socket.on("presence:subscribe", async () => {
    socket.join("presence");
    socket.emit("presence:snapshot", { reason: "subscribe", users: await listPresenceUsers(), emittedAt: new Date().toISOString() });
  });

  socket.on("presence:unsubscribe", () => {
    socket.leave("presence");
  });

  socket.on("presence:heartbeat", async () => {
    await markUserHeartbeat(user, socket.id);
    socket.emit("presence:heartbeat-ack", { at: new Date().toISOString() });
  });

  socket.on("shared-file:create-text", async ({ name, content }: { name?: string; content?: string }) => {
    const safeName = sanitizeName(name || `Neues Textdokument ${Date.now()}.txt`);
    const finalName = safeName.toLowerCase().endsWith(".txt") ? safeName : `${safeName}.txt`;
    const storedName = `${Date.now()}-${crypto.randomUUID()}-${finalName}`;
    await fs.writeFile(path.join(publicStorageDir(), storedName), String(content || ""), "utf8");
    const file = await prisma.storedFile.create({
      data: {
        name: storedName,
        originalName: finalName,
        size: Buffer.byteLength(String(content || ""), "utf8"),
        mimeType: "text/plain",
        scope: "PUBLIC",
        ownerId: null
      }
    });
    io.to("public").emit("file-uploaded", toDto(file));
    await emitPublicFiles("create-text");
  });

  socket.on("shared-file:delete", async ({ id }: { id?: string }) => {
    if (!id) return;
    const file = await prisma.storedFile.findUnique({ where: { id } });
    if (!file || file.scope !== "PUBLIC") return;
    await prisma.storedFile.delete({ where: { id } });
    await fs.unlink(path.join(publicStorageDir(), file.name)).catch(() => undefined);
    io.to("public").emit("file-deleted", toDto(file));
    await emitPublicFiles("delete");
  });

  socket.on("ui-state:update", (patch: Partial<UiState>) => {
    uiState = { ...uiState, ...patch };
    socket.broadcast.emit("ui-state", uiState);
  });

  socket.on("moderation:execute", async (body: Record<string, unknown>, callback?: (response: { ok: boolean; result?: ModerationResult; error?: string }) => void) => {
    try {
      const request = normalizeModerationRequest(body, user.discordId || user.id);
      await assertModeratorCanExecute(request);
      const result = await dispatchModerationRequest(request);
      callback?.({ ok: result.status === "success", result });
    } catch (error) {
      callback?.({ ok: false, error: error instanceof Error ? error.message : "Moderation request failed." });
    }
  });

  socket.on("terminal:create", () => {
    socket.join("terminal");
    const term = ensureSharedTerminal();
    socket.emit("terminal:ready", { pid: term.pid });
    socket.emit("terminal:data", terminalHistory);
  });

  socket.on("terminal:input", (data: string) => {
    ensureSharedTerminal().write(data);
  });

  socket.on("terminal:resize", ({ cols, rows }: { cols?: number; rows?: number }) => {
    ensureSharedTerminal().resize(Math.max(24, cols || 96), Math.max(8, rows || 28));
  });

  socket.on("hardware:subscribe", () => {
    socket.join("hardware");
    ensureHardwareStream();
  });

  socket.on("hardware:unsubscribe", () => {
    socket.leave("hardware");
    stopHardwareStreamIfIdle();
  });

  socket.on("disconnect", async () => {
    await markUserOffline(user, socket.id);
    stopHardwareStreamIfIdle();
  });
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Internal server error";
  res.status(500).json({ error: message });
});

Promise.all([ensureStorage(), ensureDatabase()]).then(() => {
  ensurePublicStorageWatcher();
  server.listen(port, () => {
    console.log(`FurrBox backend listening on http://localhost:${port}`);
  });
});
