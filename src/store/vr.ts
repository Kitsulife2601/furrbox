// FurrBox VR (arm panel in SteamVR): which areas are shown. Chosen in FurrSettings on the
// desktop; the panel page (/vr) runs in its own window and picks changes up through localStorage.
import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Small info items; each one can sit in the bar above or below the pages – or be off. */
export const VR_INFOS = [
  { id: "time", label: "Uhrzeit" },
  { id: "date", label: "Datum" },
  { id: "world", label: "Name der Welt" },
  { id: "people", label: "Anzahl Leute in der Instanz" },
  { id: "joined", label: "Wie lange du schon in der Instanz bist" },
  { id: "instanceAge", label: "Wie lange die Instanz schon offen ist" },
  { id: "music", label: "Musik, die gerade läuft" },
] as const;
export type VrInfoId = (typeof VR_INFOS)[number]["id"];
export type VrInfoPlace = "top" | "bottom" | "off";

export const VR_WIDGETS = [
  { id: "votekick", label: "Votekick-Warnung", hint: "Roter Hinweis, sobald jemand einen Votekick startet – mit Starter, wenn VRChat ihn nennt, und „Erledigt“-Knopf" },
  { id: "chatAlert", label: "Hinweis bei neuer Chat-Nachricht", hint: "Kurzer Hinweis am Arm mit der neuen Nachricht aus dem Team-Chat" },
  { id: "instanceAlert", label: "Hinweis bei neuer Gruppen-Instanz", hint: "Meldung am Arm, sobald der Bot eine neu geöffnete Instanz unserer Gruppe sieht" },
  { id: "instance", label: "Wer ist in der Instanz", hint: "Liste der Leute mit Kommen und Gehen" },
  { id: "team", label: "Team-Liste", hint: "Owner, Mods und Supporter – wer anwesend ist und wer nicht, mit deinem Anwesend-Schalter" },
  { id: "music", label: "Musik", hint: "Was gerade läuft (Spotify, YouTube, …) mit Pause und Weiter" },
  { id: "chatbox", label: "Chatbox-Schnelltexte", hint: "Knöpfe, die per OSC einen Text in deine VRChat-Chatbox schreiben" },
  { id: "teamchat", label: "Team-Chat", hint: "Die neuesten Nachrichten aus dem FurrChat" },
] as const;

export type VrWidgetId = (typeof VR_WIDGETS)[number]["id"];

const DEFAULT_TEXTS = [
  "Bin gleich zurück",
  "Moderation anwesend",
  "Mod im Dienst 🛡️",
  "Bitte an die Regeln halten",
  "Brauchst du Hilfe?",
  "Kurz AFK – gleich zurück",
];

/** Moderation-Schnelltexte (Chatbox); Rate-Limit liegt in der VR-UI (OSC pausiert Status 10 s). */
export const VR_MOD_TEMPLATES = [
  "Moderation anwesend",
  "Bitte an die Regeln halten",
  "Votekick läuft – bitte abstimmen",
  "Incident wird dokumentiert",
] as const;

export type VrWatchEntry = { id: string; name?: string };

/** Anpinnbare Wrist-Shortcuts (Shared-Icons über Lucide wie Desktop-Taskbar). */
export const VR_SHORTCUTS = [
  { id: "instance", label: "Instanz", appHint: "worldmap" },
  { id: "team", label: "Team", appHint: "presence" },
  { id: "music", label: "Musik", appHint: null },
  { id: "chatbox", label: "Chatbox", appHint: null },
  { id: "teamchat", label: "Chat", appHint: null },
  { id: "staff", label: "Staff", appHint: "moddash" },
  { id: "keyboard", label: "Tastatur", appHint: null },
  { id: "presets", label: "Layouts", appHint: "settings" },
  { id: "clip", label: "Clip", appHint: null },
] as const;
export type VrShortcutId = (typeof VR_SHORTCUTS)[number]["id"];

export type VrPresetId = "streaming" | "chill" | "event";

