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
] as const;
export type VrInfoId = (typeof VR_INFOS)[number]["id"];
export type VrInfoPlace = "top" | "bottom" | "off";

export const VR_WIDGETS = [
  { id: "votekick", label: "Votekick-Warnung", hint: "Großer Hinweis, sobald jemand einen Votekick startet – mit Starter, wenn VRChat ihn nennt" },
  { id: "instance", label: "Wer ist in der Instanz", hint: "Liste der Leute mit Kommen und Gehen" },
  { id: "chatbox", label: "Chatbox-Schnelltexte", hint: "Knöpfe, die per OSC einen Text in deine VRChat-Chatbox schreiben" },
  { id: "teamchat", label: "Team-Chat", hint: "Die neuesten Nachrichten aus dem FurrChat" },
] as const;

export type VrWidgetId = (typeof VR_WIDGETS)[number]["id"];

const DEFAULT_TEXTS = ["Bin gleich zurück", "Mod im Dienst 🛡️", "Bitte an die Regeln halten", "Brauchst du Hilfe?"];

type VrSettings = {
  widgets: Record<VrWidgetId, boolean>;
  infos: Record<VrInfoId, VrInfoPlace>;
  texts: string[];
  setWidget: (id: VrWidgetId, on: boolean) => void;
  setInfo: (id: VrInfoId, place: VrInfoPlace) => void;
  setTexts: (texts: string[]) => void;
};

export const useVrSettings = create<VrSettings>()(
  persist(
    (set) => ({
      widgets: { votekick: true, instance: true, chatbox: true, teamchat: false },
      infos: { time: "top", world: "top", people: "top", date: "off", joined: "bottom", instanceAge: "bottom" },
      texts: DEFAULT_TEXTS,
      setWidget: (id, on) => set((s) => ({ widgets: { ...s.widgets, [id]: on } })),
      setInfo: (id, place) => set((s) => ({ infos: { ...s.infos, [id]: place } })),
      setTexts: (texts) => set({ texts: texts.map((t) => t.trim().slice(0, 144)).filter(Boolean).slice(0, 8) }),
    }),
    { name: "furrbox-vr", version: 2, migrate: (state) => state as VrSettings, merge: (saved, current) => ({ ...current, ...(saved as object), infos: { ...current.infos, ...((saved as Partial<VrSettings>)?.infos ?? {}) }, widgets: { ...current.widgets, ...((saved as Partial<VrSettings>)?.widgets ?? {}) } }) },
  ),
);

/** Keeps this window in sync when another FurrBox window changes the settings. */
export function syncVrSettings() {
  const onStorage = (e: StorageEvent) => {
    if (e.key === "furrbox-vr") void useVrSettings.persist.rehydrate();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
