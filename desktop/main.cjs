// FurrBox Desktop (Electron).
// Default: starts the bundled FurrBox server locally (database stored in the user profile)
// and shows it fullscreen. With "serverUrl" in furrbox-config.json the app instead connects
// to a central FurrBox server, so several PCs share files, chat and presence.
const { app, BrowserWindow, Menu, globalShortcut, shell, dialog, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const path = require("node:path");
const { createVrchat } = require("./vrchat.cjs");
const { createLogWatcher } = require("./vrchat-log.cjs");
const { createVrOverlay } = require("./vr-overlay.cjs");
const { sendChatbox, clearChatbox } = require("./osc.cjs");
const { createMedia } = require("./media.cjs");
const { createClips } = require("./clips.cjs");

let mainWindow = null;
let serverProcess = null;

const userData = app.getPath("userData");
const configPath = path.join(userData, "furrbox-config.json");
// FurrBox's own setup screen (setup.html) is shown once after installing and after every update.
const setupMarker = path.join(userData, "setup-done");

function setupMode() {
  if (process.argv.includes("--updated")) return "update";
  return fs.existsSync(setupMarker) ? null : "install";
}

// Central FurrBox server (Vercel). Every install connects here unless furrbox-config.json sets
// its own "serverUrl" – or "local" to run the bundled server on this PC instead.
const DEFAULT_SERVER_URL = "https://furrbox-88ir.vercel.app";

function serverUrlFor(config) {
  const value = String(config.serverUrl || "").trim();
  if (value === "local") return "";
  return (value || DEFAULT_SERVER_URL).replace(/\/+$/, "");
}

function writeConfig(config) {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function readConfig() {
  // discordClientId/-Secret: Discord application for the login (redirect URI
  // http://127.0.0.1:47821/api/auth/callback/discord). discordGuildId is optional.
  // vr: the FurrBox panel on your arm in SteamVR (see vr-overlay.cjs).
  const defaults = { serverUrl: "", fullscreen: true, discordClientId: "", discordClientSecret: "", discordGuildId: "", vr: { enabled: true, placement: {} } };
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(configPath, "utf8")) };
  } catch {
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(defaults, null, 2));
    return defaults;
  }
}

/**
 * Discord app credentials baked in by the release build (desktop/build/discord.json,
 * written by the GitHub workflow from repository secrets), so installs work without setup.
 */
function bundledDiscord() {
  const file = app.isPackaged ? path.join(process.resourcesPath, "discord.json") : path.join(__dirname, "build", "discord.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

/** A stable auth secret per installation, so sessions survive restarts. */
function authSecret() {
  const file = path.join(userData, "auth-secret");
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    const secret = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}

function freePort(preferred) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => {
      const fallback = net.createServer();
      fallback.listen(0, "127.0.0.1", () => {
        const { port } = fallback.address();
        fallback.close(() => resolve(port));
      });
    });
    probe.listen(preferred, "127.0.0.1", () => probe.close(() => resolve(preferred)));
  });
}

function waitForServer(url, timeoutMs = 60_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = (url.startsWith("https:") ? https : http).get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) reject(new Error("Server hat nicht rechtzeitig geantwortet."));
        else setTimeout(attempt, 400);
      });
      req.setTimeout(5000, () => req.destroy());
    };
    attempt();
  });
}

function serverDir() {
  return app.isPackaged ? path.join(process.resourcesPath, "server") : path.join(__dirname, "server");
}

