// Bann-Sicherheit (Evidence/Discord + VRChat-Gruppe): Pflicht-Fall-Bezug und 10-s-Rückgängig-Banner.
import { useQuery } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";
import { listEvidenceCases } from "@/lib/furr/api/evidence";
import { useNow } from "@/lib/furr/live-interval";
import { UNDO_MS, useUndo } from "@/lib/furr/undo";
import { cn } from "@/lib/utils";
import { Btn } from "./ui";

/** Fall-Bezug für den Bann: Pflichtauswahl (Fall oder ausdrücklich „ohne Fall“). */
export function CaseRefSelect({
  value,
  onChange,
  platform,
  allowNone = false,
}: {
  value: string;
  onChange: (v: string) => void;
  platform?: "Discord" | "VRChat";
  /** Discord-Bann verlangt serverseitig eine Fall-ID → dort kein „ohne Fall“. */
  allowNone?: boolean;
}) {
  const cases = useQuery({ queryKey: ["furr", "evidence-cases"], queryFn: () => listEvidenceCases(), staleTime: 30_000 });
  const list = (cases.data ?? []).filter((c) => !platform || c.platform === platform).slice(0, 50);
  return (
    <label className="grid gap-1 text-[12px] text-muted">
      <span className="font-medium">Fall-Bezug (Pflicht beim Bann)</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "h-9 rounded-md border bg-bg/60 px-2 text-[12px] text-fg outline-none focus:border-accent",
          value ? "border-border" : "border-amber-400/70",
        )}
      >
        <option value="">– Fall wählen –</option>
        {allowNone && <option value={NO_CASE}>Ohne Fall (Begründung reicht)</option>}
        {list.map((c) => (
          <option key={c.path} value={c.caseId}>
            {c.caseId}
          </option>
        ))}
      </select>
      {!cases.data && <span className="text-[11px] text-subtle">Lade Fallakten…</span>}
      {cases.data && !list.length && <span className="text-[11px] text-amber-300">Noch kein {platform ?? ""}-Fall – lege ihn zuerst unter „Neuer Fall“ an.</span>}
    </label>
  );
}

export const NO_CASE = "__none__";
/** Mindestlänge der Bann-Begründung (Server erlaubt ab 3 – beim Bann wollen wir mehr Kontext). */
export const BAN_REASON_MIN = 10;

/** Laufender 10-s-Countdown mit „Rückgängig“ (inline unter dem Bann-Knopf). */
export function UndoBanner({ pendingId, onUndo }: { pendingId: string; onUndo: () => void }) {
  const pending = useUndo((s) => s.pending.find((p) => p.id === pendingId) ?? null);
  const now = useNow(250).getTime();
  if (!pending) return null;
  const left = Math.max(0, pending.runAt - now);
  return (
    <div className="furr-vr-notice relative flex items-center gap-2 overflow-hidden rounded-md border border-red-400/60 bg-red-500/15 px-3 py-2 text-[12px]">
      <span className="min-w-0 flex-1 truncate">
        <b>{pending.label}</b> in {Math.ceil(left / 1000)} s
      </span>
      <Btn variant="default" onClick={onUndo}>
        <Undo2 className="size-3.5" /> Rückgängig
      </Btn>
      <span className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-red-400" style={{ transform: `scaleX(${left / UNDO_MS})`, transition: "transform 250ms linear" }} />
    </div>
  );
}

