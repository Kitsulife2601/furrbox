// Vorbefüllter Evidence-Fall aus Votekick-Panel / Staff-Tools („Fall anlegen“, „Incident markieren“).
// Evidence → „Neuer Fall“ übernimmt den Entwurf, auch wenn das Fenster schon offen ist.
import { create } from "zustand";

export type CaseDraft = {
  platform: "Discord" | "VRChat";
  targetPrimary: string;
  targetSecondary?: string;
  notes: string;
  category?: string;
  /** Optional: lokaler Desktop-Clip, der gleich als Datei angehängt wird. */
  clipId?: string;
};

type CaseDraftStore = {
  draft: (CaseDraft & { at: number }) | null;
  set: (draft: CaseDraft) => void;
  take: () => CaseDraft | null;
};

export const useCaseDraft = create<CaseDraftStore>((set, get) => ({
  draft: null,
  set: (draft) => set({ draft: { ...draft, at: Date.now() } }),
  take: () => {
    const d = get().draft;
    if (d) set({ draft: null });
    return d;
  },
}));

/** Spielerliste kompakt für Notizen (max. 40 Namen). */
export function playersNote(players: { name: string }[], heading = "Spieler in der Instanz") {
  if (!players.length) return `${heading}: keine Daten`;
  const names = players.slice(0, 40).map((p) => p.name);
  return `${heading} (${players.length}): ${names.join(", ")}${players.length > 40 ? ", …" : ""}`;
}

const CASE_REF_RE = /\[Fall: ([^\]\s]+)\]/;

/** Hängt „[Fall: <id>]“ an eine Begründung (Discord-Limit 512 Zeichen bleibt eingehalten). */
export function withCaseRef(reason: string, caseId: string | null, max = 512) {
  const r = reason.trim();
  if (!caseId) return r.slice(0, max);
  const tag = ` [Fall: ${caseId}]`;
  return `${r.slice(0, Math.max(0, max - tag.length))}${tag}`;
}

/** Fall-ID aus einer Begründung lesen (gesetzt vom Bann-Dialog) – sonst null. */
export function parseCaseRef(text: string | null | undefined) {
  return text?.match(CASE_REF_RE)?.[1] ?? null;
}
