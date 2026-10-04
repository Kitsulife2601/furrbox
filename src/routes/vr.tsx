// FurrBox VR: the page shown on your arm in SteamVR (rendered offscreen by the desktop app,
// 480 × 640, operated with the SteamVR laser pointer – so everything is big and scroll-free where possible).
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, LogIn, LogOut, MessageSquare, Radar, Send, Users } from "lucide-react";
import { desktopVrchat, unwrap, type VrcInstanceState } from "@/components/furr/VRChat";
import { listChatMessages } from "@/lib/furr/api/chat";
import { errorMessage, useMe } from "@/lib/furr/client";
import { cn } from "@/lib/utils";
import { syncVrSettings, useVrSettings } from "@/store/vr";

type OscBridge = { chatbox(text: string): Promise<{ ok: true } | { ok: false; error: string }> };
const osc = () => (window as { furrbox?: { osc?: OscBridge } }).furrbox?.osc ?? null;

/** A vote kick stays on screen this long. */
const VOTE_ALERT_MS = 45_000;

function clock(at: string | null) {
  return at ? new Date(at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "–";
}

function VrPanel() {
  const me = useMe();
  const widgets = useVrSettings((s) => s.widgets);
  const [now, setNow] = useState(() => new Date());

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
  const vote = s?.votes?.find((v) => !v.result && now.getTime() - new Date(v.at).getTime() < VOTE_ALERT_MS) ?? null;
  const lastVote = s?.votes?.[0] ?? null;

  return (
    <div className="flex h-screen w-screen flex-col gap-2 overflow-hidden rounded-[28px] border-2 border-white/15 bg-[#0b0d14]/92 p-3 text-white">
      {widgets.clock && (
        <header className="flex items-center gap-3 rounded-2xl bg-white/6 px-4 py-2.5">
          <span className="text-[34px] font-bold tabular-nums leading-none">
            {now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold">{s?.inInstance ? (s.worldName ?? "Unbekannte Welt") : "Nicht in einer Instanz"}</p>
            <p className="flex items-center gap-1.5 text-[13px] text-white/60">
              <Users className="size-4" /> {s?.inInstance ? `${s.players.length} in der Instanz` : "FurrBox VR"}
            </p>
          </div>
        </header>
      )}

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
      ) : (
        <>
          {widgets.instance && <InstanceList state={s} />}
          {widgets.chatbox && <Chatbox />}
          {widgets.teamchat && <TeamChat />}
          {!widgets.instance && !widgets.chatbox && !widgets.teamchat && <div className="flex-1" />}
        </>
      )}
    </div>
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
    <section className="rounded-2xl bg-white/6 p-2.5">
      <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-white/50">
        <Send className="size-3.5" /> Chatbox {sent && <span className="normal-case tracking-normal text-emerald-300">· gesendet</span>}
        {error && <span className="normal-case tracking-normal text-red-300">· {error}</span>}
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {texts.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => void send(t)}
            className={cn(
              "truncate rounded-xl px-3 py-2.5 text-left text-[14px] font-medium active:scale-95",
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
  const last = (chat.data ?? []).slice(-3);
  return (
    <section className="rounded-2xl bg-white/6 p-2.5">
      <p className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-white/50">
        <MessageSquare className="size-3.5" /> Team-Chat
      </p>
      {last.length === 0 ? (
        <p className="text-[13px] text-white/50">Noch keine Nachrichten.</p>
      ) : (
        last.map((m) => (
          <p key={m.id} className="truncate text-[14px]">
            <b className="font-semibold text-accent">{m.senderName}</b> <span className="text-white/85">{m.content}</span>
          </p>
        ))
      )}
    </section>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div className="grid flex-1 place-items-center rounded-2xl bg-white/6 px-6 text-center text-[15px] text-white/60"><div>{children}</div></div>;
}

export const Route = createFileRoute("/vr")({ component: VrPanel });
