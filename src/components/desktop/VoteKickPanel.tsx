// Votekick-Panel auf dem Desktop – parallel zur Warnung am Arm (VR-Panel): Ziel, Starter, Timer,
// Spielerliste zum Vote-Zeitpunkt und Aktionen „Erledigt“ (Anwesenheits-Protokoll), „Fall anlegen“, „Clip“.
import { useEffect, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronUp, FilePlus2, Minus, Users, Video, X } from "lucide-react";
import { useNow } from "@/lib/furr/live-interval";
import { clipsSave, hasDesktopClips } from "@/lib/furr/clips-client";
import { playersNote, useCaseDraft } from "@/lib/furr/case-draft";
import { errorMessage, useMe } from "@/lib/furr/client";
import { cn } from "@/lib/utils";
import { useDesktop } from "@/store/desktop";
import { useNotifications } from "@/store/notifications";
import { VOTE_ALERT_MS, voteDone, useVoteStore, type ActiveVote } from "@/components/furr/useVoteWatch";

function clock(at: string | number) {
  return new Date(at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function mmss(ms: number) {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

/** Mountet nur, wenn ein Vote aktiv ist – sonst kein Timer, kein Render. */
export function VoteKickPanel() {
  const active = useVoteStore((s) => s.active);
  if (!active.length) return null;
  return <VoteKickPanelInner active={active} />;
}

function VoteKickPanelInner({ active }: { active: ActiveVote[] }) {
  const me = useMe();
  const now = useNow(1_000).getTime();
  const collapsed = useVoteStore((s) => s.collapsed);
  const setCollapsed = useVoteStore((s) => s.setCollapsed);
  const dismiss = useVoteStore((s) => s.dismiss);
  const openApp = useDesktop((s) => s.openApp);
  const [showPlayers, setShowPlayers] = useState(false);
  const [busy, setBusy] = useState<null | "done" | "clip">(null);
  const [inline, setInline] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const staff = Boolean(me.data?.permissions.canUseEvidence);

  const current = active[0];
  const remaining = VOTE_ALERT_MS - (now - new Date(current.vote.at).getTime());

  // Nach 45 s (wie am Arm) verschwindet der Hinweis von selbst – ohne Protokoll-Eintrag.
  useEffect(() => {
    if (remaining <= 0) dismiss(current.vote.id);
  }, [remaining, current.vote.id, dismiss]);

  useEffect(() => {
    if (!inline) return;
    const t = window.setTimeout(() => setInline(null), 3_000);
    return () => window.clearTimeout(t);
  }, [inline]);

  const v = current.vote;
  const pct = Math.max(0, Math.min(100, (remaining / VOTE_ALERT_MS) * 100));

  if (collapsed) {
    return (
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => setCollapsed(false)}
        className="mica furr-vr-notice absolute right-3 top-3 z-[85] flex items-center gap-2 rounded-full border border-red-400/70 px-3 py-1.5 text-[12px] font-semibold text-red-200"
        title="Votekick-Panel öffnen"
      >
        <span className="furr-vr-alert size-2 rounded-full bg-red-400" />
        Votekick gegen {v.target} · {mmss(remaining)}
      </button>
    );
  }

  async function done() {
    if (!staff) return dismiss(v.id);
    setBusy("done");
    try {
      await voteDone(current);
      useNotifications.getState().notify({
        version: "VRChat · Votekick",
        kind: "vote",
        tone: "success",
        title: "Votekick erledigt",
        description: `gegen ${v.target} – im Anwesenheits-Protokoll vermerkt.`,
      });
    } catch (e) {
      setInline({ tone: "bad", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  function createCase() {
    useCaseDraft.getState().set({
      platform: "VRChat",
      targetPrimary: v.target,
      targetSecondary: [current.world, current.location].filter(Boolean).join(" · "),
      category: "Other",
      notes: [
        `Votekick gegen ${v.target}${v.initiator ? `, gestartet von ${v.initiator}` : ""} um ${clock(v.at)} Uhr.`,
        current.world ? `Welt: ${current.world}` : "",
        v.result ? `Ergebnis: ${v.result === "kicked" ? "gekickt" : "gescheitert"}` : "",
        playersNote(current.players, "Spieler zum Vote-Zeitpunkt"),
      ]
        .filter(Boolean)
        .join("\n"),
    });
    openApp("evidence");
  }

  async function clip() {
    setBusy("clip");
    try {
      const res = await clipsSave({ reason: "votekick", meta: { target: v.target, initiator: v.initiator, voteId: v.id, at: v.at } });
      if (!res.ok) throw new Error(res.error);
      setInline({ tone: "ok", text: `Clip gespeichert: ${res.value.name}` });
    } catch (e) {
      setInline({ tone: "bad", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      onMouseDown={(e) => e.stopPropagation()}
      role="alertdialog"
      aria-label={`Votekick gegen ${v.target}`}
      className="mica furr-vr-notice absolute right-3 top-3 z-[85] w-[min(360px,calc(100%-1.5rem))] overflow-hidden rounded-xl border border-red-400/70 shadow-2xl"
    >
      <span aria-hidden key={v.id} className="furr-vr-ring furr-vr-ring-red pointer-events-none absolute inset-0 rounded-xl" />
      <div className="h-1 bg-red-500/20">
        <div className="h-full bg-red-400 transition-[width] duration-1000 ease-linear" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-start gap-3 px-3 pb-2 pt-2.5">
        <AlertTriangle key={`i-${v.id}`} className="furr-vr-pop mt-0.5 size-7 shrink-0 text-red-300" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wide text-red-200">
            Votekick gestartet · {clock(v.at)} · noch {mmss(remaining)}
          </p>
          <p className="truncate text-[17px] font-bold leading-tight">gegen {v.target}</p>
          <p className="truncate text-[12px] text-muted">
            {v.initiator ? (
              <>
                gestartet von <b className="text-fg">{v.initiator}</b>
              </>
            ) : (
              "Starter wird von VRChat nicht genannt"
            )}
          </p>
          {current.world && <p className="truncate text-[11px] text-subtle">{current.world}</p>}
          {v.result && (
            <span
              className={cn(
                "furr-vr-pop mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
                v.result === "kicked" ? "bg-red-500/25 text-red-200" : "bg-emerald-500/20 text-emerald-200",
              )}
            >
              {v.result === "kicked" ? "Gekickt" : "Vote gescheitert"}
            </span>
          )}
        </div>
        <div className="flex shrink-0 gap-0.5">
          <button type="button" aria-label="Minimieren" title="Minimieren" onClick={() => setCollapsed(true)} className="grid size-7 place-items-center rounded-md text-muted hover:bg-fg/10 hover:text-fg">
            <Minus className="size-3.5" />
          </button>
          <button type="button" aria-label="Schließen" title="Schließen (ohne Protokoll)" onClick={() => dismiss(v.id)} className="grid size-7 place-items-center rounded-md text-muted hover:bg-danger/80 hover:text-white">
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setShowPlayers((s) => !s)}
        className="flex w-full items-center gap-2 border-t border-border px-3 py-1.5 text-left text-[12px] text-muted hover:bg-fg/5"
      >
        <Users className="size-3.5" /> Spieler zum Vote-Zeitpunkt ({current.players.length})
        {showPlayers ? <ChevronUp className="ml-auto size-3.5" /> : <ChevronDown className="ml-auto size-3.5" />}
      </button>
      {showPlayers && (
        <ul className="furr-flyout-in max-h-40 overflow-auto px-3 pb-2 text-[12px]">
          {!current.players.length && <li className="py-1 text-subtle">Keine Spielerdaten aus dem Log.</li>}
          {current.players.map((p) => (
            <li key={p.id ?? p.name} className="flex items-center gap-2 py-0.5">
              <span className={cn("size-1.5 rounded-full", p.name === v.target ? "bg-red-400" : p.name === v.initiator ? "bg-amber-400" : "bg-fg/30")} />
              <span className={cn("truncate", (p.name === v.target || p.name === v.initiator) && "font-semibold")}>{p.name}</span>
              {p.name === v.target && <span className="ml-auto text-[10px] text-red-300">Ziel</span>}
              {p.name === v.initiator && <span className="ml-auto text-[10px] text-amber-300">Starter</span>}
            </li>
          ))}
        </ul>
      )}

      {inline && (
        <p key={inline.text} className={cn("furr-vr-pop mx-3 mb-2 rounded-md px-2 py-1 text-[12px]", inline.tone === "ok" ? "bg-emerald-500/15 text-emerald-200" : "bg-danger/20 text-red-200")}>
          {inline.text}
        </p>
      )}

      <div className="flex gap-1.5 border-t border-border p-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void done()}
          title={staff ? "Schließt den Hinweis und schreibt es ins Anwesenheits-Protokoll" : "Hinweis schließen"}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-emerald-500/85 px-2 py-1.5 text-[12px] font-semibold text-black transition duration-150 hover:bg-emerald-400 active:scale-95 disabled:opacity-60"
        >
          <Check className="size-4" /> {busy === "done" ? "Speichert…" : "Erledigt"}
        </button>
        {staff && (
          <button
            type="button"
            onClick={createCase}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-elevated px-2 py-1.5 text-[12px] font-medium transition duration-150 hover:bg-fg/12 active:scale-95"
          >
            <FilePlus2 className="size-4" /> Fall anlegen
          </button>
        )}
        {staff && hasDesktopClips() && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void clip()}
            title="Clip aus dem Puffer speichern"
            className="flex items-center justify-center gap-1.5 rounded-md bg-elevated px-2.5 py-1.5 text-[12px] font-medium transition duration-150 hover:bg-fg/12 active:scale-95 disabled:opacity-60"
          >
            <Video className="size-4" /> {busy === "clip" ? "…" : "Clip"}
          </button>
        )}
      </div>
      {active.length > 1 && <p className="border-t border-border px-3 py-1 text-[11px] text-subtle">+{active.length - 1} weitere Votekicks</p>}
    </section>
  );
}