export type VrPresetSnapshot = {
  widgets: Record<VrWidgetId, boolean>;
  infos: Record<VrInfoId, VrInfoPlace>;
  buttonMode: boolean;
  gazeOpen: boolean;
  pointOpen: boolean;
  wristPins: VrShortcutId[];
  keyboardDocked: boolean;
  keyboardScale: number;
};

function defaultPreset(id: VrPresetId): VrPresetSnapshot {
  const baseWidgets: Record<VrWidgetId, boolean> = {
    votekick: true,
    chatAlert: true,
    instanceAlert: true,
    instance: true,
    team: true,
    music: true,
    chatbox: true,
    teamchat: true,
  };
  const baseInfos: Record<VrInfoId, VrInfoPlace> = {
    time: "top",
    world: "top",
    people: "top",
    date: "off",
    joined: "bottom",
    instanceAge: "bottom",
    music: "off",
  };
  if (id === "streaming") {
    return {
      widgets: { ...baseWidgets, music: true, teamchat: false, chatbox: true, instance: false },
      infos: { ...baseInfos, world: "top", people: "top", music: "top", joined: "off", instanceAge: "off", date: "off" },
      buttonMode: true,
      gazeOpen: false,
      pointOpen: true,
      wristPins: ["music", "chatbox", "clip", "keyboard"],
      keyboardDocked: true,
      keyboardScale: 1,
    };
  }
  if (id === "chill") {
    return {
      widgets: { ...baseWidgets, votekick: true, music: true, teamchat: true },
      infos: { ...baseInfos, music: "bottom", date: "top" },
      buttonMode: true,
      gazeOpen: false,
      pointOpen: true,
      wristPins: ["music", "teamchat", "instance", "keyboard"],
      keyboardDocked: true,
      keyboardScale: 1.05,
    };
  }
  // event
  return {
    widgets: { ...baseWidgets, votekick: true, instanceAlert: true, team: true, instance: true, chatbox: true },
    infos: { ...baseInfos, people: "top", world: "top", instanceAge: "top", joined: "bottom" },
    buttonMode: true,
    gazeOpen: false,
    pointOpen: true,
    wristPins: ["staff", "instance", "team", "clip", "chatbox"],
    keyboardDocked: true,
    keyboardScale: 1,
  };
}

type VrSettings = {
  widgets: Record<VrWidgetId, boolean>;
  infos: Record<VrInfoId, VrInfoPlace>;
  texts: string[];
  /** Lokale Watchlist (usr_… / Name) bis Server-Watchlist liefert. */
  watchlist: VrWatchEntry[];
  setWatchlist: (entries: VrWatchEntry[]) => void;
  /** Away = nicht im Dienst, aber sichtbar als Pause (nur lokal; Server kennt nur on/off). */
  dutyAway: boolean;
  setDutyAway: (on: boolean) => void;
  /** Hinweise/Toasts am Overlay stumm (Quick-Action). */
  muteAlerts: boolean;
  setMuteAlerts: (on: boolean) => void;
  /** true = only a small button on the arm; the panel opens on a tap or when something happens. */
  buttonMode: boolean;
  setButtonMode: (on: boolean) => void;
  /** Open the window by looking at your arm. */
  gazeOpen: boolean;
  setGazeOpen: (on: boolean) => void;
  /** Open the window by pointing at the wrist widget with the other controller / finger. */
  pointOpen: boolean;
  setPointOpen: (on: boolean) => void;
  /** Permanent status in the VRChat chatbox (sent again every few seconds by the desktop app). */
  status: { enabled: boolean; items: VrInfoId[]; text: string };
  setStatus: (patch: Partial<VrSettings["status"]>) => void;
  setWidget: (id: VrWidgetId, on: boolean) => void;
  setInfo: (id: VrInfoId, place: VrInfoPlace) => void;
  setTexts: (texts: string[]) => void;

  /** Scout: Wrist-Pins (max 8). */
  wristPins: VrShortcutId[];
  toggleWristPin: (id: VrShortcutId) => void;
  setWristPins: (ids: VrShortcutId[]) => void;

  /** Scout: Workspace-Presets. */
  presets: Partial<Record<VrPresetId, VrPresetSnapshot>>;
  applyPreset: (id: VrPresetId) => void;
  savePresetFromCurrent: (id: VrPresetId) => void;

  /** Scout: Overlay-Tastatur. */
  keyboardDocked: boolean;
  setKeyboardDocked: (on: boolean) => void;
  keyboardLocked: boolean;
  setKeyboardLocked: (on: boolean) => void;
  keyboardScale: number;
  setKeyboardScale: (n: number) => void;
  streamerMode: boolean;
  setStreamerMode: (on: boolean) => void;
  keyboardPasswordMode: boolean;
  setKeyboardPasswordMode: (on: boolean) => void;
  keyboardHistory: string[];
  pushKeyboardHistory: (text: string) => void;
};

