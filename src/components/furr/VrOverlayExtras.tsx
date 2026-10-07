// Extra Handgelenk-UI: Duty-Badge (3 Zustände), Votekick-Assistent, Alert-Toasts,
// Clip-Button, Staff-Quick-Actions, Hint-Preview, Audit-Ticker, Watchlist-Joins.
// Idle sparsam: nur Event-/Tap-getrieben + bestehende Polls; Boost nur kurz.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  Clipboard,
  EyeOff,
  FolderPlus,
  ShieldAlert,
  Video,
} from "lucide-react";
import type { VrcInstanceState } from "@/components/furr/VRChat";
import { listDutyLog, setDuty, type DutyEntry, type DutyLogEntry } from "@/lib/furr/api/duty";
import { saveEvidenceCase } from "@/lib/furr/api/evidence";
import { clipsSave, hasDesktopClips } from "@/lib/furr/clips-client";
import { errorMessage } from "@/lib/furr/client";
import { MOTION } from "@/lib/furr/motion";
import { dismissVrAlert, pushVrAlert, subscribeVrAlerts, type VrAlert } from "@/lib/furr/vr-alerts";
import { cn } from "@/lib/utils";
import { useVrSettings, VR_MOD_TEMPLATES, type VrWatchEntry } from "@/store/vr";
import { useLiveInterval } from "@/lib/furr/live-interval";

export type DutyMode = "on" | "off" | "away";

const VOTE_WINDOW_MS = 60_000;
const ALERT_TOAST_MS = 4_000;
const CHATBOX_RATE_MS = 8_000;
const NOTICE_BOOST_SAFE = 450;

export function dutyModeOf(onDuty: boolean, away: boolean): DutyMode {
  if (onDuty) return "on";
  if (away) return "away";
  return "off";
}

export function dutyLabel(mode: DutyMode) {
  if (mode === "on") return "On Duty";
  if (mode === "away") return "Away";
  return "Off Duty";
}

export function nextDutyMode(mode: DutyMode): DutyMode {
  if (mode === "off") return "on";
  if (mode === "on") return "away";
  return "off";
}

/** Anwesend / Away / Off – Tap zyklisch. Away ist lokal (Server kennt nur on/off). */
export function DutyBadge({
  onDuty,
  away,
  busy,
  error,
  onCycle,
  className,
  title,
}: {
  onDuty: boolean;
  away: boolean;
  busy: boolean;
  error: boolean;
  onCycle: () => void;
  className?: string;
  title?: string;
}) {
  const mode = dutyModeOf(onDuty, away);
  return (
    <button
      type="button"
      onClick={onCycle}
      aria-pressed={mode === "on"}
      aria-busy={busy}
      title={title ?? "Tippen: On Duty → Away → Off Duty"}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold transition duration-200 active:scale-95",
        error
          ? "bg-red-500/70 text-white"
          : mode === "on"
            ? "bg-emerald-500 text-black"
            : mode === "away"
              ? "bg-amber-400 text-black"
              : "bg-white/12 text-white hover:bg-white/25",
        busy && "opacity-75",
        className,
      )}
    >
      <span
        key={mode}
        className={cn(
          "furr-vr-pop size-2.5 shrink-0 rounded-full",
          mode === "on" ? "bg-black/60" : mode === "away" ? "bg-black/45" : "bg-white/40",
        )}
      />
      {error ? "Fehler – nochmal" : dutyLabel(mode)}
    </button>
  );
}

