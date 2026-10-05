// Scout Phase 2: Wrist-Taskbar, Soft-Notify (Changelog/Event), Layout-Presets, Overlay-Tastatur (MVP).
// Idle sparsam: nur Tap/Event + seltene Polls; Boost nur kurz. Motion wie motion.ts / Votekick.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Calendar,
  Keyboard,
  LayoutTemplate,
  Lock,
  LockOpen,
  Music,
  Pin,
  Radar,
  Send,
  Shield,
  Sparkles,
  Users,
  MessageSquare,
  Delete,
  MicOff,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { listGroupCalendar } from "@/lib/furr/api/calendar";
import { MOTION } from "@/lib/furr/motion";
import UPDATES from "@/lib/furr/updates.json";
import { useLiveInterval } from "@/lib/furr/live-interval";
import { cn } from "@/lib/utils";
import {
  dismissVrSoftNotify,
  pushVrSoftNotify,
  subscribeVrSoftNotify,
  type VrSoftNotify,
} from "@/lib/furr/vr-soft-notify";
import {
  useVrSettings,
  type VrInfoId,
  type VrInfoPlace,
  type VrPresetId,
  type VrPresetSnapshot,
  type VrShortcutId,
  type VrWidgetId,
  VR_SHORTCUTS,
} from "@/store/vr";

type Boost = (ms: number) => void;
type PageJump = (page: "instance" | "team" | "music" | "chatbox" | "teamchat" | "staff") => void;

const ICON_MAP: Record<VrShortcutId, LucideIcon> = {
  instance: Radar,
  team: Users,
  music: Music,
  chatbox: Send,
  teamchat: MessageSquare,
  staff: Shield,
  keyboard: Keyboard,
  presets: LayoutTemplate,
  clip: Pin,
};

