// Chatbox-Hinweis an VRChat – zwei echte Wege:
// • „Meine Chatbox“: OSC über die Desktop-App (gleicher IPC-Pfad wie die Chatbox-Seite am Arm), 144 Zeichen.
// • „Team-Hinweis“: Server (postChatboxHint) → Alert-Bus → Bot/Overlay, kurzlebig, Server-Limit (Standard 80).
// Vorschau mit Zeichenzähler + Schnelltexte aus FurrBox VR.
import { useEffect, useRef, useState } from "react";
import { Check, Send } from "lucide-react";
import { errorMessage } from "@/lib/furr/client";
import { postChatboxHint } from "@/lib/furr/api/chatbox-hint";
import { cn } from "@/lib/utils";
import { useNotifications } from "@/store/notifications";
import { useVrSettings } from "@/store/vr";

/** VRChat zeigt höchstens 144 Zeichen in der Chatbox (desktop/main.cjs → osc.cjs). */
export const CHATBOX_LIMIT = 144;
/** Server-Standard für Team-Hinweise (Setting chatbox_hint_max_len, 20–140). */
export const TEAM_HINT_LIMIT = 80;

type OscBridge = { chatbox(text: string): Promise<{ ok: true } | { ok: false; error: string }> };
const osc = () => (typeof window === "undefined" ? null : ((window as { furrbox?: { osc?: OscBridge } }).furrbox?.osc ?? null));

export function ChatboxComposer({ compact = false }: { compact?: boolean }) {
  const texts = useVrSettings((s) => s.texts);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [state, setState] = useState<{ tone: "ok" | "bad"; msg: string } | null>(null);
  const timer = useRef<number | null>(null);
  const bridgeAvailable = Boolean(osc());
  const [mode, setMode] = useState<"osc" | "team">(bridgeAvailable ? "osc" : "team");
  const limit = mode === "osc" ? CHATBOX_LIMIT : TEAM_HINT_LIMIT;
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);
  const bridge = osc();
  const len = [...text].length;
  const over = len > limit;

  async function send(value: string) {
    const msg = value.trim();
    if (!msg || sending) return;
    setSending(true);
    setState(null);
    if (timer.current) window.clearTimeout(timer.current);
    try {
      if ([...msg].length > limit) throw new Error(`Zu lang – max. ${limit} Zeichen.`);
      if (mode === "osc") {
        if (!bridge) throw new Error("Geht nur in der FurrBox-Desktop-App.");
        const r = await bridge.chatbox(msg);
        if (!r.ok) throw new Error(r.error);
        setState({ tone: "ok", msg: "In deine Chatbox gesendet" });
      } else {
        const r = await postChatboxHint({ data: { text: msg } });
        setState({ tone: "ok", msg: `Team-Hinweis aktiv (${r.expiresInSec} s)` });
      }
      if (value === text) setText("");
      timer.current = window.setTimeout(() => setState(null), 3_000);
    } catch (e) {
      setState({ tone: "bad", msg: errorMessage(e) });
      useNotifications.getState().notify({ version: "FurrBox · Chatbox", kind: "system", tone: "error", title: "Chatbox-Hinweis fehlgeschlagen", description: errorMessage(e) });
      timer.current = window.setTimeout(() => setState(null), 5_000);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-bg/50 p-1 text-[11px]" role="radiogroup" aria-label="Ziel">
        {(
          [
            ["osc", "Meine Chatbox"],
            ["team", "Team-Hinweis"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={mode === id}
            disabled={id === "osc" && !bridge}
            title={id === "osc" ? (bridge ? "OSC an deine VRChat-Chatbox (144 Zeichen)" : "Nur in der Desktop-App") : "Über den Server an Bot/Overlay (kurzlebig)"}
            onClick={() => setMode(id)}
            className={cn("rounded-md py-1 font-medium transition", mode === id ? "bg-elevated text-fg shadow-sm" : "text-muted hover:text-fg", "disabled:opacity-40")}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="relative">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(text);
            }
          }}
          rows={compact ? 2 : 3}
          placeholder="Hinweis für die Instanz, z. B. „Bitte keine lauten Sounds 🙂“"
          className={cn(
            "w-full resize-none rounded-md border bg-bg/60 p-2 pb-5 text-[13px] text-fg outline-none placeholder:text-subtle",
            over ? "border-danger focus:border-danger" : "border-border focus:border-accent",
          )}
        />
        <span className={cn("pointer-events-none absolute bottom-1.5 right-2 text-[10px] tabular-nums", over ? "text-red-300" : len > limit - 20 ? "text-amber-300" : "text-subtle")}>
          {len}/{limit}
        </span>
      </div>
      {text.trim() && (
        <div className="furr-flyout-in rounded-lg bg-black/55 px-3 py-2 text-center text-[13px] leading-snug text-white shadow-inner" aria-label="Vorschau">
          <p className="mb-0.5 text-[10px] uppercase tracking-wide text-white/45">Vorschau in VRChat</p>
          <span className="whitespace-pre-wrap break-words">{[...text].slice(0, limit).join("")}</span>
          {over && <span className="text-red-300 line-through">{[...text].slice(limit).join("")}</span>}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!text.trim() || over || sending}
          onClick={() => void send(text)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[12px] font-medium text-accent-fg transition duration-150 active:scale-95 disabled:opacity-50"
        >
          <Send className="size-3.5" /> {sending ? "Sendet…" : "Senden"}
        </button>
        {state && (
          <span key={state.msg} className={cn("furr-vr-pop flex min-w-0 items-center gap-1 truncate text-[12px]", state.tone === "ok" ? "text-emerald-300" : "text-red-300")}>
            {state.tone === "ok" && <Check className="size-3.5" />} {state.msg}
          </span>
        )}
      </div>
      {texts.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {texts.slice(0, compact ? 6 : 12).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setText(t)}
              onDoubleClick={() => void send(t)}
              title="Klick: übernehmen · Doppelklick: sofort senden"
              className="max-w-full truncate rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted transition hover:border-accent hover:text-fg"
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