export function useDutyCycle(args: {
  userId: string | undefined;
  onDuty: boolean;
  boost: (ms: number) => void;
}) {
  const queryClient = useQueryClient();
  const dutyAway = useVrSettings((s) => s.dutyAway);
  const setDutyAway = useVrSettings((s) => s.setDutyAway);
  const [dutyBusy, setDutyBusy] = useState(false);
  const [dutyError, setDutyError] = useState(false);

  async function cycleDuty() {
    const uid = args.userId;
    if (dutyBusy || !uid) return;
    const current = dutyModeOf(args.onDuty, dutyAway);
    const next = nextDutyMode(current);
    const key = ["furr", "duty"];
    const wantOn = next === "on";
    const wantAway = next === "away";
    setDutyBusy(true);
    setDutyError(false);
    args.boost(600);
    await queryClient.cancelQueries({ queryKey: key });
    const before = queryClient.getQueryData<DutyEntry[]>(key);
    const beforeAway = dutyAway;
    setDutyAway(wantAway);
    queryClient.setQueryData<DutyEntry[]>(key, (list = []) =>
      list.some((d) => d.userId === uid)
        ? list.map((d) => (d.userId === uid ? { ...d, onDuty: wantOn, status: wantAway ? "away" : wantOn ? "on" : "off" } : d))
        : [...list, { userId: uid, onDuty: wantOn, status: wantAway ? "away" : wantOn ? "on" : "off", since: new Date().toISOString() }],
    );
    try {
      const status = wantAway ? "away" : wantOn ? "on" : "off";
      await setDuty({ data: { status } });
    } catch {
      queryClient.setQueryData(key, before);
      setDutyAway(beforeAway);
      setDutyError(true);
      args.boost(600);
      window.setTimeout(() => setDutyError(false), 3_000);
    } finally {
      setDutyBusy(false);
      await queryClient.invalidateQueries({ queryKey: key });
    }
  }

  return { dutyAway, dutyBusy, dutyError, cycleDuty };
}

