// What is playing right now (Spotify, YouTube in the browser, …) and play/pause/next/previous.
// Uses Windows' own media controls through a small PowerShell script (media.ps1) – no sign-in,
// no extra programs. The watcher only runs while FurrBox VR or the chatbox status needs it.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const EMPTY = { playing: false, title: "", artist: "", app: "", position: 0, duration: 0, at: 0 };
const ACTIONS = ["toggle", "next", "prev"];

function createMedia(log = () => undefined) {
  let script = null;
  let watcher = null;
  let state = { ...EMPTY };
  let lastAsked = 0;

  /** powershell -EncodedCommand: the script lives inside the app archive, so it is passed as text. */
  function run(action) {
    script ??= fs.readFileSync(path.join(__dirname, "media.ps1"), "utf8").replace(/^param\(.*\)\s*$/m, "");
    const encoded = Buffer.from(`$Action = "${action}"\n${script}`, "utf16le").toString("base64");
    return spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  }

  function start() {
    if (watcher || process.platform !== "win32") return;
    try {
      watcher = run("watch");
    } catch (error) {
      log("Musik: PowerShell konnte nicht gestartet werden:", error.message);
      return;
    }
    let rest = "";
    watcher.stdout.setEncoding("utf8");
    watcher.stdout.on("data", (chunk) => {
      const lines = (rest + chunk).split(/\r?\n/);
      rest = lines.pop() ?? "";
      for (const line of lines) {
        try {
          const j = JSON.parse(line);
          state = {
            playing: Boolean(j.playing),
            title: String(j.title ?? "").slice(0, 120),
            artist: String(j.artist ?? "").slice(0, 80),
            app: String(j.app ?? "").slice(0, 80),
            position: Number(j.position) || 0,
            duration: Number(j.duration) || 0,
            at: Date.now(),
          };
        } catch {
          // not a status line
        }
      }
    });
    const mine = watcher;
    watcher.on("exit", () => {
      if (watcher === mine) watcher = null;
    });
    watcher.on("error", () => {
      if (watcher === mine) watcher = null;
    });
  }

  function stop() {
    if (watcher) watcher.kill();
    watcher = null;
    state = { ...EMPTY };
  }

  // Nobody asked for a while (VR panel closed, chatbox status off): stop the watcher.
  setInterval(() => {
    if (watcher && Date.now() - lastAsked > 60_000) stop();
  }, 30_000).unref();

  return {
    /** Current title; starts the watcher on first use. */
    state() {
      lastAsked = Date.now();
      start();
      // Position keeps counting between two reports of the watcher.
      const extra = state.playing && state.at ? Math.floor((Date.now() - state.at) / 1000) : 0;
      const position = state.duration ? Math.min(state.duration, state.position + extra) : state.position + extra;
      return { playing: state.playing, title: state.title, artist: state.artist, app: state.app, position, duration: state.duration };
    },
    control(action) {
      if (!ACTIONS.includes(action) || process.platform !== "win32") return false;
      try {
        run(action).on("error", () => undefined);
        return true;
      } catch {
        return false;
      }
    },
    stop,
  };
}

module.exports = { createMedia };
