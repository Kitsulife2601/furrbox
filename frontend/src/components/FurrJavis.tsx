"use client";

import { Bot, Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FurrWindow } from "@/components/FurrWindow";
import { getJavisStatus, sendJavisMessage, type JavisMessage, type JavisStatus } from "@/lib/javis";
import { useFurrBoxStore } from "@/store/furrbox-store";
import type { FurrWindowState } from "@/store/useWindowStore";

const suggestions = ["Was kannst du?", "Erinnere mich in 10 Minuten an Pause", "Wie spät ist es?", "Suche datei log"];

function welcomeMessage(): JavisMessage {
  return {
    id: "javis-welcome",
    role: "assistant",
    content: 'Hallo! Ich bin Javis und laufe direkt im FurrBox-Backend - ohne n8n. Schreib "hilfe", um meine Befehle zu sehen.',
    createdAt: new Date().toISOString()
  };
}

export function FurrJavis({ windowState }: { windowState: FurrWindowState }) {
  const token = useFurrBoxStore((state) => state.token);
  const [messages, setMessages] = useState<JavisMessage[]>(() => [welcomeMessage()]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<JavisStatus | null>(null);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!windowState.isOpen || !token) return;
    getJavisStatus(token)
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [token, windowState.isOpen]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, busy, windowState.isOpen]);

  async function submit(rawMessage?: string) {
    const content = (rawMessage ?? draft).trim();
    if (!token || !content || busy) return;
    const userMessage: JavisMessage = { id: crypto.randomUUID(), role: "user", content, createdAt: new Date().toISOString() };
    const history = messages
      .filter((message) => message.id !== "javis-welcome")
      .slice(-10)
      .map((message) => ({ role: message.role, content: message.content }));
    setMessages((items) => [...items, userMessage]);
    setDraft("");
    setBusy(true);
    setError("");
    try {
      const response = await sendJavisMessage(token, content, history);
      setMessages((items) => [
        ...items,
        { id: crypto.randomUUID(), role: "assistant", content: response.reply, source: response.source, createdAt: new Date().toISOString() }
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Javis konnte nicht antworten.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <FurrWindow windowState={windowState} icon={<Bot size={15} />}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-purple-500/20 bg-slate-950/55 px-4 py-2">
          <Sparkles size={13} className="text-[#00f0ff]" />
          <span className="text-[11px] text-slate-400">
            {status?.llmConfigured
              ? `Sprachmodell verbunden: ${status.model}`
              : "Offline-Modus: eingebaute Befehle aktiv, kein Sprachmodell konfiguriert"}
          </span>
        </div>

        <div ref={scrollRef} className="scroll-soft min-h-0 flex-1 space-y-2 overflow-auto p-3">
          {messages.map((message) => {
            const own = message.role === "user";
            return (
              <div key={message.id} className={`flex ${own ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl border px-3 py-2 ${own ? "border-cyan-300/25 bg-cyan-500/10" : "border-purple-500/25 bg-purple-500/10"}`}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
                    <span>{own ? "Du" : message.source === "llm" ? "Javis · LLM" : "Javis"}</span>
                    <span>{new Date(message.createdAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-[12px] leading-5 text-slate-100">{message.content}</p>
                </div>
              </div>
            );
          })}
          {busy ? (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-purple-500/25 bg-purple-500/10 px-3 py-2 text-[12px] text-slate-400">Javis denkt nach...</div>
            </div>
          ) : null}
        </div>

        {messages.length <= 1 ? (
          <div className="flex flex-wrap gap-2 px-3 pb-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                className="rounded-full border border-cyan-300/20 bg-slate-900/45 px-3 py-1.5 text-[11px] text-cyan-100 hover:border-cyan-300/45 hover:bg-cyan-500/10"
                onClick={() => submit(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}

        {error ? <div className="border-t border-pink-500/20 bg-pink-500/10 px-4 py-2 text-[11px] text-pink-100">{error}</div> : null}

        <footer className="border-t border-cyan-300/15 p-3">
          <div className="flex gap-2">
            <textarea
              className="scroll-soft h-12 min-h-12 flex-1 resize-none rounded-xl border border-cyan-300/15 bg-black/35 px-3 py-2 text-[12px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-300/45"
              value={draft}
              maxLength={4000}
              placeholder="Frag Javis etwas..."
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            <button
              className="grid h-12 w-12 place-items-center rounded-xl border border-cyan-300/35 bg-cyan-500/10 text-[#00f0ff] shadow-[0_0_16px_rgba(0,240,255,0.2)] hover:bg-cyan-500/20 disabled:opacity-40"
              disabled={!draft.trim() || busy}
              onClick={() => submit()}
              aria-label="Nachricht an Javis senden"
            >
              <Send size={18} />
            </button>
          </div>
        </footer>
      </div>
    </FurrWindow>
  );
}
