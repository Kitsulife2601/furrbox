const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("furrbox", {
  platform: "desktop",
  webview: true,
  update: {
    getState: () => ipcRenderer.invoke("furrbox:update-state"),
    check: () => ipcRenderer.invoke("furrbox:update-check"),
    install: () => ipcRenderer.invoke("furrbox:update-install"),
    onChange: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on("furrbox:update", listener);
      return () => ipcRenderer.removeListener("furrbox:update", listener);
    },
  },
  onStatus: (callback) => ipcRenderer.on("furrbox:status", (_event, text, isError) => callback(text, isError)),
});