const DEFAULT_PINS: VrShortcutId[] = ["instance", "team", "music", "chatbox", "keyboard"];

function snapshotFrom(s: {
  widgets: Record<VrWidgetId, boolean>;
  infos: Record<VrInfoId, VrInfoPlace>;
  buttonMode: boolean;
  gazeOpen: boolean;
  pointOpen: boolean;
  wristPins: VrShortcutId[];
  keyboardDocked: boolean;
  keyboardScale: number;
}): VrPresetSnapshot {
  return {
    widgets: { ...s.widgets },
    infos: { ...s.infos },
    buttonMode: s.buttonMode,
    gazeOpen: s.gazeOpen,
    pointOpen: s.pointOpen,
    wristPins: [...s.wristPins],
    keyboardDocked: s.keyboardDocked,
    keyboardScale: s.keyboardScale,
  };
}

export const useVrSettings = create<VrSettings>()(
  persist(
    (set, get) => ({
      widgets: { votekick: true, chatAlert: true, instanceAlert: true, instance: true, team: true, music: true, chatbox: true, teamchat: true },
      infos: { time: "top", world: "top", people: "top", date: "off", joined: "bottom", instanceAge: "bottom", music: "off" },
      buttonMode: true,
      setButtonMode: (buttonMode) => set({ buttonMode }),
      gazeOpen: false,
      setGazeOpen: (gazeOpen) => set({ gazeOpen }),
      pointOpen: true,
      setPointOpen: (pointOpen) => set({ pointOpen }),
      texts: DEFAULT_TEXTS,
      watchlist: [],
      setWatchlist: (watchlist) =>
        set({
          watchlist: watchlist
            .map((e) => ({ id: String(e.id ?? "").trim(), name: e.name ? String(e.name).trim().slice(0, 80) : undefined }))
            .filter((e) => e.id)
            .slice(0, 40),
        }),
      dutyAway: false,
      setDutyAway: (dutyAway) => set({ dutyAway }),
      muteAlerts: false,
      setMuteAlerts: (muteAlerts) => set({ muteAlerts }),
      status: { enabled: false, items: ["time", "people", "joined"], text: "" },
      setStatus: (patch) => set((s) => ({ status: { ...s.status, ...patch } })),
      setWidget: (id, on) => set((s) => ({ widgets: { ...s.widgets, [id]: on } })),
      setInfo: (id, place) => set((s) => ({ infos: { ...s.infos, [id]: place } })),
      setTexts: (texts) => set({ texts: texts.map((t) => t.trim().slice(0, 144)).filter(Boolean).slice(0, 8) }),

      wristPins: DEFAULT_PINS,
      toggleWristPin: (id) =>
        set((s) => {
          const has = s.wristPins.includes(id);
          const wristPins = has ? s.wristPins.filter((x) => x !== id) : [...s.wristPins, id].slice(0, 8);
          return { wristPins };
        }),
      setWristPins: (ids) =>
        set({
          wristPins: ids.filter((id, i, a) => a.indexOf(id) === i).slice(0, 8),
        }),

      presets: {
        streaming: defaultPreset("streaming"),
        chill: defaultPreset("chill"),
        event: defaultPreset("event"),
      },
      applyPreset: (id) => {
        const snap = get().presets[id] ?? defaultPreset(id);
        set({
          widgets: { ...snap.widgets },
          infos: { ...snap.infos },
          buttonMode: snap.buttonMode,
          gazeOpen: snap.gazeOpen,
          pointOpen: snap.pointOpen,
          wristPins: [...snap.wristPins].slice(0, 8),
          keyboardDocked: snap.keyboardDocked,
          keyboardScale: snap.keyboardScale,
        });
      },
      savePresetFromCurrent: (id) => {
        const s = get();
        set({
          presets: {
            ...s.presets,
            [id]: snapshotFrom(s),
          },
        });
      },

      keyboardDocked: true,
      setKeyboardDocked: (keyboardDocked) => set({ keyboardDocked }),
      keyboardLocked: false,
      setKeyboardLocked: (keyboardLocked) => set({ keyboardLocked }),
      keyboardScale: 1,
      setKeyboardScale: (keyboardScale) => set({ keyboardScale: Math.min(1.3, Math.max(0.85, keyboardScale)) }),
      streamerMode: false,
      setStreamerMode: (streamerMode) => set({ streamerMode }),
      keyboardPasswordMode: false,
      setKeyboardPasswordMode: (keyboardPasswordMode) => set({ keyboardPasswordMode }),
      keyboardHistory: [],
      pushKeyboardHistory: (text) =>
        set((s) => {
          const t = text.trim().slice(0, 144);
          if (!t) return s;
          return { keyboardHistory: [t, ...s.keyboardHistory.filter((x) => x !== t)].slice(0, 24) };
        }),
    }),
    {
      name: "furrbox-vr",
      version: 5,
      migrate: (state, version) => {
        const s = { ...(state as VrSettings) };
        if (version < 3) {
          s.gazeOpen = false;
          s.pointOpen = true;
        }
        if (version < 4) {
          s.dutyAway = false;
          s.muteAlerts = false;
          s.watchlist = s.watchlist ?? [];
        }
        if (version < 5) {
          s.wristPins = s.wristPins?.length ? s.wristPins : DEFAULT_PINS;
          s.presets = {
            streaming: defaultPreset("streaming"),
            chill: defaultPreset("chill"),
            event: defaultPreset("event"),
            ...(s.presets ?? {}),
          };
          s.keyboardDocked = s.keyboardDocked ?? true;
          s.keyboardLocked = s.keyboardLocked ?? false;
          s.keyboardScale = s.keyboardScale ?? 1;
          s.streamerMode = s.streamerMode ?? false;
          s.keyboardPasswordMode = s.keyboardPasswordMode ?? false;
          s.keyboardHistory = s.keyboardHistory ?? [];
        }
        return s;
      },
      merge: (saved, current) => ({
        ...current,
        ...(saved as object),
        infos: { ...current.infos, ...((saved as Partial<VrSettings>)?.infos ?? {}) },
        widgets: { ...current.widgets, ...((saved as Partial<VrSettings>)?.widgets ?? {}) },
        status: { ...current.status, ...((saved as Partial<VrSettings>)?.status ?? {}) },
        watchlist: (saved as Partial<VrSettings>)?.watchlist ?? current.watchlist,
        wristPins: (saved as Partial<VrSettings>)?.wristPins ?? current.wristPins,
        presets: { ...current.presets, ...((saved as Partial<VrSettings>)?.presets ?? {}) },
        keyboardHistory: (saved as Partial<VrSettings>)?.keyboardHistory ?? current.keyboardHistory,
      }),
    },
  ),
);

/** Keeps this window in sync when another FurrBox window changes the settings. */
export function syncVrSettings() {
  const onStorage = (e: StorageEvent) => {
    if (e.key === "furrbox-vr") void useVrSettings.persist.rehydrate();
  };
  window.addEventListener("storage", onStorage);
  // The panel page is rendered offscreen, where the storage event is not reliable – also check regularly.
  let last = localStorage.getItem("furrbox-vr");
  const timer = window.setInterval(() => {
    const now = localStorage.getItem("furrbox-vr");
    if (now === last) return;
    last = now;
    void useVrSettings.persist.rehydrate();
  }, 1500);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.clearInterval(timer);
  };
}