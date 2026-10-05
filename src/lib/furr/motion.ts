/**
 * Shared desktop feedback timings.
 * Gold standard: Votekick tune in sounds.ts (note gap 0.13s, soft attack 12ms)
 * plus the spring pop used by splash paw / sticker (cubic-bezier(0.3, 1.6, 0.5, 1)).
 * Boot, toasts, flyouts and update UI should feel like that path — snappy, not sluggish.
 */
export const MOTION = {
  /** Votekick note spacing (sounds.ts TUNES.votekick). */
  noteGapMs: 130,
  /** Soft oscillator attack before each note. */
  attackMs: 12,
  /** Spring pop (splash paw, sticker). */
  popMs: 450,
  easePop: "cubic-bezier(0.3, 1.6, 0.5, 1)",
  /** Short panel / window enter (matches furr-vr-window). */
  enterMs: 180,
  easeOut: "ease-out",
  /** Toast linger: long enough to read after the ~1.4s votekick call. */
  toastMs: 5200,
  /** Toast exit fade. */
  toastOutMs: 180,
  /** Boot message step ≈ 3× note gap — readable, still snappy. */
  bootStepMs: 390,
  /** Hold on "Willkommen" before zoom-out. */
  bootHoldMs: 390,
  /** Boot zoom-out into lock screen — same length as spring pop. */
  bootExitMs: 450,
  /** Attention pulse (VR votekick alert). */
  alertPulseMs: 900,
} as const;

export type Motion = typeof MOTION;