async function startLocalServer(config) {
  const entry = path.join(serverDir(), "server", "index.mjs");
  if (!fs.existsSync(entry)) throw new Error(`Server-Build fehlt: ${entry}\nBitte "npm run build:server" im Ordner desktop ausführen.`);
  const bundled = bundledDiscord();
  const port = await freePort(47821);
  // The Discord redirect URI is registered for port 47821, so a fallback port would break the login.
  if (port !== 47821 && (config.discordClientId || process.env.DISCORD_CLIENT_ID || bundled.discordClientId)) {
    throw new Error("Port 47821 ist belegt – der Discord-Login braucht genau diesen Port. Bitte das Programm auf dem Port beenden und FurrBox neu starten.");
  }
  const origin = `http://127.0.0.1:${port}`;
  const dbDir = path.join(userData, "database");
  fs.mkdirSync(dbDir, { recursive: true });
  const logFile = fs.openSync(path.join(userData, "server.log"), "a");

  serverProcess = spawn(process.execPath, [entry], {
    cwd: serverDir(),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: String(port),
      BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: authSecret(),
      FURRBOX_PGLITE_DIR: dbDir,
      DISCORD_CLIENT_ID: String(config.discordClientId || process.env.DISCORD_CLIENT_ID || bundled.discordClientId || ""),
      DISCORD_CLIENT_SECRET: String(config.discordClientSecret || process.env.DISCORD_CLIENT_SECRET || bundled.discordClientSecret || ""),
      DISCORD_GUILD_ID: String(config.discordGuildId || process.env.DISCORD_GUILD_ID || bundled.discordGuildId || ""),
    },
    stdio: ["ignore", logFile, logFile],
    windowsHide: true,
  });
  const child = serverProcess;
  child.on("exit", (code) => {
    if (serverProcess === child) serverProcess = null;
    if (!app.isQuitting && !child.restarting) setStatus(`Der FurrBox-Server wurde beendet (Code ${code}). Details: ${path.join(userData, "server.log")}`, true);
  });
  await waitForServer(`${origin}/`);
  return origin;
}

// ---------- Auto-Update (GitHub Releases of Kitsulife2601/furrbox) ----------
// Only the installed (NSIS) build updates itself; the portable exe and `electron .` just report.
let updateState = { status: "idle", version: app.getVersion() };
let autoUpdater = null;

function setUpdateState(patch) {
  updateState = { ...updateState, ...patch };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("furrbox:update", updateState);
}

function setupAutoUpdater() {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_FILE) {
    updateState = { ...updateState, status: "unsupported" };
    return;
  }
  ({ autoUpdater } = require("electron-updater"));
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => setUpdateState({ status: "checking", error: undefined }));
  autoUpdater.on("update-available", (info) => {
    setUpdateState({ status: "downloading", newVersion: info.version, percent: 0 });
    void releaseNotes(info).then((notes) => setUpdateState({ notes }));
  });
  autoUpdater.on("update-not-available", () => setUpdateState({ status: "current", checkedAt: new Date().toISOString() }));
  autoUpdater.on("download-progress", (p) => setUpdateState({ status: "downloading", percent: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (info) => {
    setUpdateState({ status: "ready", newVersion: info.version });
    void releaseNotes(info).then((notes) => setUpdateState({ notes }));
  });
  autoUpdater.on("error", (error) => setUpdateState({ status: "error", error: error?.message ?? String(error) }));
  const check = () => autoUpdater.checkForUpdates().catch(() => undefined);
  setTimeout(check, 10_000);
  setInterval(check, 30 * 60_000);
}

async function releaseNotes(info) {
  const notes = info?.releaseNotes;
  let text = Array.isArray(notes) ? notes.map((n) => (n && n.note != null ? n.note : n)).join("\n") : String(notes ?? "");
  text = text.replace(/<[^>]+>/g, "").trim();
  if (text) return text.slice(0, 1500);
  const version = String(info?.version ?? "").replace(/^v/i, "").trim();
  if (!version) return "";
  try {
    const https = require("https");
    const body = await new Promise((resolve, reject) => {
      const req = https.get(
        `https://api.github.com/repos/Kitsulife2601/furrbox/releases/tags/v${version}`,
        { headers: { "user-agent": "FurrBox", accept: "application/vnd.github+json" } },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => resolve({ status: res.statusCode, data }));
        },
      );
      req.on("error", reject);
      req.setTimeout(8000, () => {
        req.destroy();
        reject(new Error("timeout"));
      });
    });
    if (body.status === 200) {
      const json = JSON.parse(body.data);
      return String(json.body ?? "")
        .replace(/<[^>]+>/g, "")
        .trim()
        .slice(0, 1500);
    }
  } catch {
    /* offline / rate limit – renderer may still fetch */
  }
  return "";
}

