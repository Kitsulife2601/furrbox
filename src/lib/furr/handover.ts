// Übergabe-Notiz: "write" opens when someone ends their duty, "read" when someone starts
// (only shows notes they have not seen yet), "all" shows the latest notes on request.
import { create } from "zustand";
import { persist } from "zustand/middleware";

type HandoverStore = {
  mode: "write" | "read" | "all" | null;
  /** Notes up to this time were already read on this device. */
  seenAt: string | null;
  open: (mode: "write" | "read" | "all") => void;
  close: () => void;
  markSeen: (at: string) => void;
};

export const useHandover = create<HandoverStore>()(
  persist(
    (set, get) => ({
      mode: null,
      seenAt: null,
      open: (mode) => set({ mode }),
      close: () => set({ mode: null }),
      markSeen: (at) => {
        const seen = get().seenAt;
        if (!seen || at > seen) set({ seenAt: at });
      },
    }),
    { name: "furr-handover", partialize: (s) => ({ seenAt: s.seenAt }) },
  ),
);
