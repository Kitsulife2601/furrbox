const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("furrbox", {
  platform: "desktop",
  webview: true,
  saveDiscordConfig: (data) => ipcRenderer.invoke("furrbox:save-discord", data),
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
  // Personal VRChat login – every call resolves to { ok, value } or { ok: false, error }.
  vrchat: {
    status: () => ipcRenderer.invoke("furrbox:vrchat-status"),
    login: (username, password) => ipcRenderer.invoke("furrbox:vrchat-login", username, password),
    verify: (code) => ipcRenderer.invoke("furrbox:vrchat-verify", code),
    cancel: () => ipcRenderer.invoke("furrbox:vrchat-cancel"),
    logout: () => ipcRenderer.invoke("furrbox:vrchat-logout"),
    search: (query) => ipcRenderer.invoke("furrbox:vrchat-search", query),
    where: () => ipcRenderer.invoke("furrbox:vrchat-where"),
    locations: () => ipcRenderer.invoke("furrbox:vrchat-locations"),
    moderate: (action, groupId, userId) => ipcRenderer.invoke("furrbox:vrchat-moderate", action, groupId, userId),
  },
  onStatus: (callback) => ipcRenderer.on("furrbox:status", (_event, text, isError) => callback(text, isError)),
});
