// Vote kick warning on the desktop: a toast and the alarm sound as soon as VRChat logs a vote kick
// (read by the desktop app from the VRChat log). The VR panel shows the same warning on the arm.
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { desktopVrchat, unwrap } from "@/components/furr/VRChat";
import { playSound } from "@/lib/furr/sounds";
import { useNotifications } from "@/store/notifications";

export function useVoteWatch() {
  const bridge = desktopVrchat();
  const inst = useQuery({
    queryKey: ["furr", "votewatch"],
    queryFn: () => unwrap(desktopVrchat()!.instance!()),
    enabled: Boolean(bridge?.instance),
    refetchInterval: 4_000,
  });
  const seen = useRef<Set<string> | null>(null);
  const votes = inst.data?.votes;

  useEffect(() => {
    if (!votes) return;
    // First look: remember what is already there, only warn about new ones.
    if (!seen.current) {
      seen.current = new Set(votes.map((v) => v.id));
      return;
    }
    for (const v of votes) {
      if (seen.current.has(v.id)) continue;
      seen.current.add(v.id);
      if (v.result || Date.now() - new Date(v.at).getTime() > 60_000) continue;
      playSound("votekick", { eventId: v.id });
      useNotifications.getState().notify({
        id: `vote-${v.id}`,
        version: "VRChat · Votekick",
        title: `Votekick gegen ${v.target}`,
        description: v.initiator ? `gestartet von ${v.initiator}` : "Starter wird von VRChat nicht genannt",
      });
    }
  }, [votes]);
}
