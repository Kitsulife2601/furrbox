// FurrBox VR (arm panel in SteamVR): which areas are shown. Chosen in FurrSettings on the
// desktop; the panel page (/vr) runs in its own window and picks changes up through localStorage.
import { create } from "zustand";
import { persist } from "zustand/middleware";

export const VR_WIDGETS = [
  { id: "clock", label: "Uhr & Welt", hint: "Uhrzeit, aktuelle Welt und wie viele Leute da sind" },
  { id: "votekick", label: "Votekick-Warnung", hint: "Großer Hinweis, sobald jemand einen Votekick startet – mit Starter, wenn VRChat ihn nennt" },
  { id: "instance", label: "Wer ist in der Instanz", hint: "Liste der Leute mit Kommen und Gehen" },
  { id: "chatbox", label: "Chatbox-Schnelltexte", hint: "Knöpfe, die per OSC einen Text in deine VRChat-Chatbox schreiben" },
  { id: "teamchat", label: "Team-Chat", hint: "Die neuesten Nachrichten aus dem FurrChat" },
] as const;

export type VrWidgetId = (typeof VR_WIDGETS)[number]["id"];

const DEFAULT_TEXTS = ["Bin gleich zurück", "Mod im Dienst 🛡️", "Bitte an die Regeln halten", "Brauchst du Hilfe?"];

type VrSettings = {
  widgets: Record<VrWidgetId, boolean>;
  texts: string[];
  setWidget: (id: VrWidgetId, on: boolean) => void;
  setTexts: (texts: string[]) => void;
};

export const useVrSettings = create<VrSettings>()(
  persist(
    (set) => ({
      widgets: { clock: true, votekick: true, instance: true, chatbox: true, teamchat: false },
      texts: DEFAULT_TEXTS,
      setWidget: (id, on) => set((s) => ({ widgets: { ...s.widgets, [id]: on } })),
      setTexts: (texts) => set({ texts: texts.map((t) => t.trim().slice(0, 144)).filter(Boolean).slice(0, 8) }),
    }),
    { name: "furrbox-vr" },
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
