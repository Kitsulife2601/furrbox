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

type AuthUser = Pick<User, "id" | "username" | "displayName">;
type JwtPayload = { sub: string; username: string; displayName: string };
type AuthedRequest = express.Request & { user?: AuthUser };
type FileDto = {
  id: string;
  name: string;
  originalName: string;
  size: number;
  mimeType: string;
  scope: "private" | "public";
  ownerId: string | null;
  uploadedAt: string;
  url: string;
};
type UiState = {
  activeWindow: "furrfs" | "terminal" | "settings";
  wallpaper: "bloom" | "aurora" | "ink";
  startOpen: boolean;
};

const port = Number(process.env.PORT || 4000);
const storageDir = path.resolve(process.env.STORAGE_DIR || path.join(process.cwd(), "storage"));
const databaseUrl = process.env.DATABASE_URL || `file:${path.join(storageDir, "furrbox.db")}`;
process.env.DATABASE_URL = databaseUrl;
const prisma = new PrismaClient();
const corsOrigin = process.env.CORS_ORIGIN || "http://localhost:3000";
const jwtSecret = process.env.JWT_SECRET || "change-this-local-furrbox-secret";
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: corsOrigin,
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

function sanitizeName(name: string) {
  return name.replace(/[^\w.\- ]+/g, "_").slice(0, 160);
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
  return {
    id: file.id,
    name: file.name,
    originalName: file.originalName,
    size: file.size,
    mimeType: file.mimeType,
    scope: file.scope === "PUBLIC" ? "public" : "private",
    ownerId: file.ownerId,
    uploadedAt: file.uploadedAt.toISOString(),
    url: `/api/files/${file.id}/download`
  };
}

function issueToken(user: AuthUser) {
  return jwt.sign({ sub: user.id, username: user.username, displayName: user.displayName }, jwtSecret, { expiresIn: "12h" });
}

async function getUserFromToken(token?: string): Promise<AuthUser | null> {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, jwtSecret) as JwtPayload;
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, username: true, displayName: true }
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

async function ensureStorage() {
  await fs.mkdir(storageDir, { recursive: true });
  await fs.mkdir(publicStorageDir(), { recursive: true });
  await fs.mkdir(path.join(storageDir, "users"), { recursive: true });
}

async function ensureDatabase() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "username" TEXT NOT NULL UNIQUE,
      "passwordHash" TEXT NOT NULL,
      "displayName" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
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

app.use(cors({ origin: corsOrigin }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "furrbox-backend", storageDir, databaseUrl });
});

app.post("/api/auth/register", async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim().toLowerCase();
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

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { username, displayName, passwordHash },
      select: { id: true, username: true, displayName: true }
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
    const profile = { id: user.id, username: user.username, displayName: user.displayName };
    res.json({ token: issueToken(profile), user: profile });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/me", requireAuth, (req: AuthedRequest, res) => {
  res.json({ user: req.user });
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
  const token = typeof socket.handshake.auth.token === "string" ? socket.handshake.auth.token : undefined;
  const user = await getUserFromToken(token);
  if (!user) return next(new Error("Authentication required."));
  socket.data.user = user;
  next();
});

io.on("connection", async (socket) => {
  const user = socket.data.user as AuthUser;
  socket.join(`user:${user.id}`);
  socket.join("public");

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

  socket.on("disconnect", () => {
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
