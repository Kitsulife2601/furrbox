// Browser side of big evidence files on the Discord bot's PC: send in pieces, fetch in pieces.
import { fileToBase64 } from "./client";
import { finishBotUpload, getBotFileStatus, readBotChunk, requestBotFile, uploadBotChunk } from "./api/botfiles";
import { BOT_CHUNK_BYTES, MAX_CLIP_SECONDS } from "./paths";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Length of a video file in seconds (null when the browser can't read it). */
export function videoSeconds(file: File) {
  return new Promise<number | null>((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
    video.src = url;
  });
}

/** Rejects videos longer than a clip (MAX_CLIP_SECONDS). Returns an error text or null. */
export async function checkClip(file: File) {
  if (!file.type.startsWith("video/")) return null;
  const seconds = await videoSeconds(file);
  if (seconds !== null && seconds > MAX_CLIP_SECONDS + 1) {
    const min = Math.floor(seconds / 60);
    const sec = Math.round(seconds % 60);
    return `„${file.name}“ ist ${min}:${String(sec).padStart(2, "0")} Min. lang – Videos dürfen höchstens ${MAX_CLIP_SECONDS / 60} Minuten lang sein. Bitte kürze den Clip.`;
  }
  return null;
}

export async function uploadToBot(file: File, fileId: string, onProgress: (sent: number) => void) {
  const chunks = Math.max(1, Math.ceil(file.size / BOT_CHUNK_BYTES));
  for (let idx = 0; idx < chunks; idx += 1) {
    const base64 = await fileToBase64(file.slice(idx * BOT_CHUNK_BYTES, (idx + 1) * BOT_CHUNK_BYTES));
    for (let tries = 0; ; tries += 1) {
      const { wait } = await uploadBotChunk({ data: { fileId, idx, base64 } });
      if (!wait) break;
      if (tries > 300) throw new Error("Der Discord-Bot nimmt die Datei gerade nicht an.");
      await sleep(1000);
    }
    onProgress(Math.min(file.size, (idx + 1) * BOT_CHUNK_BYTES));
  }
  await finishBotUpload({ data: { fileId, chunks } });
}

/** Fetches a file from the bot's PC. `onProgress` gets the number of pieces received. */
export async function downloadFromBot(fileId: string, onProgress?: (pieces: number) => void) {
  await requestBotFile({ data: fileId });
  const parts: Uint8Array[] = [];
  let idle = 0;
  for (let idx = 0; ; ) {
    const { base64 } = await readBotChunk({ data: { fileId, idx } });
    if (base64 !== null) {
      parts.push(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
      idx += 1;
      idle = 0;
      onProgress?.(idx);
      continue;
    }
    const status = await getBotFileStatus({ data: fileId });
    const d = status.download;
    if (d?.status === "failed") throw new Error(d.error ?? "Der Bot konnte die Datei nicht senden.");
    if (d?.status === "done" && d.totalChunks !== null && idx >= d.totalChunks) break;
    idle += 1;
    if (idle > 90) throw new Error("Der Discord-Bot antwortet nicht. Läuft er auf dem PC?");
    await sleep(1000);
  }
  return parts;
}
