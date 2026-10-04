// FurrBox VR: the page shown on your arm in SteamVR (rendered offscreen by the desktop app,
// 480 × 640, operated with the SteamVR laser pointer). Layout: a small info bar on top, pages in
// the middle that you swipe through (or use the arrows), a small info bar at the bottom.
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, LogIn, LogOut, MessageSquare, Radar, Send, Users } from "lucide-react";
import { desktopVrchat, unwrap, type VrcInstanceState } from "@/components/furr/VRChat";
import { listChatMessages } from "@/lib/furr/api/chat";
import { listVrchatInstances } from "@/lib/furr/api/vrchat";
import { errorMessage, useMe } from "@/lib/furr/client";
import { cn } from "@/lib/utils";
import { syncVrSettings, useVrSettings, type VrInfoId, type VrWidgetId } from "@/store/vr";

type OscBridge = { chatbox(text: string): Promise<{ ok: true } | { ok: false; error: string }> };
const osc = () => (window as { furrbox?: { osc?: OscBridge } }).furrbox?.osc ?? null;

/** A vote kick stays on screen this long. */
const VOTE_ALERT_MS = 45_000;
/** Drag further than this (px) to change the page. */
const SWIPE_PX = 60;

const PAGE_TITLE: Record<Exclude<VrWidgetId, "votekick">, string> = {
  instance: "Instanz",
  chatbox: "Chatbox",
  teamchat: "Team-Chat",
};

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
  // Group instances: the bot knows since when they are open.
  const wantsAge = infos.instanceAge !== "off";
  const group = useQuery({
    queryKey: ["furr", "vrchat", "instances"],
    queryFn: () => listVrchatInstances(),
    enabled: wantsAge && Boolean(me.data),
    refetchInterval: 60_000,
    retry: false,
  });
  const openedAt = group.data?.instances.find((i) => i.location === s?.location)?.openedAt ?? null;

  const vote = s?.votes?.find((v) => !v.result && now.getTime() - new Date(v.at).getTime() < VOTE_ALERT_MS) ?? null;
  const lastVote = s?.votes?.[0] ?? null;

  const info: Record<VrInfoId, string | null> = {
    time: now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
    date: now.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" }),
    world: s?.inInstance ? (s.worldName ?? "Unbekannte Welt") : "Nicht in einer Instanz",
    people: s?.inInstance ? `${s.players.length} Leute` : null,
    joined: s?.inInstance && s.joinedAt ? `Du: seit ${since(s.joinedAt, now)}` : null,
    instanceAge: s?.inInstance ? (openedAt ? `Instanz offen: ${since(openedAt, now)}` : s.joinedAt ? `Instanz: mind. ${since(s.joinedAt, now)}` : null) : null,
  };

  const pages = (["instance", "chatbox", "teamchat"] as const).filter((id) => widgets[id]);
  const current = Math.min(page, Math.max(0, pages.length - 1));
  const go = (delta: number) => setPage(Math.min(pages.length - 1, Math.max(0, current + delta)));

  return (
    <div className="flex h-screen w-screen select-none flex-col gap-2 overflow-hidden rounded-[28px] border-2 border-white/15 bg-[#0b0d14]/92 p-3 text-white">
      <InfoBar place="top" info={info} />

      {widgets.votekick && vote && <VoteAlert vote={vote} />}
      {widgets.votekick && !vote && lastVote && now.getTime() - new Date(lastVote.at).getTime() < 10 * 60_000 && (
        <p className="rounded-xl bg-amber-500/12 px-3 py-1.5 text-[13px] text-amber-200">
          Letzter Votekick {clock(lastVote.at)}: gegen <b>{lastVote.target}</b>
          {lastVote.initiator ? ` – gestartet von ${lastVote.initiator}` : ""}
          {lastVote.result === "kicked" ? " · wurde gekickt" : lastVote.result === "failed" ? " · abgelehnt" : ""}
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
          {/* Pages: drag sideways with the laser (hold the trigger) or use the arrows below. */}
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
                  {id === "chatbox" && <Chatbox />}
                  {id === "teamchat" && <TeamChat />}
                </div>
              ))}
            </div>
          </div>
          {pages.length > 1 && (
            <nav className="flex items-center gap-2">
              <NavButton label="Zurück" disabled={current === 0} onClick={() => go(-1)}>
                <ChevronLeft className="size-6" />
              </NavButton>
              <div className="flex flex-1 items-center justify-center gap-2">
                {pages.map((id, i) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setPage(i)}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-[13px] font-medium",
                      i === current ? "bg-accent text-black" : "bg-white/8 text-white/60 hover:bg-white/15",
                    )}
                  >
                    {PAGE_TITLE[id]}
                  </button>
                ))}
              </div>
              <NavButton label="Weiter" disabled={current === pages.length - 1} onClick={() => go(1)}>
                <ChevronRight className="size-6" />
              </NavButton>
            </nav>
          )}
        </>
      )}

      <InfoBar place="bottom" info={info} />
    </div>
  );
}

