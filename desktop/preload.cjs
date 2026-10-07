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
    instance: () => ipcRenderer.invoke("furrbox:vrchat-instance"),
    people: (ids) => ipcRenderer.invoke("furrbox:vrchat-people", ids),
    world: (worldId) => ipcRenderer.invoke("furrbox:vrchat-world", worldId),
    moderate: (action, groupId, userId) => ipcRenderer.invoke("furrbox:vrchat-moderate", action, groupId, userId),
  },
  // FurrBox VR: the panel on your arm in SteamVR.
  vr: {
    status: () => ipcRenderer.invoke("furrbox:vr-status"),
    enable: (on) => ipcRenderer.invoke("furrbox:vr-enable", on),
    setPlacement: (placement) => ipcRenderer.invoke("furrbox:vr-placement", placement),
    setMode: (mode) => ipcRenderer.invoke("furrbox:vr-mode", mode),
    battery: () => ipcRenderer.invoke("furrbox:vr-battery"),
    // Panel-Seite: startet eine Animation – für kurze Zeit flüssige Bilder statt Drosselung.
    boost: (ms) => ipcRenderer.invoke("furrbox:vr-boost", ms),
    // Panel page: short buzz on the arm with the panel (strong = two buzzes).
    haptic: (strong) => ipcRenderer.invoke("furrbox:vr-haptic", strong),
    // Panel page: true while the other controller points at the panel, false a moment after it stops.
    onPoint: (callback) => {
      const listener = (_event, pointing) => callback(Boolean(pointing));
      ipcRenderer.on("furrbox:vr-point", listener);
      return () => ipcRenderer.removeListener("furrbox:vr-point", listener);
    },
    // Panel page: called with true while you look at your arm, false after you look away.
    onGaze: (callback) => {
      const listener = (_event, looking) => callback(Boolean(looking));
      ipcRenderer.on("furrbox:vr-gaze", listener);
      return () => ipcRenderer.removeListener("furrbox:vr-gaze", listener);
    },
    onChange: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on("furrbox:vr", listener);
      return () => ipcRenderer.removeListener("furrbox:vr", listener);
    },
  },
  // Current song from Windows' media controls (Spotify, YouTube, …) and play/pause/next/previous.
  media: {
    state: () => ipcRenderer.invoke("furrbox:media-state"),
    control: (action) => ipcRenderer.invoke("furrbox:media-control", action),
  },
  // Evidence clips (ring buffer) – only present in the desktop app.
  clips: {
    status: () => ipcRenderer.invoke("furrbox:clips-status"),
    config: () => ipcRenderer.invoke("furrbox:clips-config"),
    setConfig: (patch) => ipcRenderer.invoke("furrbox:clips-set-config", patch),
    list: () => ipcRenderer.invoke("furrbox:clips-list"),
    save: (input) => ipcRenderer.invoke("furrbox:clips-save", input),
    request: (input) => ipcRenderer.invoke("furrbox:clips-request", input),
    attachToCase: (input) => ipcRenderer.invoke("furrbox:clips-attach-to-case", input),
    markIn: () => ipcRenderer.invoke("furrbox:clips-mark-in"),
    markOut: (meta) => ipcRenderer.invoke("furrbox:clips-mark-out", meta),
    delete: (id) => ipcRenderer.invoke("furrbox:clips-delete", id),
    read: (id) => ipcRenderer.invoke("furrbox:clips-read", id),
    openFolder: () => ipcRenderer.invoke("furrbox:clips-open-folder"),
    onSaved: (callback) => {
      const listener = (_event, info) => callback(info);
      ipcRenderer.on("furrbox:clips-saved", listener);
      return () => ipcRenderer.removeListener("furrbox:clips-saved", listener);
    },
  },
  osc: {
    chatbox: (text) => ipcRenderer.invoke("furrbox:osc-chatbox", text),
    // Permanent status in the chatbox: { enabled, items, text, opened }.
    status: (config) => ipcRenderer.invoke("furrbox:osc-status", config),
  },
  onStatus: (callback) => ipcRenderer.on("furrbox:status", (_event, text, isError) => callback(text, isError)),
});
