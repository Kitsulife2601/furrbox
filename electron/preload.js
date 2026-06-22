const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("furrboxWindow", {
  minimize: () => ipcRenderer.invoke("window:minimize"),
  close: () => ipcRenderer.invoke("window:close"),
  toggleKiosk: () => ipcRenderer.invoke("window:toggle-kiosk")
});

contextBridge.exposeInMainWorld("furrboxClipboard", {
  writeText: (text) => ipcRenderer.invoke("clipboard:write-text", text),
  writeImageFromUrl: (url) => ipcRenderer.invoke("clipboard:write-image-from-url", url)
});

contextBridge.exposeInMainWorld("furrboxUpdater", {
  check: () => ipcRenderer.invoke("updater:check"),
  install: () => ipcRenderer.invoke("updater:install"),
  onStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("updater:status", listener);
    return () => ipcRenderer.removeListener("updater:status", listener);
  }
});
