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
  { id: "votekick", label: "Votekick-Warnung", hint: "Großer Hinweis, sobald jemand einen Votekick startet – mit Starter, wenn VRChat ihn nennt" },
  { id: "chatAlert", label: "Hinweis bei neuer Chat-Nachricht", hint: "Das Fenster klappt auf und zeigt die neue Nachricht aus dem Team-Chat" },
  { id: "instanceAlert", label: "Hinweis bei neuer Gruppen-Instanz", hint: "Meldung am Arm, sobald der Bot eine neu geöffnete Instanz unserer Gruppe sieht" },
  { id: "instance", label: "Wer ist in der Instanz", hint: "Liste der Leute mit Kommen und Gehen" },
  { id: "team", label: "Team-Liste", hint: "Owner, Mods und Supporter – wer gerade bereit zum Moderieren ist und wer nicht" },
  { id: "music", label: "Musik", hint: "Was gerade läuft (Spotify, YouTube, …) mit Pause und Weiter" },
  { id: "chatbox", label: "Chatbox-Schnelltexte", hint: "Knöpfe, die per OSC einen Text in deine VRChat-Chatbox schreiben" },
  { id: "teamchat", label: "Team-Chat", hint: "Die neuesten Nachrichten aus dem FurrChat" },
] as const;

export type VrWidgetId = (typeof VR_WIDGETS)[number]["id"];

const DEFAULT_TEXTS = ["Bin gleich zurück", "Mod im Dienst 🛡️", "Bitte an die Regeln halten", "Brauchst du Hilfe?"];

type VrSettings = {
  widgets: Record<VrWidgetId, boolean>;
  infos: Record<VrInfoId, VrInfoPlace>;
  texts: string[];
  /** true = only a small button on the arm; the panel opens on a tap or when something happens. */
  buttonMode: boolean;
  setButtonMode: (on: boolean) => void;
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
      texts: DEFAULT_TEXTS,
      status: { enabled: false, items: ["time", "people", "joined"], text: "" },
      setStatus: (patch) => set((s) => ({ status: { ...s.status, ...patch } })),
      setWidget: (id, on) => set((s) => ({ widgets: { ...s.widgets, [id]: on } })),
      setInfo: (id, place) => set((s) => ({ infos: { ...s.infos, [id]: place } })),
      setTexts: (texts) => set({ texts: texts.map((t) => t.trim().slice(0, 144)).filter(Boolean).slice(0, 8) }),
    }),
    { name: "furrbox-vr", version: 2, migrate: (state) => state as VrSettings, merge: (saved, current) => ({ ...current, ...(saved as object), infos: { ...current.infos, ...((saved as Partial<VrSettings>)?.infos ?? {}) }, widgets: { ...current.widgets, ...((saved as Partial<VrSettings>)?.widgets ?? {}) }, status: { ...current.status, ...((saved as Partial<VrSettings>)?.status ?? {}) } }) },
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
