// Anwesenheit über VRChat (desktop app): keeps the own VRChat account (name + usr_ id) at the
// FurrBox profile and tells the server once a minute in which instance you are – in an instance of
// our group you count as "anwesend" without touching a switch.
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { desktopVrchat, unwrap, useMyVrchat } from "@/components/furr/VRChat";
import { linkMyVrchat, reportVrchatLocation } from "@/lib/furr/api/duty";
import { useMe } from "@/lib/furr/client";
import { DUTY_KEY } from "./useDuty";

const REPORT_MS = 60_000;

export function useVrchatDuty() {
  const me = useMe();
  const mine = useMyVrchat();
  const queryClient = useQueryClient();
  const allowed = Boolean(me.data?.permissions.canUseEvidence);
  const usrId = mine.data?.loggedIn ? mine.data.userId : null;
  const name = mine.data?.loggedIn ? mine.data.displayName : null;

  useEffect(() => {
    if (!allowed || !usrId) return;
    void linkMyVrchat({ data: { userId: usrId, displayName: name ?? "" } }).catch(() => undefined);
  }, [allowed, usrId, name]);

  useEffect(() => {
    const bridge = desktopVrchat();
    if (!allowed || !bridge?.instance) return;
    let last = false;
    const tick = async () => {
      try {
        const s = await unwrap(bridge.instance?.());
        if (!s.inInstance || !s.location) return;
        const res = await reportVrchatLocation({ data: s.location });
        // Show the change right away instead of waiting for the next regular refresh.
        if (res.inGroup !== last) void queryClient.invalidateQueries({ queryKey: DUTY_KEY });
        last = res.inGroup;
      } catch {
        // VRChat is closed or the server is busy – try again next time.
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), REPORT_MS);
    return () => window.clearInterval(timer);
  }, [allowed, queryClient]);
}
