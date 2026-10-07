// Instanz-Tracker: reads the VRChat log on this PC (what VRChat itself writes to
// %LOCALAPPDATA%Low\VRChat\VRChat\output_log_*.txt) to know which instance the user is in and who
// joins and leaves. Read incrementally – only new lines are parsed on every poll.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const LOG_DIR = process.env.FURRBOX_VRCHAT_LOG_DIR || path.join(os.homedir(), "AppData", "LocalLow", "VRChat", "VRChat");
// Worlds with the FurrBox map script (vrchat-world/FurrBoxMap.cs) log player positions:
//   [FurrBoxMap] b|minX|minZ|maxX|maxZ   map area in decimetres   [FurrBoxMap] i|<url>   top-down picture
//   [FurrBoxMap] n|<playerId>|<name>     player name              [FurrBoxMap] t|<id>:<x>:<z>:<rotY>|…
const MAP_TAG = "[FurrBoxMap] ";
// Vote kicks, as VRChat writes them:
//   [ModerationManager] A vote kick has been initiated against NAME, do you agree?
//   [ModerationManager] STARTER has initiated a vote kick against NAME.   (who started it, when VRChat logs it)
//   [ModerationManager] Vote to kick NAME succeeded
const MOD_TAG = "[ModerationManager] ";
const VOTE_AGAINST = /^A vote kick has been initiated against (.+?), do you agree\?$/;
const VOTE_BY = /^(.+?) has initiated a vote kick against (.+?)\.?$/;
const VOTE_DONE = /^Vote to kick (.+?) (succeeded|failed)\.?$/;
const LINE = /^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2}) \w+\s+-\s+(.*)$/;
const PLAYER = /^(.+?)(?: \((usr_[0-9a-f-]{36})\))?$/i;
const MAX_EVENTS = 300;

const MAP_IMAGE_HOSTS = [
  "i.imgur.com",
  "raw.githubusercontent.com",
  "user-images.githubusercontent.com",
  "files.catbox.moe",
  "i.ibb.co",
  "i.postimg.cc",
];
function allowedMapImage(value) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" && (MAP_IMAGE_HOSTS.includes(url.hostname) || url.hostname.endsWith(".github.io"));
  } catch {
    return false;
  }
}

