// Watchlist-Wache auf dem Desktop: sobald jemand von der Watchlist in deiner VRChat-Instanz ist
// (neu beigetreten oder schon da, wenn du kommst), gibt es Ton + Meldung – und die Sichtung geht an
// den Server, der das Team alarmiert. Die Desktop-App liest dafür das VRChat-Log.
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { desktopVrchat, unwrap } from "@/components/furr/VRChat";
import { listWatchlist, reportWatchlistSighting } from "@/lib/furr/api/watchlist";
import { useMe } from "@/lib/furr/client";
import { usePersonFile } from "@/lib/furr/person-file";
import { playSound } from "@/lib/furr/sounds";
import { useDesktop } from "@/store/desktop";
import { useNotifications } from "@/store/notifications";

/** Reports this browser sent itself – the team alert for them is not shown a second time here. */
export const ownSightings = new Set<string>();

export function useWatchlistWatch() {
  const me = useMe();
  const bridge = desktopVrchat();
  const allowed = Boolean(me.data?.permissions.canUseEvidence) && Boolean(bridge?.instance);
  const list = useQuery({ queryKey: ["furr", "watchlist"], queryFn: () => listWatchlist(), enabled: allowed, refetchInterval: 60_000, staleTime: 30_000 });
  // Same data as the vote kick watch (it does the polling).
  const inst = useQuery({ queryKey: ["furr", "votewatch"], queryFn: () => unwrap(desktopVrchat()!.instance!()), enabled: false });
  const seen = useRef(new Set<string>());
  const state = inst.data;
  const entries = list.data;

  useEffect(() => {
    if (!allowed || !state?.inInstance || !state.location || !entries?.length) return;
    for (const p of state.players) {
      const name = p.name.toLowerCase();
      const hit = entries.find((e) => (p.id && e.usrId === p.id) || (e.displayName && e.displayName.toLowerCase() === name));
      if (!hit) continue;
      // One alarm per visit: a rejoin has a new join time.
      const key = `${state.location}|${hit.usrId}|${p.joinedAt ?? ""}`;
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      // The server tells the team (and the bot); with "Alarm beim Beitritt" off it only keeps the sighting.
      void reportWatchlistSighting({
        data: { usrId: hit.usrId, displayName: p.name, kind: "join", world: state.worldName ?? undefined, instanceId: state.location, at: p.joinedAt ?? undefined },
      })
        .then((r) => ownSightings.add(r.id))
        .catch(() => undefined);
      if (!hit.alarmJoin) continue;
      playSound("votekick", { eventId: `wl-${key}` });
      useNotifications.getState().notify({
        id: `wl-${key}`,
        version: "VRChat · Watchlist",
        tone: "alert",
        title: `Watchlist: ${p.name} ist in deiner Instanz`,
        description: [state.worldName, hit.note].filter(Boolean).join("\n") || "Steht auf der Watchlist.",
        actionLabel: "Akte öffnen",
        durationMs: 20_000,
        onClick: () => {
          usePersonFile.getState().open({ name: hit.displayName || p.name, discordId: null, usrId: hit.usrId });
          useDesktop.getState().openApp("evidence");
        },
      });
    }
  }, [allowed, state, entries]);
}
