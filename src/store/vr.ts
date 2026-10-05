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
};

export const useVrSettings = create<VrSettings>()(
  persist(
    (set) => ({
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
    }),
    { name: "furrbox-vr", version: 4, migrate: (state, version) => {
      const s = { ...(state as VrSettings) };
      if (version < 3) { s.gazeOpen = false; s.pointOpen = true; }
      if (version < 4) { s.dutyAway = false; s.muteAlerts = false; s.watchlist = s.watchlist ?? []; }
      return s;
    }, merge: (saved, current) => ({ ...current, ...(saved as object), infos: { ...current.infos, ...((saved as Partial<VrSettings>)?.infos ?? {}) }, widgets: { ...current.widgets, ...((saved as Partial<VrSettings>)?.widgets ?? {}) }, status: { ...current.status, ...((saved as Partial<VrSettings>)?.status ?? {}) }, watchlist: ((saved as Partial<VrSettings>)?.watchlist ?? current.watchlist) }) },
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
