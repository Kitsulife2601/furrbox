// FurrBox Clips: ring-buffer / on-demand evidence capture (Electron desktopCapturer + MediaRecorder).
// Idle: recorder window torn down, zero capture. Modes: instanz (pre-buffer) | nurTrigger (arm on event).
const { desktopCapturer, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const DEFAULTS = {
  enabled: true,
  mode: "instanz", // instanz | nurTrigger
  source: "vrchat", // vrchat | screen
  bufferSeconds: 30,
  preSeconds: 20,
  postSeconds: 5,
  quality: "medium", // low | medium | high
  keepCount: 40,
  maxTotalMb: 800,
  keepOnFailedVote: true,
  voteTimeoutSeconds: 90,
};

const QUALITY = {
  low: { fps: 12, bitrate: 500_000 },
  medium: { fps: 15, bitrate: 900_000 },
  high: { fps: 20, bitrate: 1_600_000 },
};

function clamp(n, lo, hi, d) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function createClips({
  userData,
  BrowserWindow,
  readConfig,
  writeConfig,
  log = () => undefined,
  onClipSaved = () => undefined,
  getAppVersion = () => "unknown",
}) {
  const clipsDir = path.join(userData, "clips");
  fs.mkdirSync(clipsDir, { recursive: true });

  let win = null;
  let ready = false;
  let recording = false;
  let starting = false;
  let inInstance = false;
  let instanceSnap = {
    location: null,
    worldName: null,
    players: [],
    joinedAt: null,
  };
  let segments = [];
  let mimeType = "video/webm";
  let seenVotes = new Set();
  let votesPrimed = false;
  /** @type {Map<string, { vote: any, armedAt: number, timer: NodeJS.Timeout | null, exported: boolean }>} */
  let pendingVotes = new Map();
  let markInAt = null;
  let saveTimer = null;
  let pollTimer = null;
  let holdUntil = 0; // keep recorder alive for post-roll / nurTrigger vote

  function cfg() {
    const raw = readConfig().clips || {};
    return {
      enabled: raw.enabled !== false,
      mode: raw.mode === "nurTrigger" ? "nurTrigger" : "instanz",
      source: raw.source === "screen" ? "screen" : "vrchat",
      bufferSeconds: clamp(raw.bufferSeconds, 10, 60, DEFAULTS.bufferSeconds),
      preSeconds: clamp(raw.preSeconds, 0, 60, DEFAULTS.preSeconds),
      postSeconds: clamp(raw.postSeconds, 0, 30, DEFAULTS.postSeconds),
      quality: QUALITY[raw.quality] ? raw.quality : "medium",
      keepCount: clamp(raw.keepCount, 5, 200, DEFAULTS.keepCount),
      maxTotalMb: clamp(raw.maxTotalMb, 50, 5000, DEFAULTS.maxTotalMb),
      keepOnFailedVote: raw.keepOnFailedVote !== false,
      voteTimeoutSeconds: clamp(raw.voteTimeoutSeconds, 15, 300, DEFAULTS.voteTimeoutSeconds),
    };
  }

  function saveCfg(patch) {
    const current = readConfig();
    const next = { ...cfg(), ...(patch && typeof patch === "object" ? patch : {}) };
    next.enabled = Boolean(next.enabled);
    next.mode = next.mode === "nurTrigger" ? "nurTrigger" : "instanz";
    next.source = next.source === "screen" ? "screen" : "vrchat";
    next.bufferSeconds = clamp(next.bufferSeconds, 10, 60, DEFAULTS.bufferSeconds);
    next.preSeconds = clamp(next.preSeconds, 0, 60, DEFAULTS.preSeconds);
    next.postSeconds = clamp(next.postSeconds, 0, 30, DEFAULTS.postSeconds);
    next.quality = QUALITY[next.quality] ? next.quality : "medium";
    next.keepCount = clamp(next.keepCount, 5, 200, DEFAULTS.keepCount);
    next.maxTotalMb = clamp(next.maxTotalMb, 50, 5000, DEFAULTS.maxTotalMb);
    next.keepOnFailedVote = Boolean(next.keepOnFailedVote);
    next.voteTimeoutSeconds = clamp(next.voteTimeoutSeconds, 15, 300, DEFAULTS.voteTimeoutSeconds);
    current.clips = next;
    writeConfig(current);
    syncActivity();
    return next;
  }

  function trimRing(preSeconds) {
    const keepMs = (preSeconds ?? cfg().bufferSeconds) * 1000 + 1500;
    const now = Date.now();
    while (segments.length > 1 && now - segments[0].at > keepMs) segments.shift();
    let total = segments.reduce((s, x) => s + x.buf.length, 0);
    const cap = Math.ceil((preSeconds ?? cfg().bufferSeconds) * 1.6e6 * 1.5);
    while (segments.length > 1 && total > cap) {
      total -= segments[0].buf.length;
      segments.shift();
    }
  }

  function destroyWindow() {
    ready = false;
    recording = false;
    if (win && !win.isDestroyed()) {
      try {
        win.webContents.send("clips:cmd", "stop");
      } catch {}
      try {
        win.destroy();
      } catch {}
    }
    win = null;
    segments = [];
  }

  function ensureWindow() {
    if (win && !win.isDestroyed()) return win;
    ready = false;
    win = new BrowserWindow({
      width: 320,
      height: 180,
      show: false,
      skipTaskbar: true,
      backgroundColor: "#000000",
      webPreferences: {
        preload: path.join(__dirname, "clips-recorder-preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    win.setMenuBarVisibility(false);
    win.on("closed", () => {
      win = null;
      ready = false;
      recording = false;
    });
    win.loadFile(path.join(__dirname, "clips-recorder.html"));
    return win;
  }

  function waitReady(ms = 8000) {
    if (ready) return Promise.resolve();
    ensureWindow();
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (ready) {
          clearInterval(iv);
          resolve();
        } else if (Date.now() - t0 > ms) {
          clearInterval(iv);
          reject(new Error("Clip-Recorder startet nicht."));
        }
      }, 50);
    });
  }

  async function pickSourceId() {
    const c = cfg();
    const sources = await desktopCapturer.getSources({
      types: c.source === "screen" ? ["screen"] : ["window", "screen"],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    });
    if (c.source === "vrchat") {
      const winSrc =
        sources.find((s) => /vrchat/i.test(s.name) && String(s.id).startsWith("window:")) ||
        sources.find((s) => /vrchat/i.test(s.name));
      if (winSrc) return winSrc.id;
    }
    const screen =
      sources.find((s) => String(s.id).startsWith("screen:0:")) ||
      sources.find((s) => String(s.id).startsWith("screen:")) ||
      sources[0];
    if (!screen) throw new Error("Keine Aufnahmequelle gefunden.");
    return screen.id;
  }

  async function startRecording() {
    if (recording || starting) return;
    starting = true;
    try {
      await waitReady();
      const sourceId = await pickSourceId();
      const q = QUALITY[cfg().quality] || QUALITY.medium;
      segments = [];
      win.webContents.send("clips:cmd", "start", { sourceId, opts: q });
      recording = true;
      log("Clips: Aufnahme gestartet (" + cfg().mode + ")");
    } catch (error) {
      recording = false;
      log("Clips: Start fehlgeschlagen:", error.message);
      destroyWindow();
      throw error;
    } finally {
      starting = false;
    }
  }

  async function stopRecording(force = false) {
    if (!force && Date.now() < holdUntil) return;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (win && !win.isDestroyed() && recording) {
      try {
        win.webContents.send("clips:cmd", "stop");
      } catch {}
    }
    recording = false;
    destroyWindow();
    log("Clips: Pipeline schläft (Recorder abgebaut)");
  }

  function shouldRingBuffer() {
    const c = cfg();
    return Boolean(c.enabled && inInstance && c.mode === "instanz");
  }

  function syncActivity() {
    if (shouldRingBuffer()) {
      if (!recording && !starting) startRecording().catch(() => undefined);
    } else if (!pendingVotes.size && Date.now() >= holdUntil && markInAt == null) {
      if (recording || win) stopRecording(true).catch(() => undefined);
    }
  }

  function setInstanceSnapshot(snap) {
    const nextIn = Boolean(snap && snap.inInstance && !snap.vrchatClosed);
    instanceSnap = {
      location: snap?.location ?? null,
      worldName: snap?.worldName ?? null,
      players: Array.isArray(snap?.players) ? snap.players : [],
      joinedAt: snap?.joinedAt ?? null,
    };
    if (nextIn !== inInstance) {
      inInstance = nextIn;
      if (!nextIn) {
        votesPrimed = false;
        seenVotes = new Set();
        for (const [, p] of pendingVotes) if (p.timer) clearTimeout(p.timer);
        pendingVotes.clear();
        markInAt = null;
      }
    } else {
      inInstance = nextIn;
    }
    syncActivity();
  }

  function setInInstance(on) {
    setInstanceSnapshot({ inInstance: on, vrchatClosed: !on, ...instanceSnap });
  }

  function ffmpegPath() {
    return new Promise((resolve) => {
      try {
        const where = spawn("where.exe", ["ffmpeg"], { windowsHide: true });
        let out = "";
        where.stdout.on("data", (d) => (out += d));
        where.on("close", (code) => {
          if (code !== 0) return resolve(null);
          resolve(out.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || null);
        });
        where.on("error", () => resolve(null));
      } catch {
        resolve(null);
      }
    });
  }

  async function remuxIfPossible(filePath) {
    const ff = await ffmpegPath();
    if (!ff) return filePath;
    const tmp = filePath.replace(/\.webm$/i, ".fixed.webm");
    await new Promise((resolve) => {
      const p = spawn(ff, ["-y", "-fflags", "+genpts", "-i", filePath, "-c", "copy", tmp], {
        windowsHide: true,
        stdio: "ignore",
      });
      p.on("close", (code) => {
        if (code === 0 && fs.existsSync(tmp) && fs.statSync(tmp).size > 0) {
          try {
            fs.unlinkSync(filePath);
            fs.renameSync(tmp, filePath);
          } catch {}
        } else if (fs.existsSync(tmp)) {
          try {
            fs.unlinkSync(tmp);
          } catch {}
        }
        resolve();
      });
      p.on("error", () => resolve());
    });
    return filePath;
  }

  function cleanupOld() {
    const c = cfg();
    let files = [];
    try {
      files = fs
        .readdirSync(clipsDir)
        .filter((n) => /\.webm$/i.test(n))
        .map((n) => {
          const p = path.join(clipsDir, n);
          const st = fs.statSync(p);
          return { name: n, path: p, size: st.size, mtime: st.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
    } catch {
      return;
    }
    while (files.length > c.keepCount) {
      const f = files.pop();
      try {
        fs.unlinkSync(f.path);
      } catch {}
      try {
        fs.unlinkSync(f.path + ".json");
      } catch {}
    }
    let total = files.reduce((s, f) => s + f.size, 0);
    const maxBytes = c.maxTotalMb * 1024 * 1024;
    while (files.length && total > maxBytes) {
      const f = files.pop();
      total -= f.size;
      try {
        fs.unlinkSync(f.path);
      } catch {}
      try {
        fs.unlinkSync(f.path + ".json");
      } catch {}
    }
  }

  function estimateDurationSec(preSeconds, postSeconds) {
    if (!segments.length) return Math.max(1, (preSeconds || 0) + (postSeconds || 0));
    const span = (segments[segments.length - 1].at - segments[0].at) / 1000;
    return Math.max(1, Math.round(span * 10) / 10);
  }

  async function flushToDisk({ source, reason, meta, preSeconds, postSeconds }) {
    const keepPre = preSeconds ?? cfg().preSeconds ?? cfg().bufferSeconds;
    trimRing(keepPre);
    if (!segments.length) throw new Error("Kein Clip-Puffer vorhanden (Aufnahme inaktiv?).");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeReason = String(reason || source || "manual").replace(/[^\w\-]+/g, "_").slice(0, 40);
    const name = "clip_" + stamp + "_" + safeReason + ".webm";
    const filePath = path.join(clipsDir, name);
    const body = Buffer.concat(segments.map((s) => s.buf));
    fs.writeFileSync(filePath, body);
    await remuxIfPossible(filePath);
    cleanupOld();
    const st = fs.statSync(filePath);
    const hash = sha256File(filePath);
    const durationSec = estimateDurationSec(keepPre, postSeconds);
    const incident = {
      schema: "furrbox.clip.incident.v1",
      timestamp: new Date().toISOString(),
      trigger: { source: source || "desktop", reason: reason || "manual" },
      meta: meta && typeof meta === "object" ? meta : null,
      caseId: null,
      auditId: meta && meta.auditId != null ? String(meta.auditId) : null,
      evidence: { caseId: null, auditId: null, casePath: null, attachedAt: null },
      vrchat: {
        worldName: instanceSnap.worldName,
        location: instanceSnap.location,
        joinedAt: instanceSnap.joinedAt,
        players: instanceSnap.players.map((p) => ({
          id: p.id ?? null,
          name: p.name ?? null,
        })),
        vote: meta && (meta.target || meta.voteId)
          ? {
              voteId: meta.voteId ?? null,
              target: meta.target ?? null,
              initiator: meta.initiator ?? null,
              result: meta.result ?? null,
              at: meta.at ?? null,
            }
          : null,
      },
      clip: {
        id: name,
        name,
        path: filePath,
        mimeType,
        size: st.size,
        durationEstimateSec: durationSec,
        preSeconds: keepPre,
        postSeconds: postSeconds ?? cfg().postSeconds,
        sha256: hash,
      },
      app: {
        name: "FurrBox Desktop",
        version: String(getAppVersion() || "unknown"),
        clipsMode: cfg().mode,
        clipsSource: cfg().source,
      },
    };
    fs.writeFileSync(filePath + ".json", JSON.stringify(incident, null, 2), "utf8");
    const info = {
      id: name,
      name,
      path: filePath,
      size: st.size,
      mimeType,
      reason: reason || "manual",
      source: source || "desktop",
      meta: meta || null,
      createdAt: incident.timestamp,
      durationEstimateSec: durationSec,
      sha256: hash,
      incident,
    };
    onClipSaved(info);
    return info;
  }

  /**
   * Central Clip-on-Demand API.
   * @param {{ source?: string, reason?: string, preSeconds?: number, postSeconds?: number, meta?: object, waitPostRoll?: boolean }} input
   */
  async function requestClip(input = {}) {
    const c = cfg();
    if (!c.enabled) throw new Error("Clips sind deaktiviert.");
    const source = String(input.source || "desktop");
    const reason = String(input.reason || source);
    const preSeconds = clamp(input.preSeconds, 0, 60, c.preSeconds);
    const postSeconds = clamp(input.postSeconds, 0, 30, c.postSeconds);
    const meta = input.meta && typeof input.meta === "object" ? input.meta : null;
    const waitPostRoll = input.waitPostRoll !== false;

    holdUntil = Date.now() + (waitPostRoll ? postSeconds * 1000 + 500 : 500);

    // Arm recorder if needed (nurTrigger / not yet buffering).
    if (!recording && !starting) {
      await startRecording().catch((e) => {
        throw new Error("Aufnahme konnte nicht gestartet werden: " + (e.message || e));
      });
      // Short warm-up so at least one segment arrives when there was no pre-buffer.
      if (c.mode === "nurTrigger" || !segments.length) {
        await new Promise((r) => setTimeout(r, Math.min(2000, Math.max(400, preSeconds > 0 ? 800 : 400))));
      }
    }

    const delay = waitPostRoll ? postSeconds * 1000 : 0;
    if (saveTimer) clearTimeout(saveTimer);
    await new Promise((resolve) => {
      if (delay <= 0) resolve();
      else saveTimer = setTimeout(resolve, delay);
    });
    saveTimer = null;

    try {
      const info = await flushToDisk({ source, reason, meta, preSeconds, postSeconds });
      return info;
    } finally {
      holdUntil = Date.now() + 300;
      syncActivity();
    }
  }

  // Back-compat alias
  function saveClip(opts = {}) {
    return requestClip({
      source: opts.meta?.source || opts.reason || "manual",
      reason: opts.reason || "manual",
      meta: opts.meta || null,
      waitPostRoll: opts.waitPostRoll,
      preSeconds: opts.preSeconds,
      postSeconds: opts.postSeconds,
    });
  }

  function armForVote(vote) {
    const c = cfg();
    if (!c.enabled) return;
    holdUntil = Date.now() + c.voteTimeoutSeconds * 1000 + 5000;
    if (!recording && !starting) {
      startRecording().catch((e) => log("Clips: Vote-Arm fehlgeschlagen:", e.message));
    }
    if (pendingVotes.has(vote.id)) return;
    const timer = setTimeout(() => {
      exportVote(vote.id, { result: null, timedOut: true }).catch(() => undefined);
    }, c.voteTimeoutSeconds * 1000);
    if (timer.unref) timer.unref();
    pendingVotes.set(vote.id, { vote, armedAt: Date.now(), timer, exported: false });
    log("Clips: Votekick-Puffer scharf (" + vote.target + ")");
  }

  async function exportVote(voteId, extra = {}) {
    const pending = pendingVotes.get(voteId);
    if (!pending || pending.exported) return null;
    pending.exported = true;
    if (pending.timer) clearTimeout(pending.timer);
    pendingVotes.delete(voteId);
    const vote = { ...pending.vote, ...extra };
    const failed = vote.result === "failed";
    if (failed && !cfg().keepOnFailedVote) {
      log("Clips: Votekick abgelehnt – Clip verworfen (Einstellung)");
      syncActivity();
      return null;
    }
    const c = cfg();
    return requestClip({
      source: "votekick",
      reason: "votekick",
      preSeconds: c.preSeconds,
      postSeconds: c.postSeconds,
      meta: {
        voteId: vote.id,
        target: vote.target || null,
        initiator: vote.initiator || null,
        result: vote.result ?? null,
        at: vote.at || null,
        timedOut: Boolean(extra.timedOut),
      },
    });
  }

  function noteVotes(votes) {
    if (!Array.isArray(votes)) return;
    if (!votesPrimed) {
      seenVotes = new Set(votes.map((v) => v && v.id).filter(Boolean));
      votesPrimed = true;
      return;
    }
    for (const v of votes) {
      if (!v || !v.id) continue;
      const known = seenVotes.has(v.id);
      if (!known) {
        seenVotes.add(v.id);
        if (!v.result && Date.now() - new Date(v.at).getTime() < 120_000) {
          armForVote(v);
        }
      }
      // Result line appeared
      if (v.result && pendingVotes.has(v.id)) {
        exportVote(v.id, { result: v.result }).catch((e) =>
          log("Clips: Vote-Export fehlgeschlagen:", e.message),
        );
      }
    }
    if (seenVotes.size > 100) seenVotes = new Set([...seenVotes].slice(-50));
  }

  function markIn() {
    const c = cfg();
    if (!c.enabled) throw new Error("Clips sind deaktiviert.");
    holdUntil = Date.now() + 30 * 60_000;
    markInAt = Date.now();
    if (!recording && !starting) {
      return startRecording().then(() => ({ ok: true, at: markInAt }));
    }
    return Promise.resolve({ ok: true, at: markInAt });
  }

  function markOut(meta = null) {
    if (markInAt == null) throw new Error("Kein Mark-In aktiv. Zuerst Markierung starten.");
    const preSeconds = Math.min(60, Math.max(1, Math.round((Date.now() - markInAt) / 1000)));
    markInAt = null;
    return requestClip({
      source: "mark",
      reason: "mark-in-out",
      preSeconds,
      postSeconds: 0,
      waitPostRoll: false,
      meta: { ...(meta || {}), markDurationSec: preSeconds },
    });
  }


  function incidentPathFor(id) {
    const name = path.basename(String(id || ""));
    if (!name || name !== id || name.includes("..")) throw new Error("Ungültige Clip-ID.");
    const filePath = path.join(clipsDir, name);
    if (!filePath.startsWith(clipsDir)) throw new Error("Ungültiger Pfad.");
    if (!fs.existsSync(filePath)) throw new Error("Clip nicht gefunden.");
    return { name, filePath, jsonPath: filePath + ".json" };
  }

  function readIncident(id) {
    const { jsonPath, name, filePath } = incidentPathFor(id);
    let incident = null;
    try {
      incident = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    } catch {
      incident = {
        schema: "furrbox.clip.incident.v1",
        timestamp: new Date().toISOString(),
        trigger: { source: "unknown", reason: "unknown" },
        caseId: null,
        auditId: null,
        evidence: { caseId: null, auditId: null, casePath: null, attachedAt: null },
        clip: { id: name, name, path: filePath, sha256: null },
      };
    }
    if (incident.caseId === undefined) incident.caseId = incident.evidence?.caseId ?? null;
    if (!incident.evidence) {
      incident.evidence = {
        caseId: incident.caseId ?? null,
        auditId: incident.auditId ?? null,
        casePath: null,
        attachedAt: null,
      };
    }
    return { incident, name, filePath, jsonPath };
  }

  /** Writes caseId (and optional auditId/casePath) into the clip sidecar after Evidence attach. */
  function setCaseLink(clipId, link) {
    const { incident, jsonPath } = readIncident(clipId);
    const caseId = link && link.caseId != null ? String(link.caseId) : null;
    const auditId = link && link.auditId != null ? String(link.auditId) : null;
    const casePath = link && link.casePath != null ? String(link.casePath) : null;
    incident.caseId = caseId;
    if (auditId) incident.auditId = auditId;
    incident.evidence = {
      caseId,
      auditId: auditId || incident.evidence?.auditId || null,
      casePath: casePath || incident.evidence?.casePath || null,
      attachedAt: caseId ? new Date().toISOString() : null,
    };
    fs.writeFileSync(jsonPath, JSON.stringify(incident, null, 2), "utf8");
    return incident;
  }

  function listClips() {
    cleanupOld();
    try {
      return fs
        .readdirSync(clipsDir)
        .filter((n) => /\.webm$/i.test(n))
        .map((n) => {
          const p = path.join(clipsDir, n);
          const st = fs.statSync(p);
          let incident = null;
          try {
            incident = JSON.parse(fs.readFileSync(p + ".json", "utf8"));
          } catch {
            incident = null;
          }
          return {
            id: n,
            name: n,
            path: p,
            size: st.size,
            createdAt: incident?.timestamp || new Date(st.mtimeMs).toISOString(),
            reason: incident?.trigger?.reason || null,
            source: incident?.trigger?.source || null,
            meta: incident?.meta || incident?.vrchat?.vote || null,
            mimeType: "video/webm",
            sha256: incident?.clip?.sha256 || null,
            caseId: incident?.caseId ?? incident?.evidence?.caseId ?? null,
            durationEstimateSec: incident?.clip?.durationEstimateSec ?? null,
          };
        })
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    } catch {
      return [];
    }
  }

  function deleteClip(id) {
    const name = path.basename(String(id || ""));
    if (!name || name !== id || name.includes("..")) throw new Error("Ungültige Clip-ID.");
    const p = path.join(clipsDir, name);
    if (!p.startsWith(clipsDir)) throw new Error("Ungültiger Pfad.");
    if (fs.existsSync(p)) fs.unlinkSync(p);
    if (fs.existsSync(p + ".json")) fs.unlinkSync(p + ".json");
    return true;
  }

  function readClip(id) {
    const name = path.basename(String(id || ""));
    if (!name || name !== id) throw new Error("Ungültige Clip-ID.");
    const p = path.join(clipsDir, name);
    if (!fs.existsSync(p)) throw new Error("Clip nicht gefunden.");
    const buf = fs.readFileSync(p);
    if (buf.length > 200 * 1024 * 1024) throw new Error("Clip ist zu groß zum Laden.");
    let sha = null;
    try {
      sha = JSON.parse(fs.readFileSync(p + ".json", "utf8")).clip?.sha256 || null;
    } catch {
      sha = sha256File(p);
    }
    return {
      id: name,
      name,
      mimeType: "video/webm",
      size: buf.length,
      base64: buf.toString("base64"),
      sha256: sha,
    };
  }

  function openFolder() {
    shell.openPath(clipsDir);
    return clipsDir;
  }

  function status() {
    const c = cfg();
    return {
      enabled: c.enabled,
      mode: c.mode,
      active: recording,
      inInstance,
      bufferSeconds: c.bufferSeconds,
      preSeconds: c.preSeconds,
      postSeconds: c.postSeconds,
      source: c.source,
      quality: c.quality,
      keepOnFailedVote: c.keepOnFailedVote,
      segmentCount: segments.length,
      bufferedMs: segments.length ? Date.now() - segments[0].at : 0,
      clipsDir,
      hotkey: "CommandOrControl+Shift+C",
      markHotkey: "CommandOrControl+Shift+M",
      markInAt,
      pendingVotes: pendingVotes.size,
      instance: {
        worldName: instanceSnap.worldName,
        location: instanceSnap.location,
        playerCount: instanceSnap.players.length,
      },
    };
  }

  function attachIpc(ipcMain) {
    ipcMain.on("clips:ready", (event) => {
      if (win && !win.isDestroyed() && event.sender === win.webContents) ready = true;
    });
    ipcMain.on("clips:chunk", (event, buf, seq, mime) => {
      if (!win || win.isDestroyed() || event.sender !== win.webContents) return;
      const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
      if (!data.length) return;
      if (mime) mimeType = String(mime);
      segments.push({ buf: data, at: Date.now(), seq: Number(seq) || 0, mime: mimeType });
      trimRing(cfg().mode === "instanz" ? cfg().bufferSeconds : Math.max(cfg().preSeconds, cfg().bufferSeconds));
    });
    ipcMain.on("clips:error", (_event, msg) => {
      log("Clips recorder:", msg);
      recording = false;
    });
  }

  pollTimer = setInterval(() => syncActivity(), 4000);
  if (pollTimer.unref) pollTimer.unref();

  return {
    DEFAULTS,
    clipsDir,
    cfg,
    saveCfg,
    status,
    setInInstance,
    setInstanceSnapshot,
    noteVotes,
    requestClip,
    setCaseLink,
    readIncident,
    saveClip,
    markIn,
    markOut,
    listClips,
    deleteClip,
    readClip,
    openFolder,
    attachIpc,
    syncActivity,
    stop() {
      if (pollTimer) clearInterval(pollTimer);
      if (saveTimer) clearTimeout(saveTimer);
      for (const [, p] of pendingVotes) if (p.timer) clearTimeout(p.timer);
      pendingVotes.clear();
      holdUntil = 0;
      markInAt = null;
      stopRecording(true);
    },
  };
}

module.exports = { createClips, DEFAULTS };