function clock(at: string | null) {
  return at ? new Date(at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "–";
}

function voteSecondsLeft(at: string, now: number) {
  const elapsed = now - new Date(at).getTime();
  return Math.max(0, Math.ceil((VOTE_WINDOW_MS - elapsed) / 1000));
}

/** Kompakte Votekick-Karte: Ziel, Kontext, Timer, Erledigt / Fall / Clip. */
export function VoteAssistPanel({
  vote,
  players,
  onDuty,
  onDone,
  boost,
}: {
  vote: NonNullable<VrcInstanceState["votes"]>[number];
  players: VrcInstanceState["players"];
  onDuty: boolean;
  onDone: () => void;
  boost: (ms: number) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [caseBusy, setCaseBusy] = useState(false);
  const [caseMsg, setCaseMsg] = useState<string | null>(null);
  const [clipBusy, setClipBusy] = useState(false);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, []);
  const left = voteSecondsLeft(vote.at, now);
  const player = players.find((p) => p.name === vote.target || (p.id && vote.target.includes(p.id)));
  const usr = player?.id ?? null;

  async function makeCase() {
    if (caseBusy || !onDuty) return;
    setCaseBusy(true);
    setCaseMsg(null);
    boost(600);
    try {
      const res = await saveEvidenceCase({
        data: {
          platform: "VRChat",
          targetPrimary: usr || vote.target,
          targetDiscordId: "",
          targetDisplayName: vote.target,
          targetSecondary: vote.initiator ? `Votekick von ${vote.initiator}` : "Votekick",
          messageId: "",
          messageProof: null,
          violationCategory: "Other",
          notes: [
            `Votekick gegen ${vote.target}`,
            vote.initiator ? `Gestartet von: ${vote.initiator}` : "Starter unbekannt",
            usr ? `usr: ${usr}` : "",
            `Zeit: ${vote.at}`,
            "Angelegt aus FurrBox VR (Votekick-Assistent).",
          ]
            .filter(Boolean)
            .join("\n"),
          files: [],
        },
      });
      setCaseMsg(`Fall ${res.caseId}`);
      pushVrAlert({
        id: `case-${res.caseId}`,
        tone: "green",
        title: "Fall angelegt",
        text: res.caseId,
        kind: "generic",
        ttlMs: ALERT_TOAST_MS,
      });
    } catch (e) {
      setCaseMsg(errorMessage(e));
    } finally {
      setCaseBusy(false);
      boost(450);
    }
  }

  async function saveClip() {
    if (clipBusy || !hasDesktopClips()) return;
    setClipBusy(true);
    boost(600);
    try {
      const r = await clipsSave({
        reason: "votekick-assist",
        meta: { source: "vr", voteId: vote.id, target: vote.target, initiator: vote.initiator, usr },
        waitPostRoll: true,
      });
      if (!r.ok) throw new Error(r.error);
      pushVrAlert({
        id: `clip-${r.value.id}`,
        tone: "blue",
        title: "Clip gespeichert",
        text: r.value.name,
        kind: "clip",
        ttlMs: ALERT_TOAST_MS,
      });
    } catch (e) {
      pushVrAlert({
        id: `clip-err-${Date.now()}`,
        tone: "red",
        title: "Clip fehlgeschlagen",
        text: errorMessage(e),
        kind: "clip",
        ttlMs: ALERT_TOAST_MS,
      });
    } finally {
      setClipBusy(false);
    }
  }

  return (
    <div className="furr-vr-notice relative flex flex-col gap-2 overflow-hidden rounded-2xl border-2 border-red-400 bg-red-500/25 px-3 py-2">
      <span aria-hidden className="furr-vr-ring furr-vr-ring-red pointer-events-none absolute inset-0 rounded-[14px]" />
      <div className="relative flex items-center gap-3">
        <AlertTriangle className="furr-vr-pop size-8 shrink-0 text-red-300" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-bold uppercase tracking-wide text-red-200">
            Votekick · {clock(vote.at)} · noch {left}s
          </p>
          <p className="truncate text-[18px] font-bold leading-tight">gegen {vote.target}</p>
          <p className="truncate text-[13px] text-white/80">
            {vote.initiator ? (
              <>
                gestartet von <b>{vote.initiator}</b>
              </>
            ) : (
              "Starter wird von VRChat nicht genannt"
            )}
            {" · "}
            Ja/Nein: <span className="text-white/50">–</span>
            {usr ? (
              <>
                {" · "}
                <span className="font-mono text-[11px] text-white/55">{usr.slice(0, 12)}…</span>
              </>
            ) : player ? (
              <> · in Instanz</>
            ) : (
              <> · nicht in Spielerliste</>
            )}
          </p>
        </div>
      </div>
      <div className="relative flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={onDone}
          className="flex items-center gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-[13px] font-semibold transition duration-150 hover:bg-emerald-500/60 active:scale-95"
          title="Hinweis schließen + Anwesenheits-Protokoll"
        >
          <Check className="size-4" /> Erledigt
        </button>
        <button
          type="button"
          disabled={!onDuty || caseBusy}
          onClick={() => void makeCase()}
          className="flex items-center gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-[13px] font-semibold transition duration-150 hover:bg-accent/50 active:scale-95 disabled:opacity-40"
          title={onDuty ? "Evidence-Fall anlegen" : "Nur On Duty"}
        >
          <FolderPlus className="size-4" /> {caseBusy ? "…" : "Fall anlegen"}
        </button>
        <button
          type="button"
          disabled={clipBusy || !hasDesktopClips()}
          onClick={() => void saveClip()}
          className="flex items-center gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-[13px] font-semibold transition duration-150 hover:bg-accent/50 active:scale-95 disabled:opacity-40"
        >
          <Video className="size-4" /> {clipBusy ? "…" : "Clip"}
        </button>
      </div>
      {caseMsg && <p className="relative truncate text-[12px] text-white/70">{caseMsg}</p>}
      {!onDuty && (
        <p className="relative text-[11px] text-amber-200/90">Staff-Aktionen (Fall) nur On Duty – Erledigt geht immer.</p>
      )}
    </div>
  );
}

/** Toast-Stack am Overlay, Queue max. 2. */
export function VrAlertToasts({ mute }: { mute: boolean }) {
  const [alerts, setAlerts] = useState<VrAlert[]>([]);
  useEffect(() => subscribeVrAlerts(setAlerts), []);
  if (mute || alerts.length === 0) return null;
  return (
    <div className="pointer-events-auto absolute inset-x-2 top-2 z-20 flex flex-col gap-1.5">
      {alerts.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => dismissVrAlert(a.id)}
          className={cn(
            "furr-vr-toast flex items-start gap-2 rounded-xl border-2 px-3 py-2 text-left shadow-lg",
            a.tone === "red" && "border-red-400 bg-red-950/95",
            a.tone === "amber" && "border-amber-400 bg-amber-950/95",
            a.tone === "blue" && "border-accent bg-[#0b1a26]/95",
            a.tone === "green" && "border-emerald-400 bg-emerald-950/95",
          )}
        >
          <ShieldAlert className="furr-vr-pop mt-0.5 size-5 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-bold leading-tight">{a.title}</span>
            <span className="block truncate text-[12px] text-white/75">{a.text}</span>
          </span>
          <XTiny />
        </button>
      ))}
    </div>
  );
}

function XTiny() {
  return <span className="text-[11px] text-white/50">OK</span>;
}

