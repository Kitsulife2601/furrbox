// Votekick-Wache auf dem Desktop: Alarm-Ton + Toast (Historie) + Votekick-Panel, sobald VRChat einen
// Votekick loggt (Desktop-App liest das VRChat-Log). Das VR-Panel zeigt dieselbe Warnung am Arm –
// gleiche Event-IDs, gleiche Töne (playSound dedupliziert per eventId), gleiche 45 s Anzeigedauer.
import { useEffect, useRef } from "react";
import { create } from "zustand";
import { useQuery } from "@tanstack/react-query";
import { desktopVrchat, unwrap, type VrcInstanceState, type VrcLogPlayer } from "@/components/furr/VRChat";
import { markVotekickDone } from "@/lib/furr/api/duty";
import { useLiveInterval } from "@/lib/furr/live-interval";
import { playSound } from "@/lib/furr/sounds";
import { useNotifications } from "@/store/notifications";

/** Wie VOTE_ALERT_MS im VR-Panel (src/routes/vr.tsx). */
export const VOTE_ALERT_MS = 45_000;
/** Ältere Votes beim ersten Blick nicht mehr melden. */
const VOTE_FRESH_MS = 60_000;

export type VoteEvent = NonNullable<VrcInstanceState["votes"]>[number];
export type ActiveVote = {
  vote: VoteEvent;
  world: string | null;
  location: string | null;
  /** Spielerliste zum Zeitpunkt, an dem FurrBox den Vote gesehen hat. */
  players: VrcLogPlayer[];
  seenAt: number;
};

type VoteStore = {
  active: ActiveVote[];
  /** Votes, die per „Erledigt“/„Schließen“ weg sind. */
  done: string[];
  /** Panel minimiert (läuft weiter, nur als Taskleisten-Hinweis). */
  collapsed: boolean;
  add: (v: ActiveVote) => void;
  update: (votes: VoteEvent[]) => void;
  dismiss: (id: string) => void;
  setCollapsed: (c: boolean) => void;
};

export const useVoteStore = create<VoteStore>((set) => ({
  active: [],
  done: [],
  collapsed: false,
  add: (v) =>
    set((s) =>
      s.done.includes(v.vote.id) || s.active.some((a) => a.vote.id === v.vote.id)
        ? s
        : { active: [v, ...s.active].slice(0, 5), collapsed: false },
    ),
  // Ergebnis (gekickt/gescheitert) aus dem Log nachziehen.
  update: (votes) =>
    set((s) => {
      let changed = false;
      const active = s.active.map((a) => {
        const v = votes.find((x) => x.id === a.vote.id);
        if (!v || v.result === a.vote.result) return a;
        changed = true;
        return { ...a, vote: v };
      });
      return changed ? { active } : s;
    }),
  dismiss: (id) => set((s) => ({ active: s.active.filter((a) => a.vote.id !== id), done: [...s.done.slice(-40), id] })),
  setCollapsed: (collapsed) => set({ collapsed }),
}));

/** „Erledigt“: Hinweis schließen + Anwesenheits-Protokoll (wie im VR-Panel). */
export async function voteDone(a: ActiveVote) {
  useVoteStore.getState().dismiss(a.vote.id);
  await markVotekickDone({ data: { target: a.vote.target, initiator: a.vote.initiator, world: a.world } });
}

export function useVoteWatch() {
  const bridge = desktopVrchat();
  const hasActive = useVoteStore((s) => s.active.length > 0);
  // Während ein Vote läuft etwas schneller (Ergebnis), sonst 4 s – nur bei sichtbarem Fenster.
  const live = useLiveInterval(hasActive ? 2_500 : 4_000, Boolean(bridge?.instance));
  const inst = useQuery({
    queryKey: ["furr", "votewatch"],
    queryFn: () => unwrap(desktopVrchat()!.instance!()),
    enabled: Boolean(bridge?.instance),
    refetchInterval: live,
  });
  const seen = useRef<Set<string> | null>(null);
  const state = inst.data;
  const votes = state?.votes;

  useEffect(() => {
    if (!votes || !state) return;
    useVoteStore.getState().update(votes);
    // First look: remember what is already there, only warn about new ones.
    if (!seen.current) {
      seen.current = new Set(votes.map((v) => v.id));
      return;
    }
    for (const v of votes) {
      if (seen.current.has(v.id)) continue;
      seen.current.add(v.id);
      if (v.result || Date.now() - new Date(v.at).getTime() > VOTE_FRESH_MS) continue;
      playSound("votekick", { eventId: v.id });
      useVoteStore.getState().add({
        vote: v,
        world: state.worldName,
        location: state.location,
        players: [...state.players],
        seenAt: Date.now(),
      });
      useNotifications.getState().notify({
        id: `vote-${v.id}`,
        version: "VRChat · Votekick",
        kind: "vote",
        tone: "alert",
        // Das Votekick-Panel zeigt den Alarm groß – Toast wäre doppelt, also nur Historie.
        silent: true,
        title: `Votekick gegen ${v.target}`,
        description: v.initiator ? `gestartet von ${v.initiator}` : "Starter wird von VRChat nicht genannt",
        onClick: () => useVoteStore.getState().setCollapsed(false),
      });
    }
  }, [votes, state]);
}
