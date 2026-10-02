// Big evidence files (no size limit) are stored here on the bot's PC. FurrBox relays them in pieces:
// the bot takes uploaded pieces (/api/bridge/file-take) and sends pieces of requested files back
// (/api/bridge/file-down). Folder: FURRBOX_STORAGE_DIR or bot/beweise next to this file.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  process.env.FURRBOX_STORAGE_DIR ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), "beweise"),
);
/** Must match BOT_CHUNK_BYTES in src/lib/furr/paths.ts. */
const CHUNK = 2 * 1024 * 1024;
/** Pieces of a download waiting in FurrBox before the bot pauses. */
const MAX_PENDING_DOWN = 8;

const running = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function target(folder, name) {
  const full = path.resolve(ROOT, ...String(folder).split("/"), String(name));
  if (!full.startsWith(ROOT + path.sep)) throw new Error("Ungültiger Pfad.");
  return full;
}

/** True while a transfer runs – the bot then polls FurrBox faster. */
export function filesBusy() {
  return running.size > 0;
}

async function receive(bridge, log, u) {
  let idle = 0;
  try {
    const file = target(u.folder, u.name);
    const part = `${file}.part`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Resume after a restart: every piece except the last one is exactly CHUNK bytes.
    let idx = fs.existsSync(part) ? Math.floor(fs.statSync(part).size / CHUNK) : 0;
    if (fs.existsSync(part)) fs.truncateSync(part, idx * CHUNK);
    for (;;) {
      const r = await bridge("file-take", { fileId: u.fileId, idx });
      if (r.data) {
        fs.appendFileSync(part, Buffer.from(r.data, "base64"));
        idx += 1;
        idle = 0;
        continue;
      }
      if (r.totalChunks !== null && idx >= r.totalChunks) {
        fs.renameSync(part, file);
        await bridge("file-stored", { fileId: u.fileId, ok: true });
        log(`Beweisdatei gespeichert: ${path.relative(ROOT, file)}`);
        return;
      }
      if (!r.active) return;
      // The uploader is still sending – wait a moment (give up after ~2 minutes of silence).
      idle += 1;
      if (idle > 120) return;
      await sleep(1000);
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log("Beweisdatei-Upload fehlgeschlagen:", error);
    await bridge("file-stored", { fileId: u.fileId, ok: false, error }).catch(() => undefined);
  }
}

async function send(bridge, log, d) {
  try {
    const file = target(d.folder, d.name);
    if (!fs.existsSync(file)) throw new Error("Die Datei liegt nicht (mehr) auf dem PC des Bots.");
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(CHUNK);
    let idx = 0;
    try {
      for (;;) {
        const n = fs.readSync(fd, buf, 0, CHUNK, idx * CHUNK);
        if (n <= 0) break;
        let r = await bridge("file-down", {
          fileId: d.fileId,
          idx,
          data: buf.subarray(0, n).toString("base64"),
        });
        if (r.cancelled) return;
        idx += 1;
        // Wait while the viewer has not picked up the earlier pieces yet.
        for (let tries = 0; r.pending >= MAX_PENDING_DOWN && tries < 120; tries += 1) {
          await sleep(1000);
          r = await bridge("file-down", { fileId: d.fileId });
        }
        if (n < CHUNK) break;
      }
    } finally {
      fs.closeSync(fd);
    }
    await bridge("file-down-done", { fileId: d.fileId, ok: true, totalChunks: idx });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log("Beweisdatei senden fehlgeschlagen:", error);
    await bridge("file-down-done", { fileId: d.fileId, ok: false, error }).catch(() => undefined);
  }
}

/** Called with `queue.botFiles` on every poll; transfers run in the background. */
export function handleBotFiles(bridge, log, botFiles) {
  const jobs = [
    ...(botFiles?.uploads ?? []).map((u) => ({
      key: `up:${u.fileId}`,
      run: () => receive(bridge, log, u),
    })),
    ...(botFiles?.downloads ?? []).map((d) => ({
      key: `down:${d.fileId}`,
      run: () => send(bridge, log, d),
    })),
  ];
  for (const job of jobs) {
    if (running.has(job.key)) continue;
    running.add(job.key);
    job
      .run()
      .catch((err) => log("Beweisdatei:", err instanceof Error ? err.message : err))
      .finally(() => running.delete(job.key));
  }
}
