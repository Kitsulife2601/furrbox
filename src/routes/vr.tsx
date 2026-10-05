// FurrBox VR: the page shown on your arm in SteamVR (rendered offscreen by the desktop app,
// operated with the SteamVR laser pointer). Layout like OVR Toolkit: a small widget on the wrist
// (clock, music, battery, notices – 520 × 200) and, when open, a window above it (520 × 700 in total)
// with pages you swipe through.
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  DoorOpen,
  LogIn,
  LogOut,
  MessageSquare,
  Music,
  Pause,
  PawPrint,
  Play,
  Radar,
  Send,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Users,
  X,
} from "lucide-react";
import { desktopVrchat, unwrap, type VrcInstanceState } from "@/components/furr/VRChat";
import { listChatMessages } from "@/lib/furr/api/chat";
import { listDuty, markVotekickDone, setDuty } from "@/lib/furr/api/duty";
import { listPresence } from "@/lib/furr/api/presence";
import { listVrchatInstances } from "@/lib/furr/api/vrchat";
import { errorMessage, useMe } from "@/lib/furr/client";
import { playSound } from "@/lib/furr/sounds";
import type { PresenceUser } from "@/lib/furr/types";
import { cn } from "@/lib/utils";
import { syncVrSettings, useVrSettings, type VrInfoId, type VrWidgetId } from "@/store/vr";

type OscBridge = { chatbox(text: string): Promise<{ ok: true } | { ok: false; error: string }> };
const osc = () => (window as { furrbox?: { osc?: OscBridge } }).furrbox?.osc ?? null;

type Song = { playing: boolean; title: string; artist: string; app: string; position?: number; duration?: number };
type MediaBridge = { state(): Promise<Song | null>; control(action: "toggle" | "next" | "prev"): Promise<boolean> };
const mediaBridge = () => (window as { furrbox?: { media?: MediaBridge } }).furrbox?.media ?? null;
type Battery = { headset: number | null; left: number | null; right: number | null };
type PanelBridge = {
  setMode?(mode: "widget" | "full"): Promise<boolean>;
  onGaze?(cb: (looking: boolean) => void): () => void;
  battery?(): Promise<Battery | null>;
};
const panelBridge = () => (window as { furrbox?: { vr?: PanelBridge } }).furrbox?.vr ?? null;

function mmss(sec: number) {
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}
/** A new chat message is announced this long. */
const CHAT_ALERT_MS = 20_000;

/** A vote kick stays on screen this long. */
const VOTE_ALERT_MS = 45_000;
/** A newly opened group instance is announced this long. */
const INSTANCE_ALERT_MS = 2 * 60_000;
/** Drag further than this (px) to change the page. */
const SWIPE_PX = 60;

type PageId = Exclude<VrWidgetId, "votekick" | "instanceAlert" | "chatAlert">;
const PAGES: PageId[] = ["instance", "team", "music", "chatbox", "teamchat"];
const PAGE_TITLE: Record<PageId, string> = { instance: "Instanz", team: "Team", music: "Musik", chatbox: "Chatbox", teamchat: "Chat" };