/** Clip speichern am Handgelenk – 1 Tap → IPC clips-save. */
let wristClipBusy = false;
/** Saves a clip (ring buffer of the desktop app) and reports the result as a notice on the arm. */
export async function saveWristClip(boost: (ms: number) => void) {
  if (wristClipBusy) return;
  if (!hasDesktopClips()) {
    pushVrAlert({ id: `clip-none-${Date.now()}`, tone: "amber", title: "Clips nicht verfügbar", text: "Geht nur in der FurrBox-Desktop-App.", kind: "clip", ttlMs: ALERT_TOAST_MS });
    return;
  }
  wristClipBusy = true;
  boost(MOTION.popMs);
  try {
    const r = await clipsSave({ reason: "vr-manual", meta: { source: "vr" }, waitPostRoll: true });
    if (!r.ok) throw new Error(r.error);
    pushVrAlert({ id: `clip-${r.value.id}`, tone: "blue", title: "Clip gespeichert", text: r.value.name, kind: "clip", ttlMs: ALERT_TOAST_MS });
  } catch (e) {
    pushVrAlert({ id: `clip-err-${Date.now()}`, tone: "red", title: "Clip fehlgeschlagen", text: errorMessage(e), kind: "clip", ttlMs: ALERT_TOAST_MS });
  } finally {
    wristClipBusy = false;
  }
}

export function ClipSaveButton({ boost }: { boost: (ms: number) => void }) {
  const [busy, setBusy] = useState(false);
  if (!hasDesktopClips()) return null;
  async function run() {
    if (busy) return;
    setBusy(true);
    boost(MOTION.popMs);
    try {
      const r = await clipsSave({ reason: "vr-manual", meta: { source: "vr" }, waitPostRoll: true });
      if (!r.ok) throw new Error(r.error);
      pushVrAlert({
        id: `clip-${r.value.id}`,
        tone: "blue",
        title: "Clip gespeichert",
        text: r.value.name,
        kind: "clip",
        ttlMs: ALERT_TOAST_MS,
      });
    } catch (e) {
      pushVrAlert({
        id: `clip-err-${Date.now()}`,
        tone: "red",
        title: "Clip fehlgeschlagen",
        text: errorMessage(e),
        kind: "clip",
        ttlMs: ALERT_TOAST_MS,
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      aria-label="Clip speichern"
      disabled={busy}
      onClick={() => void run()}
      className="grid size-11 shrink-0 place-items-center rounded-full bg-white/12 transition duration-150 hover:bg-accent/50 active:scale-90 disabled:opacity-50"
      title="Clip speichern (Ringpuffer)"
    >
      {busy ? <Clipboard className="size-5 animate-pulse" /> : <Video className="size-5" />}
    </button>
  );
}

/** Watchlist-Joins aus Instanz-Events (usr_/Name); Server-Watchlist später ersetzen. */
export function useWatchlistJoinToasts(args: {
  events: VrcInstanceState["events"] | undefined;
  watchlist: VrWatchEntry[];
  mute: boolean;
  boost: (ms: number) => void;
}) {
  const { events, watchlist, mute, boost } = args;
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!events || watchlist.length === 0) return;
    if (!seen.current) {
      seen.current = new Set(events.map((e) => `${e.at}:${e.name}:${e.kind}`));
      return;
    }
    for (const e of events) {
      if (e.kind !== "join") continue;
      const key = `${e.at}:${e.name}:${e.kind}`;
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      const hit = watchlist.find(
        (w) =>
          (w.id && e.name.toLowerCase() === w.id.toLowerCase()) ||
          (w.name && e.name.toLowerCase() === w.name.toLowerCase()) ||
          (w.id.startsWith("usr_") && e.id === w.id),
      );
      const hit2 = hit || watchlist.find((w) => w.name && w.name.toLowerCase() === e.name.toLowerCase());
      if (!hit2) continue;
      if (!mute) {
        boost(NOTICE_BOOST_SAFE);
        pushVrAlert({
          id: `wl-${key}`,
          tone: "amber",
          title: "Watchlist-Join",
          text: `${e.name}${hit2.id.startsWith("usr_") ? ` (${hit2.id.slice(0, 10)}…)` : ""}`,
          kind: "watchlist-join",
          ttlMs: ALERT_TOAST_MS,
        });
      }
    }
  }, [events, watchlist, mute, boost]);
}