// First-run setup from the login screen: store the Discord app credentials and restart the
// bundled server so the Discord login is active immediately.
ipcMain.handle("furrbox:save-discord", async (_event, input) => {
  const clientId = String(input?.clientId ?? "").trim();
  const clientSecret = String(input?.clientSecret ?? "").trim();
  if (!/^\d{15,22}$/.test(clientId)) return { ok: false, error: "Die Client-ID ist eine lange Zahl (Discord Developer Portal → OAuth2)." };
  if (clientSecret.length < 16) return { ok: false, error: "Das Client-Secret fehlt oder ist zu kurz." };
  const config = { ...readConfig(), discordClientId: clientId, discordClientSecret: clientSecret };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  if (serverUrlFor(config)) return { ok: true };
  if (serverProcess) {
    const old = serverProcess;
    old.restarting = true;
    await new Promise((resolve) => {
      old.once("exit", resolve);
      old.kill();
    });
  }
  const url = await startLocalServer(config);
  await mainWindow?.loadURL(url);
  return { ok: true };
});

ipcMain.handle("furrbox:update-state", () => updateState);
ipcMain.handle("furrbox:update-check", async () => {
  if (!autoUpdater) return updateState;
  await autoUpdater.checkForUpdates().catch((error) => setUpdateState({ status: "error", error: error?.message ?? String(error) }));
  return updateState;
});
ipcMain.handle("furrbox:update-install", () => {
  if (!autoUpdater || updateState.status !== "ready") return false;
  app.isQuitting = true;
  if (serverProcess) serverProcess.kill();
  // Own "Update wird installiert" screen instead of the Windows installer window: the update
  // then installs silently and FurrBox starts again by itself.
  const updater = autoUpdater;
  const install = () => updater.quitAndInstall(true, true);
  if (mainWindow) {
    mainWindow
      .loadFile(path.join(__dirname, "setup.html"), { query: { mode: "apply" } })
      .catch(() => undefined)
      .finally(() => setTimeout(install, 3200));
  } else install();
  return true;
});

// Personal VRChat login (see vrchat.cjs). Only the FurrBox page itself may use it – not pages
// opened in the FurrBrowser <webview> (they run in their own webContents).
const vrchat = createVrchat(userData);
// FurrBox VR (arm panel). Its /vr page runs in an offscreen window and may use the same calls.
const vrOverlay = createVrOverlay({
  BrowserWindow,
  preload: path.join(__dirname, "preload.cjs"),
  log: (...args) => {
    console.log("[vr]", ...args);
    try {
      fs.appendFileSync(path.join(userData, "vr.log"), `${new Date().toISOString()} ${args.join(" ")}\n`);
    } catch {
      // The log is only a help.
    }
  },
});
let appUrl = null;
// Current song (Spotify, YouTube, …) for the VR panel and the chatbox status.
const media = createMedia((...args) => console.log("[media]", ...args));
const clips = createClips({
  userData,
  BrowserWindow,
  readConfig,
  writeConfig,
  log: (...args) => console.log("[clips]", ...args),
  getAppVersion: () => app.getVersion(),
  onClipSaved: (info) => {
    const payload = {
      id: info.id,
      name: info.name,
      path: info.path,
      size: info.size,
      reason: info.reason,
      meta: info.meta,
      createdAt: info.createdAt,
      sha256: info.sha256 || null,
    };
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("furrbox:clips-saved", payload);
    try {
      const vrWc = vrOverlay.webContents && vrOverlay.webContents();
      if (vrWc && !vrWc.isDestroyed()) vrWc.send("furrbox:clips-saved", payload);
    } catch {}
  },
});
clips.attachIpc(ipcMain);