function clock(at: string | null) {
  return at ? new Date(at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "–";
}

function since(at: string | null, now: Date) {
  if (!at) return null;
  const min = Math.max(0, Math.floor((now.getTime() - new Date(at).getTime()) / 60_000));
  return min < 60 ? `${min} Min.` : `${Math.floor(min / 60)} Std. ${min % 60} Min.`;
}

function VrPanel() {
  const me = useMe();
  const widgets = useVrSettings((s) => s.widgets);
  const infos = useVrSettings((s) => s.infos);
  const [now, setNow] = useState(() => new Date());
  const [page, setPage] = useState(0);
  const drag = useRef<number | null>(null);
  const buttonMode = useVrSettings((s) => s.buttonMode);
  const queryClient = useQueryClient();
  // Button mode: closed by default. Events do not open the panel – they show a short notice instead.
  const [open, setOpen] = useState(false);
  // Looking at your arm opens the panel, looking away closes it again (no tapping needed).
  const gazeOpen = useVrSettings((s) => s.gazeOpen);
  const [gaze, setGaze] = useState(false);
  useEffect(() => panelBridge()?.onGaze?.(setGaze), []);
  const collapsed = buttonMode && !open && !(gazeOpen && gaze);
  /** Notices marked "Erledigt" (vote kick / chat message / instance ids). */
  const [done, setDone] = useState<string[]>([]);
  const dismiss = (id: string) => setDone((d) => [...d.slice(-40), id]);

  useEffect(() => {
    // The page floats in VR: no page background, only the panel itself.
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    const t = setInterval(() => setNow(new Date()), 10_000);
    const unsync = syncVrSettings();
    return () => {
      clearInterval(t);
      unsync();
    };
  }, []);

  const inst = useQuery({
    queryKey: ["furr", "vr", "instance"],
    queryFn: () => unwrap(desktopVrchat()!.instance!()),
    enabled: Boolean(desktopVrchat()?.instance),
    refetchInterval: 2_000,
  });
  const s = inst.data;
  // Group instances (from the Discord bot): since when they are open, and newly opened ones.
  const group = useQuery({
    queryKey: ["furr", "vrchat", "instances"],
    queryFn: () => listVrchatInstances(),
    enabled: Boolean(me.data) && (infos.instanceAge !== "off" || widgets.instanceAlert),
    refetchInterval: 30_000,
    retry: false,
  });
  const openedAt = group.data?.instances.find((i) => i.location === s?.location)?.openedAt ?? null;
  const fresh = (group.data?.instances ?? []).find(
    (i) => !done.includes(i.instanceId) && now.getTime() - new Date(i.openedAt).getTime() < INSTANCE_ALERT_MS && i.location !== s?.location,
  );

  const vote = s?.votes?.find((v) => !v.result && !done.includes(v.id) && now.getTime() - new Date(v.at).getTime() < VOTE_ALERT_MS) ?? null;
  const lastVote = s?.votes?.[0] ?? null;

  // Newest message of the team chat (for the "new message" hint).
  const chat = useQuery({
    queryKey: ["furr", "chat", "team", ""],
    queryFn: () => listChatMessages({ data: { channel: "team" } }),
    enabled: Boolean(me.data) && (widgets.chatAlert || widgets.teamchat),
    refetchInterval: 5_000,
  });
  const newest = chat.data?.[chat.data.length - 1] ?? null;
  const chatAlert =
    widgets.chatAlert &&
    newest &&
    !done.includes(newest.id) &&
    newest.senderId !== me.data?.userId &&
    now.getTime() - new Date(newest.createdAt).getTime() < CHAT_ALERT_MS
      ? newest
      : null;

  const song = useQuery({
    queryKey: ["furr", "vr", "media"],
    queryFn: async () => (await mediaBridge()!.state()) ?? null,
    enabled: Boolean(mediaBridge()),
    refetchInterval: 3_000,
  });

  // Anwesenheit: can I moderate right now? Shown in the team list and used by the bot's message.
  const duty = useQuery({ queryKey: ["furr", "duty"], queryFn: () => listDuty(), enabled: Boolean(me.data), refetchInterval: 20_000, retry: false });
  const onDuty = Boolean(duty.data?.find((d) => d.userId === me.data?.userId)?.onDuty);
  async function toggleDuty() {
    await setDuty({ data: !onDuty }).catch(() => undefined);
    await queryClient.invalidateQueries({ queryKey: ["furr", "duty"] });
  }

  // What to announce while the panel is closed: vote kick first, then chat, then a new instance.
  const notice = widgets.votekick && vote
    ? { id: vote.id, tone: "red" as const, title: `Votekick gegen ${vote.target}`, text: vote.initiator ? `gestartet von ${vote.initiator}` : "Starter unbekannt" }
    : chatAlert
      ? { id: chatAlert.id, tone: "blue" as const, title: `Nachricht von ${chatAlert.senderName}`, text: chatAlert.content }
      : widgets.instanceAlert && fresh
        ? { id: fresh.instanceId, tone: "green" as const, title: "Neue Gruppen-Instanz", text: `${fresh.worldName} · ${fresh.memberCount} Leute` }
        : null;
  const voteDone = () => {
    if (!vote) return;
    dismiss(vote.id);
    void markVotekickDone({ data: { target: vote.target, initiator: vote.initiator, world: s?.worldName ?? null } }).catch(() => undefined);
  };

  const info: Record<VrInfoId, string | null> = {
    time: now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
    date: now.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" }),
    world: s?.inInstance ? (s.worldName ?? "Unbekannte Welt") : "Nicht in einer Instanz",
    people: s?.inInstance ? `${s.players.length} Leute` : null,
    joined: s?.inInstance && s.joinedAt ? `Du: seit ${since(s.joinedAt, now)}` : null,
    instanceAge: s?.inInstance ? (openedAt ? `Instanz offen: ${since(openedAt, now)}` : s.joinedAt ? `Instanz: mind. ${since(s.joinedAt, now)}` : null) : null,
    music: null,
  };
  const pages = PAGES.filter((id) => widgets[id]);
  const current = Math.min(page, Math.max(0, pages.length - 1));
  const go = (delta: number) => setPage(Math.min(pages.length - 1, Math.max(0, current + delta)));

  // Song in the widget; battery of headset and controllers.
  const battery = useQuery({
    queryKey: ["furr", "vr", "battery"],
    queryFn: async () => (await panelBridge()?.battery?.()) ?? null,
    enabled: Boolean(panelBridge()?.battery),
    refetchInterval: 30_000,
  });
  const control = (action: "toggle" | "next" | "prev") => {
    void mediaBridge()
      ?.control(action)
      .then(() => window.setTimeout(() => void song.refetch(), 1200));
  };

  // Sounds (each event only once, even with FurrBox open on the desktop too).
  const voteSoundId = widgets.votekick ? (vote?.id ?? null) : null;
  useEffect(() => {
    if (voteSoundId) playSound("votekick", { eventId: voteSoundId });
  }, [voteSoundId]);
  const chatSoundId = chatAlert?.id ?? null;
  useEffect(() => {
    if (chatSoundId) playSound("chat", { eventId: chatSoundId });
  }, [chatSoundId]);

  const mode = collapsed ? "widget" : "full";
  useEffect(() => {
    void panelBridge()?.setMode?.(mode);
  }, [mode]);

  const tone = notice ? { red: "border-red-400 bg-red-950/95", blue: "border-accent bg-[#0b1a26]/95", green: "border-emerald-400 bg-emerald-950/95" }[notice.tone] : "";
  const bottomInfos = (Object.keys(info) as VrInfoId[]).filter((id) => id !== "time" && id !== "music" && infos[id] === "bottom" && info[id]);
  const topInfos = (Object.keys(info) as VrInfoId[]).filter((id) => id !== "time" && id !== "music" && infos[id] === "top" && info[id]);

  return (
    <div className="flex h-screen w-screen select-none flex-col justify-end gap-2 overflow-hidden text-white">
      {/* The window above the wrist (only while open). */}
      {!collapsed && (
        <div className="furr-vr-window flex min-h-0 flex-1 flex-col gap-2 overflow-hidden rounded-[22px] border-2 border-white/15 bg-[#0b0d14]/93 p-2.5">
          {topInfos.length > 0 && (
            <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 rounded-xl bg-white/6 px-3 py-1.5 text-[13px]">
              {topInfos.map((id) => (
                <span key={id} className={cn("flex min-w-0 items-center gap-1.5", id === "world" && "min-w-[45%] flex-1 font-semibold")}>
                  {id === "people" && <Users className="size-3.5 shrink-0" />}
                  <span className="truncate">{info[id]}</span>
                </span>
              ))}
            </div>
          )}
          {widgets.votekick && vote && <VoteAlert vote={vote} onDone={voteDone} />}
          {widgets.votekick && !vote && lastVote && now.getTime() - new Date(lastVote.at).getTime() < 10 * 60_000 && (
            <p className="truncate rounded-xl bg-amber-500/12 px-3 py-1 text-[13px] text-amber-200">
              Votekick {clock(lastVote.at)}: gegen <b>{lastVote.target}</b>
              {lastVote.initiator ? ` – von ${lastVote.initiator}` : ""}
              {lastVote.result === "kicked" ? " · gekickt" : lastVote.result === "failed" ? " · abgelehnt" : ""}
            </p>
          )}

          {!me.data ? (
            <p className="grid flex-1 place-items-center px-6 text-center text-[16px] text-white/60">
              {me.isLoading ? "Lade…" : "Bitte melde dich in FurrBox auf dem Desktop an."}
            </p>
          ) : pages.length === 0 ? (
            <div className="flex-1" />
          ) : (
            <>
              {/* Pages: drag sideways with the laser (hold the trigger) or use the tabs / arrows. */}
              <div
                className="relative min-h-0 flex-1 overflow-hidden"
                onMouseDown={(e) => {
                  drag.current = e.clientX;
                }}
                onMouseUp={(e) => {
                  if (drag.current === null) return;
                  const dx = e.clientX - drag.current;
                  drag.current = null;
                  if (dx <= -SWIPE_PX) go(1);
                  else if (dx >= SWIPE_PX) go(-1);
                }}
                onMouseLeave={() => {
                  drag.current = null;
                }}
              >
                <div className="flex h-full transition-transform duration-300 ease-out" style={{ transform: `translateX(-${current * 100}%)` }}>
                  {pages.map((id) => (
                    <div key={id} className="flex h-full w-full shrink-0 flex-col">
                      {id === "instance" && <InstanceList state={s} />}
                      {id === "team" && <TeamList duty={duty.data ?? []} onDuty={onDuty} onToggle={() => void toggleDuty()} />}
                      {id === "music" && <MusicPage song={song.data ?? null} onChanged={() => void song.refetch()} />}
                      {id === "chatbox" && <Chatbox />}
                      {id === "teamchat" && <TeamChat />}
                    </div>
                  ))}
                </div>
              </div>
              {pages.length > 1 && (
                <nav className="flex items-center gap-1">
                  <NavButton label="Zurück" disabled={current === 0} onClick={() => go(-1)}>
                    <ChevronLeft className="size-5" />
                  </NavButton>
                  <div className="flex min-w-0 flex-1 items-center justify-center gap-1">
                    {pages.map((id, i) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setPage(i)}
                        className={cn(
                          "rounded-full px-2.5 py-1.5 text-[13px] font-medium",
                          i === current ? "bg-accent text-black" : "bg-white/8 text-white/60 hover:bg-white/15",
                        )}
                      >
                        {PAGE_TITLE[id]}
                      </button>
                    ))}
                  </div>
                  <NavButton label="Weiter" disabled={current === pages.length - 1} onClick={() => go(1)}>
                    <ChevronRight className="size-5" />
                  </NavButton>
                </nav>
              )}
            </>
          )}
        </div>
      )}

      {/* The widget on the wrist: always there. */}
      <div
        className={cn(
          "flex h-[192px] shrink-0 flex-col gap-1.5 overflow-hidden rounded-[22px] border-2 p-2.5",
          notice && collapsed ? cn(tone, notice.tone === "red" && "furr-vr-alert") : "border-white/15 bg-[#0b0d14]/93",
        )}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-[40px] font-bold tabular-nums leading-none">{info.time}</span>
          <div className="grid min-w-0 flex-1 justify-items-start gap-1">
            <p className="truncate text-[13px] leading-none text-white/70">{info.date}</p>
            {/* Tap to switch between "Anwesend" (you can moderate right now) and "Nicht anwesend". */}
            {me.data && (
              <button
                type="button"
                onClick={() => void toggleDuty()}
                aria-pressed={onDuty}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold leading-none",
                  onDuty ? "bg-emerald-500 text-black" : "bg-white/12 text-white hover:bg-white/25",
                )}
              >
                <span className={cn("size-2.5 shrink-0 rounded-full", onDuty ? "bg-black/60" : "bg-white/40")} />
                {onDuty ? "Anwesend" : "Nicht anwesend"}
              </button>
            )}
          </div>
          <BatteryChips battery={battery.data ?? null} />
          {buttonMode && (
            <button
              type="button"
              aria-label={open ? "Fenster schließen" : "Fenster öffnen"}
              onClick={() => setOpen(!open)}
              className={cn("grid size-12 shrink-0 place-items-center rounded-full", open ? "bg-accent text-black" : "bg-white/12 hover:bg-white/25")}
            >
              {open ? <X className="size-6" /> : <PawPrint className="size-6" />}
            </button>
          )}
        </div>

        {notice && collapsed ? (
          <div className="flex min-h-0 flex-1 items-center gap-2">
            {notice.tone === "red" ? (
              <AlertTriangle className="size-9 shrink-0 text-red-300" />
            ) : notice.tone === "blue" ? (
              <MessageSquare className="size-9 shrink-0 text-accent" />
            ) : (
              <DoorOpen className="size-9 shrink-0 text-emerald-300" />
            )}
            <button type="button" onClick={() => setOpen(true)} className="min-w-0 flex-1 text-left" aria-label="Fenster öffnen">
              <span className="block truncate text-[19px] font-bold leading-tight">{notice.title}</span>
              <span className="block truncate text-[14px] text-white/75">{notice.text}</span>
            </button>
            <button
              type="button"
              onClick={() => (notice.tone === "red" ? voteDone() : dismiss(notice.id))}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-white/15 px-3 py-2.5 text-[14px] font-semibold hover:bg-emerald-500/60"
            >
              <Check className="size-5" /> Erledigt
            </button>
          </div>
        ) : (
          <>
            {/* Music like in OVR Toolkit: title with previous / play-pause / next. */}
            <div className="flex min-h-0 flex-1 items-center gap-2 rounded-xl bg-white/6 px-2.5">
              <Music className="size-5 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold leading-tight">{song.data?.title || "Keine Musik"}</p>
                <p className="truncate text-[12px] text-white/55">
                  {song.data?.title
                    ? `${song.data.artist}${song.data.duration ? ` · ${mmss(song.data.position ?? 0)} / ${mmss(song.data.duration)}` : ""}`
                    : "Spotify, YouTube … starten"}
                </p>
              </div>
              <button type="button" aria-label="Vorheriger Titel" onClick={() => control("prev")} className="grid size-10 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/25">
                <SkipBack className="size-5" />
              </button>
              <button type="button" aria-label="Wiedergabe / Pause" onClick={() => control("toggle")} className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-black">
                {song.data?.playing ? <Pause className="size-5" /> : <Play className="size-5" />}
              </button>
              <button type="button" aria-label="Nächster Titel" onClick={() => control("next")} className="grid size-10 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/25">
                <SkipForward className="size-5" />
              </button>
            </div>
            <p className="flex items-center gap-3 truncate px-1 text-[12px] text-white/60">
              {bottomInfos.length ? bottomInfos.map((id) => <span key={id} className="truncate">{info[id]}</span>) : <span>FurrBox VR</span>}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function BatteryChips({ battery }: { battery: { headset: number | null; left: number | null; right: number | null } | null }) {
  if (!battery) return null;
  const items = [
    ["Brille", battery.headset],
    ["L", battery.left],
    ["R", battery.right],
  ].filter(([, v]) => typeof v === "number") as [string, number][];
  if (items.length === 0) return null;
  return (
    <div className="flex shrink-0 gap-1">
      {items.map(([label, value]) => (
        <span
          key={label}
          className={cn("rounded-lg px-1.5 py-1 text-center text-[11px] leading-tight", value <= 0.2 ? "bg-red-500/30 text-red-200" : "bg-white/8 text-white/75")}
          title={`Akku ${label}`}
        >
          <span className="block text-[10px] text-white/50">{label}</span>
          <span className="block font-semibold tabular-nums">{Math.round(value * 100)}%</span>
        </span>
      ))}
    </div>
  );
}

function NavButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-25"
    >
      {children}
    </button>
  );
}

