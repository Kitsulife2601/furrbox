// Notification sounds, made in the browser (no audio files): one each for a chat message, an
// update and a vote kick – different enough to tell them apart without looking.
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SoundKind = "chat" | "update" | "votekick";

export const SOUNDS: { id: SoundKind; label: string; hint: string }[] = [
  { id: "chat", label: "Chat-Nachricht", hint: "kurzes, helles „Pling“" },
  { id: "update", label: "Update verfügbar", hint: "drei aufsteigende Töne" },
  { id: "votekick", label: "Votekick", hint: "Glockenspiel, das zweimal ruft" },
];

type SoundSettings = {
  enabled: Record<SoundKind, boolean>;
  /** 0–100 */
  volume: number;
  setEnabled: (kind: SoundKind, on: boolean) => void;
  setVolume: (volume: number) => void;
};

export const useSounds = create<SoundSettings>()(
  persist(
    (set) => ({
      enabled: { chat: true, update: true, votekick: true },
      volume: 70,
      setEnabled: (kind, on) => set((s) => ({ enabled: { ...s.enabled, [kind]: on } })),
      setVolume: (volume) => set({ volume: Math.min(100, Math.max(0, Math.round(volume))) }),
    }),
    { name: "furrbox-sounds" },
  ),
);

type Note = { freq: number; at: number; length: number; type?: OscillatorType; gain?: number };

// at / length in seconds.
const TUNES: Record<SoundKind, Note[]> = {
  // Two soft, bright notes going up.
  chat: [
    { freq: 880, at: 0, length: 0.14, type: "sine" },
    { freq: 1318.5, at: 0.1, length: 0.22, type: "sine" },
  ],
  // A friendly rising chord: C – E – G – C.
  update: [
    { freq: 523.25, at: 0, length: 0.16, type: "triangle" },
    { freq: 659.25, at: 0.13, length: 0.16, type: "triangle" },
    { freq: 783.99, at: 0.26, length: 0.16, type: "triangle" },
    { freq: 1046.5, at: 0.39, length: 0.4, type: "triangle" },
  ],
  // A bell-like call, played twice: G – D – G' with a soft overtone, so it is noticed without being harsh.
  votekick: [0, 0.62].flatMap((start): Note[] =>
    [
      { freq: 783.99, at: 0, length: 0.3 },
      { freq: 1174.66, at: 0.13, length: 0.3 },
      { freq: 1567.98, at: 0.26, length: 0.5 },
    ].flatMap((n): Note[] => [
      { freq: n.freq, at: start + n.at, length: n.length, type: "sine" },
      { freq: n.freq * 2, at: start + n.at, length: n.length * 0.6, type: "sine", gain: 0.25 },
    ]),
  ),
};

/** Your own sound file per kind (kept in this browser / app, max. ~600 KB each). */
export const MAX_CUSTOM_SOUND_BYTES = 600 * 1024;
const fileKey = (kind: SoundKind) => `furrbox-sound-file-${kind}`;

export function customSound(kind: SoundKind): { name: string; dataUrl: string } | null {
  try {
    const raw = localStorage.getItem(fileKey(kind));
    return raw ? (JSON.parse(raw) as { name: string; dataUrl: string }) : null;
  } catch {
    return null;
  }
}

export function setCustomSound(kind: SoundKind, file: File | null) {
  return new Promise<void>((resolve, reject) => {
    if (!file) {
      localStorage.removeItem(fileKey(kind));
      return resolve();
    }
    if (!file.type.startsWith("audio/")) return reject(new Error("Bitte eine Tondatei auswählen (z. B. MP3, WAV oder OGG)."));
    if (file.size > MAX_CUSTOM_SOUND_BYTES) return reject(new Error("Die Datei ist zu groß (max. 600 KB) – nimm einen kurzen Ton."));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Die Datei konnte nicht gelesen werden."));
    reader.onload = () => {
      try {
        localStorage.setItem(fileKey(kind), JSON.stringify({ name: file.name.slice(0, 80), dataUrl: String(reader.result) }));
        resolve();
      } catch {
        reject(new Error("Der Speicher ist voll – nimm eine kleinere Datei."));
      }
    };
    reader.readAsDataURL(file);
  });
}

let context: AudioContext | null = null;

function audio() {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  context ??= new Ctor();
  if (context.state === "suspended") void context.resume().catch(() => undefined);
  return context;
}

/**
 * FurrBox can be open in two windows at once (desktop and the VR panel). `eventId` makes sure the
 * same event (a chat message, a vote kick) only sounds once.
 */
function alreadyPlayed(kind: SoundKind, eventId: string) {
  try {
    const key = `furrbox-sound-${kind}`;
    if (localStorage.getItem(key) === eventId) return true;
    localStorage.setItem(key, eventId);
  } catch {
    // Storage blocked: rather play twice than not at all.
  }
  return false;
}

export function playSound(kind: SoundKind, options: { eventId?: string; force?: boolean } = {}) {
  const settings = useSounds.getState();
  if (!options.force && !settings.enabled[kind]) return;
  if (options.eventId && alreadyPlayed(kind, options.eventId)) return;
  // Your own sound file, if you picked one.
  const custom = customSound(kind);
  if (custom) {
    const player = new Audio(custom.dataUrl);
    player.volume = settings.volume / 100;
    void player.play().catch(() => undefined);
    return;
  }
  const ctx = audio();
  if (!ctx) return;
  const master = ctx.createGain();
  master.gain.value = (settings.volume / 100) * 0.5;
  master.connect(ctx.destination);
  const now = ctx.currentTime + 0.02;
  for (const note of TUNES[kind]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = note.type ?? "sine";
    osc.frequency.value = note.freq;
    const start = now + note.at;
    const peak = note.gain ?? 1;
    // Short fade in and out, so the notes do not click.
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, start + note.length);
    osc.connect(gain).connect(master);
    osc.start(start);
    osc.stop(start + note.length + 0.03);
  }
}
