// „Akte öffnen“ from anywhere (case list, sanctions, watchlist): FurrEvidence jumps to the
// "Personen" tab and shows that person.
import { create } from "zustand";
import type { PersonRef } from "./api/person";

type PersonFileStore = {
  target: (PersonRef & { at: number }) | null;
  open: (ref: PersonRef) => void;
  close: () => void;
};

export const usePersonFile = create<PersonFileStore>((set) => ({
  target: null,
  open: (ref) => set({ target: { ...ref, at: Date.now() } }),
  close: () => set({ target: null }),
}));
