const { app, BrowserWindow, clipboard, ipcMain, nativeImage } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const edition = require("./edition.json");

const FRONTEND_URL = process.env.FURRBOX_FRONTEND_URL || "http://localhost:3000";
let mainWindow = null;
let updateReady = false;

function loadFrontend(win) {
  if (app.isPackaged) {
    win.loadFile(path.join(process.resourcesPath, "frontend", "out", "index.html"));
    return;
  }

  win.loadURL(FRONTEND_URL);
}

function createWindow() {
  const win = new BrowserWindow({
    title: "FurrBox",
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    frame: false,
    fullscreen: true,
    kiosk: true,
    autoHideMenuBar: true,
    backgroundColor: "#0f172a",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow = win;

  loadFrontend(win);

  if (process.env.FURRBOX_DEVTOOLS === "true") {
    win.webContents.openDevTools({ mode: "detach" });
  }

  return win;
}

function sendUpdaterStatus(status, data = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("updater:status", {
    status,
    edition: edition.edition,
    channel: edition.updateChannel,
    ...data
  });
}

function configureAutoUpdater() {
  if (!app.isPackaged || process.env.FURRBOX_DISABLE_UPDATES === "true") return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.setFeedURL({
    provider: "generic",
    url: edition.updateUrl
  });

  autoUpdater.on("checking-for-update", () => sendUpdaterStatus("checking"));
  autoUpdater.on("update-available", (info) => sendUpdaterStatus("available", { version: info.version }));
  autoUpdater.on("update-not-available", (info) => sendUpdaterStatus("current", { version: info.version }));
  autoUpdater.on("download-progress", (progress) => sendUpdaterStatus("downloading", { percent: Math.round(progress.percent || 0) }));
  autoUpdater.on("update-downloaded", (info) => {
    updateReady = true;
    sendUpdaterStatus("ready", { version: info.version });
  });
  autoUpdater.on("error", (error) => sendUpdaterStatus("error", { message: error.message }));

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((error) => sendUpdaterStatus("error", { message: error.message }));
  }, 5000);
  setInterval(() => {
    autoUpdater.checkForUpdates().catch((error) => sendUpdaterStatus("error", { message: error.message }));
  }, 30 * 60 * 1000);
}

app.whenReady().then(() => {
  createWindow();
  configureAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

ipcMain.handle("window:minimize", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.handle("window:close", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle("window:toggle-kiosk", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  win.setKiosk(!win.isKiosk());
  win.setFullScreen(!win.isFullScreen());
  return win.isKiosk();
});

ipcMain.handle("clipboard:write-text", (_event, text) => {
  clipboard.writeText(String(text || ""));
  return true;
});

ipcMain.handle("clipboard:write-image-from-url", async (_event, url) => {
  const response = await fetch(String(url));
  const arrayBuffer = await response.arrayBuffer();
  const image = nativeImage.createFromBuffer(Buffer.from(arrayBuffer));
  if (image.isEmpty()) return false;
  clipboard.writeImage(image);
  return true;
});

ipcMain.handle("updater:check", async () => {
  if (!app.isPackaged) return { ok: false, error: "Updater is only active in packaged builds." };
  try {
    const result = await autoUpdater.checkForUpdates();
    return { ok: true, updateInfo: result?.updateInfo ?? null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Update check failed." };
  }
});

ipcMain.handle("updater:install", () => {
  if (!updateReady) return false;
  autoUpdater.quitAndInstall(false, true);
  return true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
