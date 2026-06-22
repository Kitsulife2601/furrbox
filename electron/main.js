const { app, BrowserWindow, clipboard, ipcMain, nativeImage } = require("electron");
const path = require("path");

const FRONTEND_URL = process.env.FURRBOX_FRONTEND_URL || "http://localhost:3000";

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

  loadFrontend(win);

  if (process.env.FURRBOX_DEVTOOLS === "true") {
    win.webContents.openDevTools({ mode: "detach" });
  }

  return win;
}

app.whenReady().then(() => {
  createWindow();

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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