function createLogWatcher() {
  let file = null;
  let offset = 0;
  let rest = "";
  let state = fresh();

  function fresh() {
    return {
      location: null,
      worldName: null,
      joinedAt: null,
      inRoom: false,
      players: new Map(),
      left: [],
      events: [],
      map: { bounds: null, image: null, names: new Map(), positions: new Map(), at: null },
      votes: [],
    };
  }

  function newestLog() {
    try {
      return fs
        .readdirSync(LOG_DIR)
        .filter((n) => /^output_log_.*\.txt$/.test(n))
        .map((n) => ({ n, t: fs.statSync(path.join(LOG_DIR, n)).mtimeMs }))
        .sort((a, b) => b.t - a.t)[0]?.n;
    } catch {
      return null;
    }
  }

  function handle(line) {
    const m = LINE.exec(line);
    if (!m) return;
    const at = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).toISOString();
    if (m[7].startsWith("VRCApplication: HandleApplicationQuit")) {
      state.inRoom = false;
      state.closed = true;
      return;
    }
    const tag = m[7].indexOf(MAP_TAG);
    if (tag >= 0) return handleMap(m[7].slice(tag + MAP_TAG.length).trim(), at);
    const mod = m[7].indexOf(MOD_TAG);
    if (mod >= 0) return handleVote(m[7].slice(mod + MOD_TAG.length).trim(), at);
    if (!m[7].startsWith("[Behaviour] ")) return;
    const msg = m[7].slice(12);
    if (msg.startsWith("Entering Room: ")) {
      state.pendingWorld = msg.slice(15).trim();
    } else if (msg.startsWith("Joining wrld_")) {
      const pendingWorld = state.pendingWorld;
      state = fresh();
      state.location = msg.slice(8).trim();
      state.worldName = pendingWorld ?? null;
      state.joinedAt = at;
      state.inRoom = true;
    } else if (msg === "OnLeftRoom") {
      state.inRoom = false;
    } else if (msg.startsWith("OnPlayerJoined ") && state.inRoom) {
      const p = PLAYER.exec(msg.slice(15).trim());
      if (!p) return;
      const id = p[2] ?? `name:${p[1]}`;
      state.players.set(id, { id: p[2] ?? null, name: p[1], joinedAt: at });
      state.left = state.left.filter((l) => (l.id ?? `name:${l.name}`) !== id);
      state.events.push({ kind: "join", name: p[1], id: p[2] ?? null, at });
    } else if (msg.startsWith("OnPlayerLeft ") && state.inRoom) {
      const p = PLAYER.exec(msg.slice(13).trim());
      if (!p) return;
      const id = p[2] ?? `name:${p[1]}`;
      const was = state.players.get(id);
      state.players.delete(id);
      state.left.unshift({ id: p[2] ?? null, name: p[1], joinedAt: was?.joinedAt ?? null, leftAt: at });
      state.left = state.left.slice(0, 100);
      state.events.push({ kind: "leave", name: p[1], id: p[2] ?? null, at });
    }
    if (state.events.length > MAX_EVENTS) state.events = state.events.slice(-MAX_EVENTS);
  }

  function handleVote(msg, at) {
    let v = VOTE_BY.exec(msg);
    if (v) {
      // The same vote may already be known from the "initiated against" line – add who started it.
      const open = state.votes.find((x) => x.target === v[2] && !x.initiator && Date.parse(at) - Date.parse(x.at) < 10_000);
      if (open) open.initiator = v[1];
      else state.votes.push({ id: `${at}-${v[2]}`, target: v[2], initiator: v[1], at, result: null });
    } else if ((v = VOTE_AGAINST.exec(msg))) {
      const open = state.votes.find((x) => x.target === v[1] && Date.parse(at) - Date.parse(x.at) < 10_000);
      if (!open) state.votes.push({ id: `${at}-${v[1]}`, target: v[1], initiator: null, at, result: null });
    } else if ((v = VOTE_DONE.exec(msg))) {
      const open = [...state.votes].reverse().find((x) => x.target === v[1] && !x.result);
      if (open) open.result = v[2] === "succeeded" ? "kicked" : "failed";
    }
    if (state.votes.length > 30) state.votes = state.votes.slice(-30);
  }

  function handleMap(msg, at) {
    const map = state.map;
    const parts = msg.split("|");
    if (parts[0] === "b" && parts.length >= 5) {
      const [minX, minZ, maxX, maxZ] = parts.slice(1, 5).map(Number);
      if ([minX, minZ, maxX, maxZ].every(Number.isFinite) && maxX > minX && maxZ > minZ) map.bounds = { minX: minX / 10, minZ: minZ / 10, maxX: maxX / 10, maxZ: maxZ / 10 };
    } else if (parts[0] === "i" && allowedMapImage(parts[1])) {
      map.image = parts[1];
    } else if (parts[0] === "n" && parts.length >= 3) {
      map.names.set(parts[1], parts.slice(2).join("|"));
    } else if (parts[0] === "t") {
      map.at = at;
      const seen = new Set();
      for (const entry of parts.slice(1)) {
        const [id, x, z, r] = entry.split(":");
        if (!id || !Number.isFinite(+x) || !Number.isFinite(+z)) continue;
        seen.add(id);
        map.positions.set(id, { x: +x / 10, z: +z / 10, r: +r || 0 });
      }
      for (const id of [...map.positions.keys()]) if (!seen.has(id)) map.positions.delete(id);
    }
  }

  function readNew() {
    const name = newestLog();
    if (!name) return false;
    const full = path.join(LOG_DIR, name);
    if (full !== file) {
      file = full;
      offset = 0;
      rest = "";
      state = fresh();
    }
    const size = fs.statSync(full).size;
    if (size < offset) {
      offset = 0;
      rest = "";
      state = fresh();
    }
    if (size === offset) return true;
    const fd = fs.openSync(full, "r");
    try {
      const chunk = Buffer.alloc(1024 * 1024);
      while (offset < size) {
        const n = fs.readSync(fd, chunk, 0, Math.min(chunk.length, size - offset), offset);
        if (n <= 0) break;
        offset += n;
        const text = rest + chunk.toString("utf8", 0, n);
        const lines = text.split(/\r?\n/);
        rest = lines.pop() ?? "";
        for (const line of lines) if (line.includes("[Behaviour]") || line.includes(MAP_TAG) || line.includes(MOD_TAG) || line.includes("HandleApplicationQuit")) handle(line);
      }
    } finally {
      fs.closeSync(fd);
    }
    return true;
  }

  return {
    poll() {
      const found = readNew();
      let updatedAt = null;
      try {
        updatedAt = file ? fs.statSync(file).mtime.toISOString() : null;
      } catch {
        updatedAt = null;
      }
      return {
        logFound: found,
        vrchatClosed: Boolean(state.closed),
        updatedAt,
        inInstance: Boolean(state.inRoom && state.location),
        location: state.location,
        worldName: state.worldName,
        joinedAt: state.joinedAt,
        players: [...state.players.values()],
        left: state.left,
        events: state.events.slice(-100).reverse(),
        votes: state.votes.slice(-10).reverse(),
        map: state.map.at
          ? {
              bounds: state.map.bounds,
              image: state.map.image,
              at: state.map.at,
              players: [...state.map.positions.entries()].map(([id, p]) => ({ playerId: id, name: state.map.names.get(id) ?? null, ...p })),
            }
          : null,
      };
    },
  };
}

module.exports = { createLogWatcher };
