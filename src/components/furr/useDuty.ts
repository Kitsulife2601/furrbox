// Anwesenheit (Duty) für den Desktop: gleiche Daten/Query-Key wie das VR-Panel (["furr","duty"]),
// optimistisches Umschalten mit Rücksprung bei Fehler. Nur Staff mit canUseEvidence.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listDuty, setDuty, type DutyEntry, type DutyStatus } from "@/lib/furr/api/duty";
import { errorMessage, useMe } from "@/lib/furr/client";
import { useLiveInterval } from "@/lib/furr/live-interval";
import { useNotifications } from "@/store/notifications";

export const DUTY_KEY = ["furr", "duty"] as const;

export const DUTY_LABEL: Record<DutyStatus, string> = {
  on: "Anwesend",
  away: "Kurz weg",
  off: "Nicht anwesend",
};

/** Server liefert `status` (on/away/off, nur mit frischem Heartbeat); ältere Server nur `onDuty`. */
export function dutyStatusOf(entry: DutyEntry | null | undefined): DutyStatus {
  if (!entry) return "off";
  return entry.status ?? (entry.onDuty ? "on" : "off");
}

export const DUTY_DOT: Record<DutyStatus, string> = {
  on: "bg-emerald-400",
  away: "bg-amber-400",
  off: "bg-fg/35",
};

/** `pollMs`: Desktop-Standard 60 s (Idle-sparsam); offenes Flyout darf schneller. */
export function useDuty(pollMs = 60_000) {
  const me = useMe();
  const allowed = Boolean(me.data?.permissions.canUseEvidence);
  const live = useLiveInterval(pollMs, allowed);
  const queryClient = useQueryClient();
  const duty = useQuery({
    queryKey: DUTY_KEY,
    queryFn: () => listDuty(),
    enabled: allowed,
    refetchInterval: live,
    staleTime: 15_000,
    retry: false,
  });
  const uid = me.data?.userId ?? null;
  const mine = duty.data?.find((d) => d.userId === uid) ?? null;
  const status = dutyStatusOf(mine);
  const teamOn = (duty.data ?? []).filter((d) => d.onDuty).length;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /** Schalter: aus → an, an/away → aus. */
  const toggle = () => setStatus(status === "off" ? "on" : "off");

  async function setStatus(next: DutyStatus) {
    if (busy || !uid || next === status) return;
    setBusy(true);
    setError("");
    await queryClient.cancelQueries({ queryKey: DUTY_KEY });
    const before = queryClient.getQueryData<DutyEntry[]>(DUTY_KEY);
    const patch = { onDuty: next === "on", status: next };
    queryClient.setQueryData<DutyEntry[]>(DUTY_KEY, (list = []) =>
      list.some((d) => d.userId === uid)
        ? list.map((d) => (d.userId === uid ? { ...d, ...patch } : d))
        : [...list, { userId: uid, since: new Date().toISOString(), ...patch }],
    );
    try {
      await setDuty({ data: { status: next } });
      useNotifications.getState().notify({
        id: "duty-toggle",
        version: "FurrBox · Anwesenheit",
        kind: "duty",
        tone: "success",
        title: next === "on" ? "Du bist anwesend" : next === "away" ? "Kurz weg" : "Nicht mehr anwesend",
        description:
          next === "on"
            ? "Das Team sieht dich als „kann moderieren“."
            : next === "away"
              ? "Das Team sieht dich als kurz abwesend."
              : "Du erscheinst nicht mehr in der Anwesenheitsliste.",
      });
    } catch (e) {
      queryClient.setQueryData(DUTY_KEY, before);
      setError(errorMessage(e));
      window.setTimeout(() => setError(""), 4_000);
    } finally {
      setBusy(false);
      await queryClient.invalidateQueries({ queryKey: DUTY_KEY });
    }
  }

  return { allowed, status, mine, teamOn, busy, error, toggle, setStatus, loading: duty.isLoading };
}