/** Wrist-Taskbar: anpinnbare Shortcuts, Icons wie Desktop (Lucide). Persistenz in furrbox-vr. */
export function WristTaskbar({
  boost,
  onJump,
  onOpenKeyboard,
  onOpenPresets,
  onClip,
  collapsed,
}: {
  boost: Boost;
  onJump: PageJump;
  onOpenKeyboard: () => void;
  onOpenPresets: () => void;
  onClip?: () => void;
  collapsed: boolean;
}) {
  const pins = useVrSettings((s) => s.wristPins);
  const togglePin = useVrSettings((s) => s.toggleWristPin);
  const [edit, setEdit] = useState(false);

  if (collapsed && !edit) {
    // Zugeklappt: max. 4 Pins als Mini-Leiste (kein Idle-Spam).
    const shown = pins.slice(0, 4);
    if (shown.length === 0) return null;
    return (
      <div className="flex items-center gap-1 overflow-hidden">
        {shown.map((id) => {
          const meta = VR_SHORTCUTS.find((x) => x.id === id);
          const Icon = ICON_MAP[id] ?? Pin;
          return (
            <button
              key={id}
              type="button"
              title={meta?.label ?? id}
              aria-label={meta?.label ?? id}
              onClick={() => {
                boost(MOTION.popMs);
                if (id === "keyboard") onOpenKeyboard();
                else if (id === "presets") onOpenPresets();
                else if (id === "clip") onClip?.();
                else onJump(id);
              }}
              className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/10 transition duration-150 hover:bg-accent/40 active:scale-90"
            >
              <Icon className="size-4" strokeWidth={1.7} />
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="furr-vr-notice flex flex-col gap-1.5 rounded-2xl bg-white/6 p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-white/45">Quick Access</p>
        <button
          type="button"
          onClick={() => {
            setEdit(!edit);
            boost(300);
          }}
          className={cn(
            "rounded-lg px-2 py-1 text-[11px] font-semibold active:scale-95",
            edit ? "bg-accent text-black" : "bg-white/10 text-white/70",
          )}
        >
          {edit ? "Fertig" : "Pins"}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(edit ? VR_SHORTCUTS.map((s) => s.id) : pins).map((id) => {
          const meta = VR_SHORTCUTS.find((x) => x.id === id)!;
          const Icon = ICON_MAP[id] ?? Pin;
          const pinned = pins.includes(id);
          return (
            <button
              key={id}
              type="button"
              title={meta.label}
              onClick={() => {
                boost(MOTION.enterMs);
                if (edit) {
                  togglePin(id);
                  return;
                }
                if (id === "keyboard") onOpenKeyboard();
                else if (id === "presets") onOpenPresets();
                else if (id === "clip") onClip?.();
                else onJump(id);
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-[12px] font-semibold transition duration-150 active:scale-95",
                edit
                  ? pinned
                    ? "bg-accent/35 ring-1 ring-accent"
                    : "bg-white/8 text-white/55"
                  : "bg-white/10 hover:bg-accent/40",
              )}
            >
              <Icon className="size-4 shrink-0" strokeWidth={1.7} />
              <span className="truncate">{meta.label}</span>
              {edit && pinned && <Pin className="size-3 text-accent" />}
            </button>
          );
        })}
      </div>
      {edit && (
        <p className="text-[11px] text-white/40">Tippen pinnt/löst. Max. 8. Icons wie Desktop-Taskbar (Lucide).</p>
      )}
    </div>
  );
}

/** Soft-Toasts: Changelog + Gruppen-Event – eigener Kanal, Staff-Queue unberührt. */
export function VrSoftToasts({ mute }: { mute: boolean }) {
  const [items, setItems] = useState<VrSoftNotify[]>([]);
  useEffect(() => subscribeVrSoftNotify(setItems), []);
  if (mute || items.length === 0) return null;
  return (
    <div className="pointer-events-auto absolute inset-x-2 bottom-2 z-20 flex flex-col-reverse gap-1.5">
      {items.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => dismissVrSoftNotify(a.id)}
          className={cn(
            "furr-vr-toast flex items-start gap-2 rounded-xl border px-3 py-2 text-left shadow-lg",
            a.tone === "blue" && "border-accent/70 bg-[#0b1a26]/95",
            a.tone === "green" && "border-emerald-400/70 bg-emerald-950/95",
            a.tone === "amber" && "border-amber-400/70 bg-amber-950/95",
          )}
        >
          {a.kind === "changelog" ? (
            <Sparkles className="furr-vr-pop mt-0.5 size-5 shrink-0 text-accent" />
          ) : (
            <Calendar className="furr-vr-pop mt-0.5 size-5 shrink-0 text-emerald-300" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-bold leading-tight">{a.title}</span>
            <span className="block truncate text-[11px] text-white/70">{a.text}</span>
          </span>
          <span className="text-[10px] text-white/45">OK</span>
        </button>
      ))}
    </div>
  );
}

const VR_CHANGELOG_SEEN = "furrbox-vr-changelog-seen";

/** Einmal pro Version Changelog soft-toasten; Kalender „startet bald“ selten pollen. */
export function useVrSoftEventHooks(args: {
  enabled: boolean;
  mute: boolean;
  boost: Boost;
  collapsed: boolean;
}) {
  const { enabled, mute, boost, collapsed } = args;
  // Changelog: lokal aus updates.json – kein Server-Poll.
  useEffect(() => {
    if (!enabled || mute) return;
    const list = UPDATES as { version?: string; title?: string; items?: string[] }[];
    const entry = list.find((u) => u.version) ?? list[0];
    if (!entry?.version) return;
    let seen = "";
    try {
      seen = localStorage.getItem(VR_CHANGELOG_SEEN) ?? "";
    } catch {
      /* ignore */
    }
    if (seen === entry.version) return;
    const first = entry.items?.[0] ?? entry.title ?? "Neue Version";
    boost(MOTION.popMs);
    pushVrSoftNotify({
      id: `changelog-${entry.version}`,
      kind: "changelog",
      tone: "blue",
      title: `Neu · v${entry.version}`,
      text: first.slice(0, 120),
      ttlMs: MOTION.toastMs,
    });
    try {
      localStorage.setItem(VR_CHANGELOG_SEEN, entry.version);
    } catch {
      /* ignore */
    }
  }, [enabled, mute, boost]);

  // Kalender: im Idle selten (45 s), offen etwas öfter – wake-on-event via Soft-Toast.
  const pollMs = collapsed ? 45_000 : 20_000;
  const live = useLiveInterval(pollMs);
  const cal = useQuery({
    queryKey: ["furr", "vr", "calendar-soon"],
    queryFn: () => listGroupCalendar(),
    enabled: enabled && !mute,
    refetchInterval: live,
    retry: false,
  });
  const seenSoon = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!cal.data?.events || mute) return;
    const now = Date.now();
    for (const ev of cal.data.events) {
      const start = new Date(ev.startsAt).getTime();
      const mins = (start - now) / 60_000;
      if (mins < 0 || mins > 30) continue;
      const key = `soon-${ev.id}`;
      if (seenSoon.current.has(key)) continue;
      seenSoon.current.add(key);
      boost(MOTION.popMs);
      pushVrSoftNotify({
        id: key,
        kind: "group-event",
        tone: "green",
        title: "Event startet bald",
        text: `${ev.title} · in ${Math.max(1, Math.round(mins))} Min.`,
        ttlMs: MOTION.toastMs,
      });
    }
  }, [cal.data, mute, boost]);
}

const PRESET_LABEL: Record<VrPresetId, string> = {
  streaming: "Streaming",
  chill: "Chill",
  event: "Event",
};

