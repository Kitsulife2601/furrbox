// FurrBox Desktop (Electron).
// Default: starts the bundled FurrBox server locally (database stored in the user profile)
// and shows it fullscreen. With "serverUrl" in furrbox-config.json the app instead connects
// to a central FurrBox server, so several PCs share files, chat and presence.
const { app, BrowserWindow, Menu, globalShortcut, shell, dialog } = require("electron");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

let mainWindow = null;
let serverProcess = null;

const userData = app.getPath("userData");
const configPath = path.join(userData, "furrbox-config.json");

function readConfig() {
  // discordClientId/-Secret: Discord application for the login (redirect URI
  // http://127.0.0.1:47821/api/auth/callback/discord). discordGuildId is optional.
  const defaults = { serverUrl: "", fullscreen: true, discordClientId: "", discordClientSecret: "", discordGuildId: "" };
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(configPath, "utf8")) };
  } catch {
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(defaults, null, 2));
    return defaults;
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
      const req = http.get(url, (res) => {
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
  const port = await freePort(47821);
  // The Discord redirect URI is registered for port 47821, so a fallback port would break the login.
  if (port !== 47821 && (config.discordClientId || process.env.DISCORD_CLIENT_ID)) {
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
      DISCORD_CLIENT_ID: String(config.discordClientId || process.env.DISCORD_CLIENT_ID || ""),
      DISCORD_CLIENT_SECRET: String(config.discordClientSecret || process.env.DISCORD_CLIENT_SECRET || ""),
      DISCORD_GUILD_ID: String(config.discordGuildId || process.env.DISCORD_GUILD_ID || ""),
    },
    stdio: ["ignore", logFile, logFile],
    windowsHide: true,
  });
  serverProcess.on("exit", (code) => {
    serverProcess = null;
    if (!app.isQuitting) setStatus(`Der FurrBox-Server wurde beendet (Code ${code}). Details: ${path.join(userData, "server.log")}`, true);
  });
  await waitForServer(`${origin}/`);
  return origin;
}

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
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());

  // Links that try to open a new window (FurrBrowser "Im neuen Tab öffnen") go to the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadFile(path.join(__dirname, "splash.html"));

  try {
    let url = String(config.serverUrl || "").trim().replace(/\/+$/, "");
    if (url) {
      setStatus(`Verbinde mit ${url}…`);
      await waitForServer(`${url}/`, 20_000);
    } else {
      setStatus("Lokaler FurrBox-Server wird gestartet…");
      url = await startLocalServer(config);
    }
    await mainWindow.loadURL(url);
  } catch (error) {
    setStatus(`${error instanceof Error ? error.message : String(error)}\n\nKonfiguration: ${configPath}`, true);
  }
}

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
  });

  app.on("before-quit", () => {
    app.isQuitting = true;
    globalShortcut.unregisterAll();
    if (serverProcess) serverProcess.kill();
  });

  app.on("window-all-closed", () => app.quit());
}