function VoteAlert({ vote, onDone }: { vote: NonNullable<VrcInstanceState["votes"]>[number]; onDone: () => void }) {
  return (
    <div className="furr-vr-alert mr-11 flex items-center gap-3 rounded-2xl border-2 border-red-400 bg-red-500/25 px-3 py-2">
      <AlertTriangle className="size-8 shrink-0 text-red-300" />
      <div className="min-w-0">
        <p className="text-[12px] font-bold uppercase tracking-wide text-red-200">Votekick gestartet · {clock(vote.at)}</p>
        <p className="truncate text-[18px] font-bold leading-tight">gegen {vote.target}</p>
        <p className="truncate text-[13px] text-white/80">
          {vote.initiator ? (
            <>
              gestartet von <b>{vote.initiator}</b>
            </>
          ) : (
            "Starter wird von VRChat nicht genannt"
          )}
        </p>
      </div>
      <button
        type="button"
        onClick={onDone}
        className="ml-auto flex shrink-0 items-center gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-[14px] font-semibold hover:bg-emerald-500/60"
        title="Schließt den Hinweis und schreibt es ins Anwesenheits-Protokoll"
      >
        <Check className="size-5" /> Erledigt
      </button>
    </div>
  );
}

function InstanceList({ state: s }: { state: VrcInstanceState | undefined }) {
  if (!desktopVrchat()?.instance) return <Hint>Der Instanz-Tracker braucht die FurrBox-Desktop-App.</Hint>;
  if (!s?.inInstance) {
    return (
      <Hint>
        <Radar className="mx-auto mb-1 size-7 text-white/40" />
        Betritt eine Welt – dann siehst du hier, wer da ist.
      </Hint>
    );
  }
  const recent = s.events.slice(0, 2);
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-1.5 rounded-2xl bg-white/6 p-2.5">
      <div className="flex min-h-0 flex-1 flex-wrap content-start gap-1.5 overflow-auto">
        {s.players.map((p) => (
          <span key={p.id ?? p.name} className="max-w-full truncate rounded-full bg-white/10 px-3 py-1 text-[14px]">
            {p.name}
          </span>
        ))}
      </div>
      {recent.length > 0 && (
        <div className="grid gap-0.5 border-t border-white/10 pt-1.5">
          {recent.map((e, i) => (
            <p key={`${e.at}-${i}`} className="flex items-center gap-2 text-[13px] text-white/75">
              {e.kind === "join" ? <LogIn className="size-4 shrink-0 text-emerald-400" /> : <LogOut className="size-4 shrink-0 text-amber-300" />}
              <span className="min-w-0 flex-1 truncate">
                <b className="font-semibold text-white">{e.name}</b> {e.kind === "join" ? "ist gekommen" : "ist gegangen"}
              </span>
              <span className="tabular-nums text-white/45">{clock(e.at)}</span>
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

const ROLE_ORDER = ["dev", "owner", "moderator", "supporter"];

/** How reachable a team member is right now ("anwesend" = marked themselves as able to moderate). */
function availability(u: PresenceUser, present: boolean) {
  if (present) return { rank: 0, dot: "bg-emerald-400", text: "anwesend" };
  if (u.isAppOnline) return { rank: 1, dot: "bg-amber-300", text: "nicht anwesend" };
  if (u.isDiscordOnline) return { rank: 1, dot: "bg-amber-300", text: u.discordStatus === "dnd" ? "nicht stören" : "nur Discord" };
  return { rank: 2, dot: "bg-white/25", text: "offline" };
}

/** Team list: who is anwesend (can moderate right now) and who is not – plus your own switch. */
function TeamList({ duty, onDuty, onToggle }: { duty: { userId: string; onDuty: boolean }[]; onDuty: boolean; onToggle: () => void }) {
  const team = useQuery({ queryKey: ["furr", "presence", "team"], queryFn: () => listPresence({ data: "team" }), refetchInterval: 15_000 });
  if (team.isError) return <Hint>{errorMessage(team.error)}</Hint>;
  const present = new Set(duty.filter((d) => d.onDuty).map((d) => d.userId));
  const availabilityOf = (u: PresenceUser) => availability(u, present.has(u.id));
  const list = [...(team.data ?? [])].sort(
    (a, b) =>
      availabilityOf(a).rank - availabilityOf(b).rank || ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.displayName.localeCompare(b.displayName, "de"),
  );
  const ready = list.filter((u) => present.has(u.id)).length;
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-1.5 rounded-2xl bg-white/6 p-2.5">
      <div className="flex items-center gap-2">
        <p className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-white/50">
          <ShieldCheck className="size-3.5" /> Team · {ready} anwesend
        </p>
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold",
            onDuty ? "bg-emerald-500 text-black" : "bg-white/12 text-white hover:bg-white/20",
          )}
          title="Tippen zum Umschalten – wird ins Anwesenheits-Protokoll geschrieben"
        >
          <span className={cn("size-2.5 rounded-full", onDuty ? "bg-black/60" : "bg-white/40")} />
          {onDuty ? "Anwesend" : "Nicht anwesend"}
        </button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-1 overflow-auto">
        {list.map((u) => {
          const a = availabilityOf(u);
          return (
            <div key={u.id} className={cn("flex items-center gap-2 rounded-lg px-2 py-1", a.rank === 0 ? "bg-emerald-500/12" : "bg-white/5", a.rank === 2 && "opacity-55")}>
              <span className={cn("size-2.5 shrink-0 rounded-full", a.dot)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium leading-tight">{u.nickname || u.displayName}</span>
                <span className="block truncate text-[11px] text-white/55">
                  {u.roleLabel} · {a.text}
                </span>
              </span>
            </div>
          );
        })}
        {team.data && list.length === 0 && <p className="col-span-2 text-[13px] text-white/50">Kein Team gefunden.</p>}
      </div>
    </section>
  );
}

/** What is playing (from Windows' media controls) with previous / play-pause / next. */
function MusicPage({ song, onChanged }: { song: Song | null; onChanged: () => void }) {
  const bridge = mediaBridge();
  if (!bridge) return <Hint>Musik braucht die FurrBox-Desktop-App.</Hint>;
  const control = (action: "toggle" | "next" | "prev") => {
    void bridge.control(action).then(() => window.setTimeout(onChanged, 1200));
  };
  const app = song?.app
    ? /spotify/i.test(song.app)
      ? "Spotify"
      : /chrome|msedge|firefox|opera|brave/i.test(song.app)
        ? "Browser"
        : song.app.replace(/\.exe$/i, "").split(/[!.]/)[0]
    : "";
  return (
    <section className="flex min-h-0 flex-1 flex-col justify-between gap-2 rounded-2xl bg-white/6 p-3">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-white/50">
          <Music className="size-3.5" /> {song?.title ? (song.playing ? "Läuft gerade" : "Pausiert") : "Musik"} {app && `· ${app}`}
        </p>
        {song?.title ? (
          <>
            <p className="mt-1 line-clamp-2 text-[20px] font-bold leading-tight">{song.title}</p>
            <p className="truncate text-[15px] text-white/65">{song.artist}</p>
            {Boolean(song.duration) && (
              <div className="mt-2 flex items-center gap-2 text-[12px] tabular-nums text-white/60">
                <span>{mmss(song.position ?? 0)}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/12">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, ((song.position ?? 0) / song.duration!) * 100)}%` }} />
                </div>
                <span>{mmss(song.duration!)}</span>
              </div>
            )}
          </>
        ) : (
          <p className="mt-2 text-[14px] text-white/55">Gerade läuft nichts. Starte Musik in Spotify, YouTube oder einem anderen Player.</p>
        )}
      </div>
      <div className="flex items-center justify-center gap-3">
        <button type="button" aria-label="Vorheriger Titel" onClick={() => control("prev")} className="grid size-12 place-items-center rounded-full bg-white/10 hover:bg-white/20">
          <SkipBack className="size-6" />
        </button>
        <button type="button" aria-label="Wiedergabe / Pause" onClick={() => control("toggle")} className="grid size-14 place-items-center rounded-full bg-accent text-black hover:brightness-110">
          {song?.playing ? <Pause className="size-7" /> : <Play className="size-7" />}
        </button>
        <button type="button" aria-label="Nächster Titel" onClick={() => control("next")} className="grid size-12 place-items-center rounded-full bg-white/10 hover:bg-white/20">
          <SkipForward className="size-6" />
        </button>
      </div>
    </section>
  );
}

function Chatbox() {
  const texts = useVrSettings((s) => s.texts);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState("");
  const timer = useRef<number | null>(null);

  async function send(text: string) {
    setError("");
    try {
      const bridge = osc();
      if (!bridge) throw new Error("Geht nur in der FurrBox-Desktop-App.");
      const r = await bridge.chatbox(text);
      if (!r.ok) throw new Error(r.error);
      setSent(text);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setSent(null), 2500);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-2xl bg-white/6 p-2.5">
      <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-white/50">
        <Send className="size-3.5" /> Chatbox {sent && <span className="normal-case tracking-normal text-emerald-300">· gesendet</span>}
        {error && <span className="normal-case tracking-normal text-red-300">· {error}</span>}
      </p>
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-2 gap-1.5">
        {texts.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => void send(t)}
            className={cn(
              "overflow-hidden rounded-xl px-3 py-1.5 text-left text-[14px] font-medium leading-tight active:scale-95",
              sent === t ? "bg-emerald-500/30" : "bg-white/10 hover:bg-accent/40",
            )}
          >
            {t}
          </button>
        ))}
      </div>
    </section>
  );
}

function TeamChat() {
  const chat = useQuery({
    queryKey: ["furr", "chat", "team", ""],
    queryFn: () => listChatMessages({ data: { channel: "team" } }),
    refetchInterval: 5_000,
  });
  const last = (chat.data ?? []).slice(-6);
  return (
    <section className="flex min-h-0 flex-1 flex-col justify-end gap-0.5 overflow-hidden rounded-2xl bg-white/6 p-2.5">
      <p className="mb-auto flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-white/50">
        <MessageSquare className="size-3.5" /> Team-Chat
      </p>
      {last.length === 0 ? (
        <p className="text-[13px] text-white/50">Noch keine Nachrichten.</p>
      ) : (
        last.map((m) => (
          <p key={m.id} className="truncate text-[14px] leading-snug">
            <span className="tabular-nums text-white/40">{clock(m.createdAt)}</span>{" "}
            <b className="font-semibold text-accent">{m.senderName}</b> <span className="text-white/85">{m.content}</span>
          </p>
        ))
      )}
    </section>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid flex-1 place-items-center rounded-2xl bg-white/6 px-6 text-center text-[15px] text-white/60">
      <div>{children}</div>
    </div>
  );
}

export const Route = createFileRoute("/vr")({ component: VrPanel });