/** Small bar with the info items chosen for this place (FurrSettings → FurrBox VR). */
function InfoBar({ place, info }: { place: "top" | "bottom"; info: Record<VrInfoId, string | null> }) {
  const infos = useVrSettings((s) => s.infos);
  const ids = (Object.keys(info) as VrInfoId[]).filter((id) => infos[id] === place && info[id]);
  if (ids.length === 0) return null;
  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 rounded-xl bg-white/6 px-3",
        place === "top" ? "py-2" : "justify-center py-1.5 text-white/65",
      )}
    >
      {ids.map((id) => (
        <span
          key={id}
          className={cn(
            "flex min-w-0 items-center gap-1.5 truncate",
            id === "time" && place === "top" ? "text-[24px] font-bold tabular-nums leading-none" : "text-[13px]",
            id === "world" && "flex-1 font-semibold",
          )}
        >
          {id === "people" && <Users className="size-3.5 shrink-0" />}
          <span className="truncate">{info[id]}</span>
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
      className="grid size-10 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-25"
    >
      {children}
    </button>
  );
}

function VoteAlert({ vote }: { vote: NonNullable<VrcInstanceState["votes"]>[number] }) {
  return (
    <div className="furr-vr-alert flex items-center gap-3 rounded-2xl border-2 border-red-400 bg-red-500/25 px-4 py-3">
      <AlertTriangle className="size-9 shrink-0 text-red-300" />
      <div className="min-w-0">
        <p className="text-[13px] font-bold uppercase tracking-wide text-red-200">Votekick gestartet · {clock(vote.at)}</p>
        <p className="truncate text-[19px] font-bold leading-tight">gegen {vote.target}</p>
        <p className="truncate text-[14px] text-white/80">
          {vote.initiator ? (
            <>
              gestartet von <b>{vote.initiator}</b>
            </>
          ) : (
            "Starter wird von VRChat nicht genannt"
          )}
        </p>
      </div>
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
  const recent = s.events.slice(0, 3);
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
              "overflow-hidden rounded-xl px-3 py-2 text-left text-[15px] font-medium leading-tight active:scale-95",
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
  const last = (chat.data ?? []).slice(-8);
  return (
    <section className="flex min-h-0 flex-1 flex-col justify-end gap-1 overflow-hidden rounded-2xl bg-white/6 p-2.5">
      <p className="mb-auto flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-white/50">
        <MessageSquare className="size-3.5" /> Team-Chat
      </p>
      {last.length === 0 ? (
        <p className="text-[13px] text-white/50">Noch keine Nachrichten.</p>
      ) : (
        last.map((m) => (
          <p key={m.id} className="text-[14px] leading-snug">
            <b className="font-semibold text-accent">{m.senderName}</b>{" "}
            <span className="text-white/45">{clock(m.createdAt)}</span>
            <br />
            <span className="line-clamp-2 text-white/85">{m.content}</span>
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