/** Only the FurrBox page itself (main window or the VR panel) may call the bridges. */
function trusted(event) {
  const contents = [mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null, vrOverlay.webContents()].filter(Boolean);
  return contents.some((c) => event.sender === c && event.senderFrame === c.mainFrame);
}

function vrchatHandler(name, fn) {
  ipcMain.handle(`furrbox:vrchat-${name}`, async (event, ...args) => {
    if (!trusted(event)) {
      return { ok: false, error: "Nicht erlaubt." };
    }
    try {
      return { ok: true, value: await fn(...args) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
vrchatHandler("status", () => vrchat.status());
vrchatHandler("login", (username, password) => vrchat.login(String(username ?? ""), String(password ?? "")));
vrchatHandler("verify", (code) => vrchat.verify(String(code ?? "")));
vrchatHandler("cancel", () => vrchat.cancelLogin());
vrchatHandler("logout", () => vrchat.logout());
vrchatHandler("search", (query) => vrchat.search(String(query ?? "")));
const vrchatLog = createLogWatcher();
vrchatHandler("instance", () => {
  const snap = vrchatLog.poll();
  try {
    clips.setInstanceSnapshot(snap);
    clips.noteVotes(snap && snap.votes);
  } catch (e) {
    console.log("[clips] instance hook:", e && e.message ? e.message : e);
  }
  return snap;
});
vrchatHandler("people", (ids) => vrchat.people(ids));
vrchatHandler("world", (worldId) => vrchat.world(String(worldId ?? "")));
vrchatHandler("moderate", (action, groupId, userId) => vrchat.moderate(String(action), String(groupId), String(userId)));

function saveVr(patch) {
  const config = readConfig();
  config.vr = { enabled: true, placement: {}, ...(config.vr ?? {}), ...patch };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  return config.vr;
}
// null = not switched in this session yet (then the saved setting counts).
let vrEnabled = null;
function vrStatus() {
  return { ...vrOverlay.status(), enabled: vrEnabled ?? readConfig().vr?.enabled !== false };
}
vrOverlay.onChange(() => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("furrbox:vr", vrStatus());
  });
ipcMain.handle("furrbox:vr-status", (event) => (trusted(event) ? vrStatus() : null));
// Only the panel page itself switches between the small button and the full panel.
ipcMain.handle("furrbox:vr-mode", (event, mode) => {
  if (event.sender !== vrOverlay.webContents()) return false;
  vrOverlay.setMode(String(mode));
  return true;
});
// Nur die Panel-Seite selbst darf kurz flüssige Bilder anfordern (Übergänge, Hinweise).
ipcMain.handle("furrbox:vr-boost", (event, ms) => {
  if (event.sender !== vrOverlay.webContents()) return false;
  vrOverlay.boost(Number(ms) || 0);
  return true;
});
ipcMain.handle("furrbox:vr-battery", (event) => (trusted(event) ? vrOverlay.battery() : null));
ipcMain.handle("furrbox:media-state", (event) => (trusted(event) ? media.state() : null));
ipcMain.handle("furrbox:media-control", (event, action) => (trusted(event) ? media.control(String(action)) : false));
ipcMain.handle("furrbox:vr-enable", (event, on) => {
  if (!trusted(event)) return null;
  vrEnabled = Boolean(on);
  if (vrEnabled && appUrl) vrOverlay.start(appUrl, readConfig().vr?.placement);
  else vrOverlay.stop();
  try {
    saveVr({ enabled: vrEnabled });
  } catch (error) {
    console.log("[vr] Einstellung konnte nicht gespeichert werden:", error?.message ?? error);
  }
  return vrStatus();
});
ipcMain.handle("furrbox:vr-placement", (event, input) => {
  if (!trusted(event)) return null;
  const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
  const current = { ...readConfig().vr?.placement };
  const placement = {
    hand: input?.hand === "right" ? "right" : input?.hand === "left" ? "left" : (current.hand ?? "left"),
    width: num(input?.width, 0.08, 0.6, current.width ?? 0.2),
    x: num(input?.x, -0.5, 0.5, current.x ?? 0),
    y: num(input?.y, -0.5, 0.5, current.y ?? 0.06),
    z: num(input?.z, -0.5, 0.5, current.z ?? 0.1),
    tilt: num(input?.tilt, -90, 90, current.tilt ?? 0),
    roll: num(input?.roll, -180, 180, current.roll ?? 0),
    turn: num(input?.turn, -180, 180, current.turn ?? 0),
    lift: num(input?.lift, -90, 90, current.lift ?? 0),
  };
  vrOverlay.setPlacement(placement);
  try {
    saveVr({ placement });
  } catch (error) {
    console.log("[vr] Position konnte nicht gespeichert werden:", error?.message ?? error);
  }
  return vrStatus();
});
// Permanent status in the VRChat chatbox (time, world, …): composed here in the main process
// every few seconds – VRChat hides a chatbox text after a while, so it has to be sent again.
const STATUS_ITEMS = ["time", "date", "world", "people", "joined", "instanceAge", "music"];
const STATUS_EVERY_MS = 5000;
/** Idle/Backoff: VRChat nicht in Instanz oder Fenster minimiert/unfokussiert. */
const STATUS_IDLE_MS = 30_000;
const STATUS_BLUR_MS = 15_000;
let chatStatus = { enabled: false, items: [], text: "", opened: {} };
let chatStatusPausedUntil = 0;
let chatStatusDelayMs = STATUS_EVERY_MS;
let chatStatusTimer = null;

function duration(fromIso) {
  const min = Math.max(0, Math.floor((Date.now() - new Date(fromIso).getTime()) / 60_000));
  return min < 60 ? `${min} Min.` : `${Math.floor(min / 60)} Std. ${min % 60} Min.`;
}

function statusText() {
  const s = vrchatLog.poll();
  if (!s.inInstance) return null; // VRChat is closed or still loading
  const now = new Date();
  const opened = chatStatus.opened[s.location];
  const part = {
    time: `🕒 ${now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`,
    date: now.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" }),
    world: s.worldName ? `🌍 ${s.worldName}` : null,
    people: `👥 ${s.players.length}`,
    joined: s.joinedAt ? `Hier seit ${duration(s.joinedAt)}` : null,
    instanceAge: opened ? `Instanz offen: ${duration(opened)}` : s.joinedAt ? `Instanz: mind. ${duration(s.joinedAt)}` : null,
  };
  if (chatStatus.items.includes("music")) {
    const song = media.state();
    if (song.playing && song.title) {
      const time = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
      const head = `🎵 ${song.title}${song.artist ? ` – ${song.artist}` : ""}`.slice(0, 60);
      if (song.duration > 0) {
        // ▰▰▰▱▱▱▱▱▱▱ 1:23 / 3:45
        const filled = Math.min(10, Math.max(0, Math.round((song.position / song.duration) * 10)));
        part.music = `${head}
${"▰".repeat(filled)}${"▱".repeat(10 - filled)} ${time(song.position)} / ${time(song.duration)}`;
      } else {
        part.music = head;
      }
    } else {
      part.music = null;
    }
  }
  const lines = chatStatus.items.map((id) => part[id]).filter(Boolean);
  // Short items share a line, long ones (world, instance) get their own.
  const short = lines.filter((l) => l.length <= 12).join("  ");
  const long = lines.filter((l) => l.length > 12);
  return [chatStatus.text, short, ...long].filter(Boolean).join("\n") || null;
}

function windowQuiet() {
  try {
    if (vrOverlay.status().status === "running") return false;
    if (!mainWindow || mainWindow.isDestroyed()) return true;
    return mainWindow.isMinimized() || !mainWindow.isFocused();
  } catch {
    return false;
  }
}

function runChatStatusTick() {
  if (!chatStatus.enabled || Date.now() < chatStatusPausedUntil) {
    chatStatusDelayMs = STATUS_IDLE_MS;
    return;
  }
  try {
    const text = statusText();
    if (text) {
      sendChatbox(text).catch(() => undefined);
      chatStatusDelayMs = windowQuiet() ? STATUS_BLUR_MS : STATUS_EVERY_MS;
    } else {
      // VRChat inaktiv / nicht in Instanz → Log seltener pollen.
      chatStatusDelayMs = STATUS_IDLE_MS;
    }
  } catch {
    // The VRChat log is not readable right now – try again next time.
    chatStatusDelayMs = STATUS_IDLE_MS;
  }
}

function scheduleChatStatus() {
  if (chatStatusTimer) clearTimeout(chatStatusTimer);
  chatStatusTimer = setTimeout(() => {
    runChatStatusTick();
    scheduleChatStatus();
  }, chatStatusDelayMs);
  if (typeof chatStatusTimer.unref === "function") chatStatusTimer.unref();
}
scheduleChatStatus();

ipcMain.handle("furrbox:osc-status", (event, input) => {
  if (!trusted(event)) return false;
  const opened = {};
  for (const [location, at] of Object.entries(input?.opened ?? {}).slice(0, 50)) {
    if (typeof at === "string" && !Number.isNaN(Date.parse(at))) opened[String(location).slice(0, 300)] = at;
  }
  // Switched off: empty the chatbox right away instead of leaving the last text hanging there.
  if (chatStatus.enabled && !input?.enabled) clearChatbox().catch(() => undefined);
  chatStatus = {
    enabled: Boolean(input?.enabled),
    items: (Array.isArray(input?.items) ? input.items : []).filter((id) => STATUS_ITEMS.includes(id)),
    text: String(input?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
    opened,
  };
  return true;
});

// OSC to VRChat (chatbox text). Text only, max. 144 characters – VRChat's own limit.
ipcMain.handle("furrbox:osc-chatbox", async (event, text) => {
  if (!trusted(event)) return { ok: false, error: "Nicht erlaubt." };
  try {
    // A quick text stays visible for a moment before the permanent status takes over again.
    chatStatusPausedUntil = Date.now() + 10_000;
    await sendChatbox(String(text ?? ""));
    return { ok: true, value: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});


ipcMain.handle("furrbox:clips-status", (event) => (trusted(event) ? clips.status() : null));
ipcMain.handle("furrbox:clips-config", (event) => (trusted(event) ? clips.cfg() : null));
ipcMain.handle("furrbox:clips-set-config", (event, patch) => {
  if (!trusted(event)) return null;
  return clips.saveCfg(patch && typeof patch === "object" ? patch : {});
});
ipcMain.handle("furrbox:clips-list", (event) => (trusted(event) ? clips.listClips() : []));
ipcMain.handle("furrbox:clips-save", async (event, input) => {
  if (!trusted(event)) return { ok: false, error: "Nicht erlaubt." };
  try {
    const info = await clips.requestClip({
      source: String(input?.source || input?.meta?.source || "desktop"),
      reason: String(input?.reason || "manual"),
      preSeconds: input?.preSeconds,
      postSeconds: input?.postSeconds,
      meta: input?.meta && typeof input.meta === "object" ? input.meta : null,
      waitPostRoll: input?.waitPostRoll !== false,
    });
    return { ok: true, value: info };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});
ipcMain.handle("furrbox:clips-delete", (event, id) => {
  if (!trusted(event)) return { ok: false, error: "Nicht erlaubt." };
  try {
    clips.deleteClip(id);
    return { ok: true, value: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});
ipcMain.handle("furrbox:clips-read", (event, id) => {
  if (!trusted(event)) return { ok: false, error: "Nicht erlaubt." };
  try {
    return { ok: true, value: clips.readClip(id) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});
ipcMain.handle("furrbox:clips-open-folder", (event) => {
  if (!trusted(event)) return null;
  return clips.openFolder();
});

ipcMain.handle("furrbox:clips-request", async (event, input) => {
  if (!trusted(event)) return { ok: false, error: "Nicht erlaubt." };
  try {
    const info = await clips.requestClip({
      source: String(input?.source || "desktop"),
      reason: String(input?.reason || input?.source || "manual"),
      preSeconds: input?.preSeconds,
      postSeconds: input?.postSeconds,
      meta: input?.meta && typeof input.meta === "object" ? input.meta : null,
      waitPostRoll: input?.waitPostRoll !== false,
    });
    return { ok: true, value: info };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});
ipcMain.handle("furrbox:clips-attach-to-case", async (event, input) => {
  if (!trusted(event)) return { ok: false, error: "Nicht erlaubt." };
  try {
    const clipId = String(input?.clipId || "");
    const caseId = input?.caseId;
    const phase = String(input?.phase || "prepare");
    if (!clipId) throw new Error("clipId fehlt.");
    if (phase === "complete") {
      if (!caseId || caseId === "new") throw new Error("caseId fehlt für complete.");
      const incident = clips.setCaseLink(clipId, {
        caseId: String(caseId),
        auditId: input?.auditId != null ? String(input.auditId) : null,
        casePath: input?.casePath != null ? String(input.casePath) : null,
      });
      return { ok: true, value: { incident, caseId: String(caseId) } };
    }
    // prepare: return clip bytes so the renderer can run saveEvidenceCase / uploadFile (auth lives there).
    const file = clips.readClip(clipId);
    let incident = null;
    try {
      incident = clips.readIncident(clipId).incident;
    } catch {
      incident = null;
    }
    return {
      ok: true,
      value: {
        phase: "prepare",
        clip: file,
        incident,
        caseId: caseId === "new" || caseId == null ? "new" : String(caseId),
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});
ipcMain.handle("furrbox:clips-mark-in", async (event) => {
  if (!trusted(event)) return { ok: false, error: "Nicht erlaubt." };
  try {
    return { ok: true, value: await clips.markIn() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});
ipcMain.handle("furrbox:clips-mark-out", async (event, meta) => {
  if (!trusted(event)) return { ok: false, error: "Nicht erlaubt." };
  try {
    const info = await clips.markOut(meta && typeof meta === "object" ? meta : null);
    return { ok: true, value: info };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});


function setStatus(text, isError = false) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("furrbox:status", text, isError);
}

function confirmQuit() {
  const choice = dialog.showMessageBoxSync(mainWindow, {
    type: "question",
    buttons: ["Beenden", "Abbrechen"],
    defaultId: 1,
    message: "FurrBox beenden?",
  });
  if (choice === 0) app.quit();
}

async function createWindow() {
  const config = readConfig();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: "#0b0c10",
    title: "FurrBox",
    autoHideMenuBar: true,
    fullscreen: Boolean(config.fullscreen),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // FurrBrowser renders real pages in a <webview> (iframes are blocked by many sites).
      webviewTag: true,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  // Keys that belong to the FurrBox window only (not system-wide): F11 full screen,
  // Ctrl+Shift+I developer tools, Ctrl+Shift+Q quit.
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !mainWindow || mainWindow.isDestroyed()) return;
    const mod = (input.control || input.meta) && input.shift && !input.alt;
    if (input.key === "F11") {
      event.preventDefault();
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    } else if (mod && input.key.toLowerCase() === "i") {
      event.preventDefault();
      mainWindow.webContents.toggleDevTools();
    } else if (mod && input.key.toLowerCase() === "q") {
      event.preventDefault();
      confirmQuit();
    }
  });
  // Closing the FurrBox window ends the app. The invisible window of the VR panel must not keep
  // it running in the background (a second start then hit a destroyed window and crashed).
  mainWindow.on("closed", () => {
    mainWindow = null;
    vrOverlay.stop();
    app.quit();
  });

  // Links that try to open a new window (FurrBrowser "Im neuen Tab öffnen") go to the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  const mode = setupMode();
  // The setup animation plays to the end even when the server answers faster.
  const minimum = new Promise((resolve) => setTimeout(resolve, mode === "install" ? 6800 : mode === "update" ? 4200 : 0));
  if (mode) await mainWindow.loadFile(path.join(__dirname, "setup.html"), { query: { mode } });
  else await mainWindow.loadFile(path.join(__dirname, "splash.html"));

  try {
    let url = serverUrlFor(config);
    if (url) {
      setStatus(`Verbinde mit ${url}…`);
      await waitForServer(`${url}/`, 20_000);
    } else {
      setStatus("Lokaler FurrBox-Server wird gestartet…");
      url = await startLocalServer(config);
    }
    await minimum;
    if (mode) fs.writeFileSync(setupMarker, new Date().toISOString());
    await mainWindow.loadURL(url);
    appUrl = url;
    // One-time switch to the new default position at the edge of the hand (mirrored for the right arm).
    let vr = config.vr ?? {};
    if (vr.placementVersion !== 4) {
      const hand = vr.placement?.hand === "right" ? "right" : "left";
      const side = hand === "right" ? -1 : 1;
      const placement = { hand, width: 0.15, x: 0, y: 0.04, z: 0.1, tilt: 0, roll: 0, turn: 90 * side, lift: 35 };
      try {
        vr = saveVr({ placementVersion: 4, placement });
      } catch {
        vr = { ...vr, placement };
      }
    }
    if (vr.enabled !== false) vrOverlay.start(url, vr.placement);
  } catch (error) {
    setStatus(`${error instanceof Error ? error.message : String(error)}\n\nKonfiguration: ${configPath}`, true);
  }
}

// FurrBrowser <webview>: no preload / node access, popups open inside the same view.
app.on("web-contents-created", (_event, contents) => {
  contents.on("will-attach-webview", (_e, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    if (!/^https?:\/\//.test(params.src || "")) params.src = "about:blank";
  });
  if (contents.getType() === "webview") {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) contents.loadURL(url);
      return { action: "deny" };
    });
  }
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = null;
      if (app.isReady() && !app.isQuitting) createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    const clipHotkeyOk = globalShortcut.register("CommandOrControl+Shift+C", () => {
      clips
        .requestClip({ source: "hotkey", reason: "hotkey", meta: { source: "globalShortcut" } })
        .catch((e) => console.log("[clips] hotkey:", e && e.message ? e.message : e));
    });
    console.log("[clips] Hotkey Ctrl+Shift+C:", clipHotkeyOk ? "registriert" : "FEHLGESCHLAGEN (Konflikt?)");
    const markHotkeyOk = globalShortcut.register("CommandOrControl+Shift+M", () => {
      const st = clips.status();
      const run = st.markInAt
        ? clips.markOut({ source: "hotkey-mark" })
        : clips.markIn();
      Promise.resolve(run).catch((e) => console.log("[clips] mark hotkey:", e && e.message ? e.message : e));
    });
    console.log("[clips] Hotkey Ctrl+Shift+M (Mark In/Out):", markHotkeyOk ? "registriert" : "FEHLGESCHLAGEN");
    createWindow();
    setupAutoUpdater();
  });

  app.on("before-quit", () => {
    app.isQuitting = true;
    globalShortcut.unregisterAll();
    vrOverlay.stop();
    media.stop();
    clips.stop();
    if (serverProcess) serverProcess.kill();
  });

  app.on("window-all-closed", () => app.quit());
}