export function useVoteResultToasts(args: {
  votes: VrcInstanceState["votes"] | undefined;
  mute: boolean;
  boost: (ms: number) => void;
}) {
  const { votes, mute, boost } = args;
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!votes) return;
    if (!seen.current) {
      seen.current = new Set(votes.map((v) => `${v.id}:${v.result ?? "open"}`));
      return;
    }
    for (const v of votes) {
      if (!v.result) continue;
      const key = `${v.id}:${v.result}`;
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      if (mute) continue;
      boost(NOTICE_BOOST_SAFE);
      pushVrAlert({
        id: `vr-${key}`,
        tone: v.result === "kicked" ? "red" : "amber",
        title: v.result === "kicked" ? `Kick: ${v.target}` : `Vote abgelehnt: ${v.target}`,
        text: v.initiator ? `von ${v.initiator}` : "Votekick-Ergebnis",
        kind: "vote-result",
        ttlMs: ALERT_TOAST_MS,
      });
    }
  }, [votes, mute, boost]);
}

/** Chatbox-Hinweis-Preview: Team-Nachrichten mit [Hinweis]/📌 – Confirm → OSC. */
export function HintPreview({
  newest,
  myId,
  onSendChatbox,
  boost,
}: {
  newest: { id: string; senderId: string; senderName: string; content: string; createdAt: string } | null;
  myId: string | undefined;
  onSendChatbox: (text: string) => Promise<void>;
  boost: (ms: number) => void;
}) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!newest || newest.senderId === myId || dismissed === newest.id) return null;
  const raw = newest.content.trim();
  const isHint = /^(\[Hinweis\]|📌|\/hint\b)/i.test(raw);
  if (!isHint) return null;
  const text = raw.replace(/^(\[Hinweis\]|📌|\/hint)\s*/i, "").slice(0, 144);
  if (!text) return null;
  const age = Date.now() - new Date(newest.createdAt).getTime();
  if (age > 45_000) return null;

  return (
    <div className="furr-vr-notice flex items-center gap-2 rounded-xl border border-accent/50 bg-accent/15 px-2.5 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">Hinweis · {newest.senderName}</p>
        <p className="truncate text-[13px]">{text}</p>
      </div>
      <button
        type="button"
        className="rounded-lg bg-accent px-2.5 py-1.5 text-[12px] font-bold text-black active:scale-95"
        onClick={() => {
          boost(600);
          void onSendChatbox(text);
          setDismissed(newest.id);
        }}
      >
        Chatbox
      </button>
      <button
        type="button"
        className="rounded-lg bg-white/10 px-2 py-1.5 text-[12px] active:scale-95"
        onClick={() => setDismissed(newest.id)}
      >
        Weg
      </button>
    </div>
  );
}

