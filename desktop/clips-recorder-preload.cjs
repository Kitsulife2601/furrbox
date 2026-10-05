const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("furrboxClips", {
  onCommand: (cb) => {
    ipcRenderer.on("clips:cmd", (_e, cmd, payload) => cb(cmd, payload));
  },
  sendReady: () => ipcRenderer.send("clips:ready"),
  sendChunk: (buf, seq, mime) => ipcRenderer.send("clips:chunk", buf, seq, mime),
  sendError: (msg) => ipcRenderer.send("clips:error", msg),
});