/** Layout-/Workspace-Presets: speichern/laden, Persistenz über Neustart (zustand). */
export function WorkspacePresetsBar({
  boost,
  open,
  onClose,
}: {
  boost: Boost;
  open: boolean;
  onClose: () => void;
}) {
  const applyPreset = useVrSettings((s) => s.applyPreset);
  const savePreset = useVrSettings((s) => s.savePresetFromCurrent);
  const presets = useVrSettings((s) => s.presets);
  if (!open) return null;
  return (
    <div className="furr-vr-notice flex flex-col gap-2 rounded-2xl border border-white/15 bg-[#0b0d14]/95 p-2.5">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-white/50">
          <LayoutTemplate className="size-3.5" /> Workspace
        </p>
        <button type="button" onClick={onClose} className="rounded-lg bg-white/10 px-2 py-1 text-[11px] active:scale-95">
          Weg
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {(["streaming", "chill", "event"] as VrPresetId[]).map((id) => (
          <div key={id} className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => {
                applyPreset(id);
                boost(MOTION.popMs);
              }}
              className="rounded-xl bg-white/10 px-2 py-2.5 text-[13px] font-semibold hover:bg-accent/40 active:scale-95"
              title={presets[id] ? "Gespeichertes Layout laden" : "Standard-Layout laden"}
            >
              {PRESET_LABEL[id]}
            </button>
            <button
              type="button"
              onClick={() => {
                savePreset(id);
                boost(MOTION.enterMs);
              }}
              className="rounded-lg bg-white/6 px-2 py-1 text-[10px] text-white/55 hover:bg-white/12 active:scale-95"
            >
              Speichern
            </button>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-white/40">
        Speichert Widgets, Infos, Button-/Gaze-/Point-Modus und Tastatur-Dock. Mind. Streaming + Chill (+ Event).
      </p>
    </div>
  );
}

const ROWS = ["qwertzuiop", "asdfghjkl", "yxcvbnm"];
const SUGGEST_SEED = [
  "Moderation anwesend",
  "Bitte an die Regeln halten",
  "Bin gleich zurück",
  "Kurz AFK",
  "Danke",
  "Willkommen",
  "Alles gut",
  "Einen Moment",
];

/** Overlay-Tastatur MVP: sichtbar, Lock, lokale Vorschläge, OSC-Send. STT = Limit. */
export function OverlayKeyboard({
  open,
  boost,
  onClose,
  sendOsc,
}: {
  open: boolean;
  boost: Boost;
  onClose: () => void;
  sendOsc: (text: string) => Promise<void>;
}) {
  const locked = useVrSettings((s) => s.keyboardLocked);
  const setLocked = useVrSettings((s) => s.setKeyboardLocked);
  const docked = useVrSettings((s) => s.keyboardDocked);
  const setDocked = useVrSettings((s) => s.setKeyboardDocked);
  const scale = useVrSettings((s) => s.keyboardScale);
  const setScale = useVrSettings((s) => s.setKeyboardScale);
  const streamerMode = useVrSettings((s) => s.streamerMode);
  const setStreamerMode = useVrSettings((s) => s.setStreamerMode);
  const passwordMode = useVrSettings((s) => s.keyboardPasswordMode);
  const setPasswordMode = useVrSettings((s) => s.setKeyboardPasswordMode);
  const history = useVrSettings((s) => s.keyboardHistory);
  const pushHistory = useVrSettings((s) => s.pushKeyboardHistory);

  const [text, setText] = useState("");
  const [shift, setShift] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const privacy = streamerMode || passwordMode;
  const suggestions = useMemo(() => {
    if (privacy || !text.trim()) return [];
    const q = text.toLowerCase();
    const pool = [...history, ...SUGGEST_SEED];
    const uniq = [...new Set(pool)];
    return uniq.filter((s) => s.toLowerCase().includes(q) || q.split(/\s+/).some((w) => w.length > 1 && s.toLowerCase().includes(w))).slice(0, 4);
  }, [text, history, privacy]);

  if (!open) return null;

  function typeKey(ch: string) {
    if (locked && ch.length === 1) {
      /* Lock bezieht sich auf Größe/Position, Tippen bleibt erlaubt */
    }
    boost(120);
    setText((t) => (t + ch).slice(0, 144));
    setShift(false);
  }

  async function send() {
    const clean = text.trim();
    if (!clean || busy) return;
    setBusy(true);
    setStatus("sendet…");
    boost(MOTION.popMs);
    try {
      await sendOsc(clean);
      if (!privacy) pushHistory(clean);
      setStatus("✓ gesendet");
      setText("");
      window.setTimeout(() => setStatus(null), 2500);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
      window.setTimeout(() => setStatus(null), 4000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={cn(
        "furr-vr-notice flex flex-col gap-1.5 rounded-2xl border border-white/15 bg-[#0b0d14]/96 p-2",
        docked ? "mt-auto" : "",
      )}
      style={{ transform: locked ? undefined : `scale(${scale})`, transformOrigin: "bottom center" }}
    >
      <div className="flex items-center gap-1.5">
        <Keyboard className="size-3.5 text-white/50" />
        <p className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-white/50">
          Tastatur {status ? `· ${status}` : ""}
        </p>
        <button
          type="button"
          title={locked ? "Entsperren (Größe/Position)" : "Sperren"}
          onClick={() => {
            setLocked(!locked);
            boost(200);
          }}
          className="grid size-8 place-items-center rounded-lg bg-white/10 active:scale-90"
        >
          {locked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
        </button>
        <button type="button" onClick={onClose} className="rounded-lg bg-white/10 px-2 py-1 text-[11px] active:scale-95">
          Weg
        </button>
      </div>

      <div className="min-h-[36px] rounded-xl bg-black/35 px-2.5 py-2 font-mono text-[15px] leading-snug">
        {passwordMode ? "•".repeat(Math.min(text.length, 24)) || <span className="text-white/35">Passwort…</span> : text || <span className="text-white/35">Tippen… (max. 144)</span>}
      </div>

      {!privacy && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setText(s.slice(0, 144));
                boost(150);
              }}
              className="rounded-lg bg-accent/25 px-2 py-1 text-[11px] font-medium active:scale-95"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1">
        {ROWS.map((row, ri) => (
          <div key={row} className="flex justify-center gap-0.5" style={{ paddingLeft: ri === 1 ? 8 : ri === 2 ? 16 : 0 }}>
            {ri === 2 && (
              <button
                type="button"
                onClick={() => setShift(!shift)}
                className={cn("rounded-md px-2 py-1.5 text-[11px] font-bold active:scale-95", shift ? "bg-accent text-black" : "bg-white/10")}
              >
                ⇧
              </button>
            )}
            {row.split("").map((ch) => {
              const glyph = shift ? ch.toUpperCase() : ch;
              return (
                <button
                  key={ch}
                  type="button"
                  onClick={() => typeKey(glyph)}
                  className="min-w-[22px] rounded-md bg-white/10 px-1.5 py-1.5 text-[13px] font-semibold hover:bg-white/20 active:scale-90"
                >
                  {glyph}
                </button>
              );
            })}
            {ri === 2 && (
              <button
                type="button"
                onClick={() => {
                  setText((t) => t.slice(0, -1));
                  boost(100);
                }}
                className="rounded-md bg-white/10 px-2 py-1.5 active:scale-90"
                aria-label="Löschen"
              >
                <Delete className="size-3.5" />
              </button>
            )}
          </div>
        ))}
        <div className="flex gap-1">
          <button type="button" onClick={() => typeKey(" ")} className="flex-1 rounded-md bg-white/10 py-2 text-[12px] active:scale-95">
            Leertaste
          </button>
          <button
            type="button"
            disabled={busy || !text.trim()}
            onClick={() => void send()}
            className="flex items-center gap-1 rounded-md bg-accent px-3 py-2 text-[12px] font-bold text-black active:scale-95 disabled:opacity-40"
          >
            <Send className="size-3.5" /> OSC
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-white/50">
        <button
          type="button"
          disabled={locked}
          onClick={() => setDocked(!docked)}
          className="rounded bg-white/8 px-1.5 py-0.5 disabled:opacity-40"
        >
          {docked ? "Angedockt" : "Frei"}
        </button>
        <button
          type="button"
          disabled={locked}
          onClick={() => setScale(scale >= 1.15 ? 0.9 : Number((scale + 0.1).toFixed(2)))}
          className="rounded bg-white/8 px-1.5 py-0.5 disabled:opacity-40"
        >
          Größe {Math.round(scale * 100)}%
        </button>
        <button
          type="button"
          onClick={() => setStreamerMode(!streamerMode)}
          className={cn("rounded px-1.5 py-0.5", streamerMode ? "bg-amber-500/40 text-amber-100" : "bg-white/8")}
        >
          Streamer {streamerMode ? "an" : "aus"}
        </button>
        <button
          type="button"
          onClick={() => setPasswordMode(!passwordMode)}
          className={cn("rounded px-1.5 py-0.5", passwordMode ? "bg-amber-500/40 text-amber-100" : "bg-white/8")}
        >
          Passwortfeld
        </button>
        <span className="flex items-center gap-1 text-white/35" title="Limit">
          <MicOff className="size-3" /> STT nicht verbaut
        </span>
      </div>
    </div>
  );
}

export type { VrPresetSnapshot };