export function StaffQuickPanel({
  onDuty,
  boost,
  sendChatbox,
}: {
  onDuty: boolean;
  boost: (ms: number) => void;
  sendChatbox: (text: string) => Promise<void>;
}) {
  const muteAlerts = useVrSettings((s) => s.muteAlerts);
  const setMuteAlerts = useVrSettings((s) => s.setMuteAlerts);
  const [clipBusy, setClipBusy] = useState(false);
  const [tplBusy, setTplBusy] = useState(false);
  const lastTpl = useRef(0);

  if (!onDuty) {
    return (
      <div className="grid flex-1 place-items-center rounded-2xl bg-white/6 px-6 text-center text-[15px] text-white/60">
        Staff-Menü nur On Duty. Duty-Badge am Handgelenk tippen.
      </div>
    );
  }

  async function clip(reason: string) {
    if (clipBusy || !hasDesktopClips()) return;
    setClipBusy(true);
    boost(MOTION.popMs);
    try {
      const r = await clipsSave({ reason, meta: { source: "vr-staff" }, waitPostRoll: true });
      if (!r.ok) throw new Error(r.error);
      pushVrAlert({
        id: `clip-${r.value.id}`,
        tone: "blue",
        title: reason === "incident" ? "Incident markiert" : "Clip angefordert",
        text: r.value.name,
        kind: "clip",
        ttlMs: ALERT_TOAST_MS,
      });
    } catch (e) {
      pushVrAlert({
        id: `clip-err-${Date.now()}`,
        tone: "red",
        title: "Clip fehlgeschlagen",
        text: errorMessage(e),
        kind: "clip",
        ttlMs: ALERT_TOAST_MS,
      });
    } finally {
      setClipBusy(false);
    }
  }

  async function sendTpl(text: string) {
    if (tplBusy) return;
    const gap = Date.now() - lastTpl.current;
    if (gap < CHATBOX_RATE_MS) {
      pushVrAlert({
        id: `rate-${Date.now()}`,
        tone: "amber",
        title: "Rate-Limit",
        text: `Noch ${Math.ceil((CHATBOX_RATE_MS - gap) / 1000)}s warten`,
        kind: "generic",
        ttlMs: 3_000,
      });
      return;
    }
    setTplBusy(true);
    boost(600);
    try {
      await sendChatbox(text);
      lastTpl.current = Date.now();
    } catch (e) {
      pushVrAlert({
        id: `tpl-err-${Date.now()}`,
        tone: "red",
        title: "Chatbox",
        text: errorMessage(e),
        kind: "generic",
        ttlMs: ALERT_TOAST_MS,
      });
    } finally {
      setTplBusy(false);
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2 rounded-2xl bg-white/6 p-2.5">
      <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-white/50">
        <ShieldAlert className="size-3.5" /> Staff · Quick
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={() => {
            setMuteAlerts(!muteAlerts);
            boost(450);
          }}
          className={cn(
            "flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold active:scale-95",
            muteAlerts ? "bg-amber-500/30" : "bg-white/10 hover:bg-white/15",
          )}
        >
          <EyeOff className="size-4 shrink-0" />
          {muteAlerts ? "Hinweise stumm" : "Hinweise stumm?"}
        </button>
        <button
          type="button"
          disabled={clipBusy || !hasDesktopClips()}
          onClick={() => void clip("vr-request")}
          className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2.5 text-left text-[13px] font-semibold hover:bg-accent/40 active:scale-95 disabled:opacity-40"
        >
          <Video className="size-4 shrink-0" /> Clip anfordern
        </button>
        <button
          type="button"
          disabled={clipBusy || !hasDesktopClips()}
          onClick={() => void clip("incident")}
          className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2.5 text-left text-[13px] font-semibold hover:bg-red-500/40 active:scale-95 disabled:opacity-40"
        >
          <AlertTriangle className="size-4 shrink-0" /> Incident markieren
        </button>
        <p className="col-span-2 text-[11px] text-white/45">
          Votekick starten nur in VRChat (kein API). Fall anlegen am Vote-Panel.
        </p>
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-white/45">Vorlagen (Rate-Limit 8s / Status-Pause 10s)</p>
      <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-1.5 overflow-auto">
        {VR_MOD_TEMPLATES.map((t) => (
          <button
            key={t}
            type="button"
            disabled={tplBusy}
            onClick={() => void sendTpl(t)}
            className="rounded-xl bg-white/10 px-2.5 py-2 text-left text-[13px] font-medium leading-tight hover:bg-accent/40 active:scale-95 disabled:opacity-50"
          >
            {t}
          </button>
        ))}
      </div>
      <AuditTicker onDuty={onDuty} />
    </section>
  );
}

function AuditTicker({ onDuty }: { onDuty: boolean }) {
  const live = useLiveInterval(30_000);
  const log = useQuery({
    queryKey: ["furr", "duty-log", "vr-mini"],
    queryFn: () => listDutyLog(),
    enabled: onDuty,
    refetchInterval: live,
    retry: false,
  });
  if (!onDuty) return null;
  const rows: DutyLogEntry[] = (log.data ?? []).slice(0, 3);
  if (rows.length === 0) return <p className="text-[11px] text-white/40">Audit: noch leer</p>;
  return (
    <div className="border-t border-white/10 pt-1.5">
      <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-white/40">Audit (letzte 3)</p>
      {rows.map((r) => (
        <p key={r.id} className="truncate text-[12px] text-white/70">
          <span className="text-white/40">{clock(r.at)}</span> {r.name}: {r.kind}
          {r.detail ? ` – ${r.detail}` : ""}
        </p>
      ))}
    </div>
  );
}

export { CHATBOX_RATE_MS, ALERT_TOAST_MS, VOTE_WINDOW_MS };
