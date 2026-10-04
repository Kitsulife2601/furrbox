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
const { sendChatbox } = require("./osc.cjs");

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
  mainWindow?.webContents.send("furrbox:update", updateState);
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
  autoUpdater.on("update-available", (info) => setUpdateState({ status: "downloading", newVersion: info.version, percent: 0, notes: releaseNotes(info) }));
  autoUpdater.on("update-not-available", () => setUpdateState({ status: "current", checkedAt: new Date().toISOString() }));
  autoUpdater.on("download-progress", (p) => setUpdateState({ status: "downloading", percent: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (info) => setUpdateState({ status: "ready", newVersion: info.version, notes: releaseNotes(info) }));
  autoUpdater.on("error", (error) => setUpdateState({ status: "error", error: error?.message ?? String(error) }));
  const check = () => autoUpdater.checkForUpdates().catch(() => undefined);
  setTimeout(check, 10_000);
  setInterval(check, 30 * 60_000);
}

function releaseNotes(info) {
  const notes = info?.releaseNotes;
  const text = Array.isArray(notes) ? notes.map((n) => n.note).join("\n") : String(notes ?? "");
  return text.replace(/<[^>]+>/g, "").trim().slice(0, 1500);
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

/** Only the FurrBox page itself (main window or the VR panel) may call the bridges. */
function trusted(event) {
  const contents = [mainWindow?.webContents, vrOverlay.webContents()].filter(Boolean);
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
vrchatHandler("instance", () => vrchatLog.poll());
vrchatHandler("people", (ids) => vrchat.people(ids));
vrchatHandler("world", (worldId) => vrchat.world(String(worldId ?? "")));
vrchatHandler("moderate", (action, groupId, userId) => vrchat.moderate(String(action), String(groupId), String(userId)));

function saveVr(patch) {
  const config = readConfig();
  config.vr = { enabled: true, placement: {}, ...(config.vr ?? {}), ...patch };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  return config.vr;
}
function vrStatus() {
  return { ...vrOverlay.status(), enabled: readConfig().vr?.enabled !== false };
}
vrOverlay.onChange(() => mainWindow?.webContents.send("furrbox:vr", vrStatus()));
ipcMain.handle("furrbox:vr-status", (event) => (trusted(event) ? vrStatus() : null));
ipcMain.handle("furrbox:vr-enable", (event, on) => {
  if (!trusted(event)) return null;
  saveVr({ enabled: Boolean(on) });
  if (on && appUrl) vrOverlay.start(appUrl, readConfig().vr?.placement);
  else vrOverlay.stop();
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
  };
  saveVr({ placement });
  vrOverlay.setPlacement(placement);
  return vrStatus();
});
// OSC to VRChat (chatbox text). Text only, max. 144 characters – VRChat's own limit.
ipcMain.handle("furrbox:osc-chatbox", async (event, text) => {
  if (!trusted(event)) return { ok: false, error: "Nicht erlaubt." };
  try {
    await sendChatbox(String(text ?? ""));
    return { ok: true, value: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

function setStatus(text, isError = false) {
  mainWindow?.webContents.send("furrbox:status", text, isError);
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
  mainWindow.once("ready-to-show", () => mainWindow.show());

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
    if (config.vr?.enabled !== false) vrOverlay.start(url, config.vr?.placement);
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
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    globalShortcut.register("F11", () => mainWindow?.setFullScreen(!mainWindow.isFullScreen()));
    globalShortcut.register("CommandOrControl+Shift+I", () => mainWindow?.webContents.toggleDevTools());
    globalShortcut.register("CommandOrControl+Shift+Q", () => {
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: "question",
        buttons: ["Beenden", "Abbrechen"],
        defaultId: 1,
        message: "FurrBox beenden?",
      });
      if (choice === 0) app.quit();
    });
    createWindow();
    setupAutoUpdater();
  });

  app.on("before-quit", () => {
    app.isQuitting = true;
    globalShortcut.unregisterAll();
    vrOverlay.stop();
    if (serverProcess) serverProcess.kill();
  });

  app.on("window-all-closed", () => app.quit());
}
