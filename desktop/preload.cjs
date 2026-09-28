const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("furrbox", {
  platform: "desktop",
  onStatus: (callback) => ipcRenderer.on("furrbox:status", (_event, text, isError) => callback(text, isError)),
});
