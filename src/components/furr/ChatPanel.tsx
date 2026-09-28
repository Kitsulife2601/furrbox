// FurrChat: team channel + private messages (taskbar panel).
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, X } from "lucide-react";
import { listChatMessages, sendChatMessage } from "@/lib/furr/api/chat";
import { listPresence } from "@/lib/furr/api/presence";
import { errorMessage, useMe } from "@/lib/furr/client";
import type { ChatChannel } from "@/lib/furr/types";
import { cn } from "@/lib/utils";
import { useDesktop } from "@/store/desktop";
import { useSync } from "./useFurrSync";
import { Btn, Empty, ErrorText } from "./ui";

export function ChatPanel() {
  const me = useMe();
  const queryClient = useQueryClient();
  const toggleChat = useDesktop((s) => s.toggleChat);
  const [channel, setChannel] = useState<ChatChannel>("team");
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    useSync.getState().set({ unreadChat: 0 });
  }, []);

  const users = useQuery({
    queryKey: ["furr", "presence", "global"],
    queryFn: () => listPresence({ data: "global" }),
    refetchInterval: 10_000,
  });
  const contacts = (users.data ?? []).filter((u) => u.hasAccount && u.id !== me.data?.userId);
  const partner = contacts.find((c) => c.id === partnerId) ?? null;

  const key = ["furr", "chat", channel, partnerId ?? ""] as const;
  const messages = useQuery({
    queryKey: key,
    queryFn: () => listChatMessages({ data: { channel, partnerId: partnerId ?? undefined } }),
    enabled: channel === "team" || Boolean(partnerId),
    refetchInterval: 3_000,
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.data?.length]);

  async function send() {
    const content = text.trim();
    if (!content) return;
    setError("");
    try {
      await sendChatMessage({ data: { channel, content, recipientId: partnerId ?? undefined } });
      setText("");
      await queryClient.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="mica absolute bottom-14 right-2 z-[85] flex h-[min(560px,calc(100%-4.5rem))] w-[min(420px,calc(100%-1rem))] flex-col overflow-hidden rounded-xl">
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        <p className="mr-2 text-[13px] font-semibold">FurrChat</p>
        <Btn variant={channel === "team" ? "default" : "ghost"} onClick={() => setChannel("team")}>
          Team
        </Btn>
        <Btn variant={channel === "private" ? "default" : "ghost"} onClick={() => setChannel("private")}>
          Privat
        </Btn>
        <button type="button" aria-label="Chat schließen" className="ml-auto rounded p-1 hover:bg-fg/10" onClick={() => toggleChat(false)}>
          <X className="size-4" />
        </button>
      </div>

      {channel === "private" && (
        <div className="flex gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
          {contacts.length === 0 && <span className="px-1 text-[12px] text-muted">Keine weiteren Accounts.</span>}
          {contacts.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setPartnerId(c.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] hover:bg-fg/8",
                partnerId === c.id && "bg-accent/20 text-accent",
              )}
            >
              <span className={cn("size-1.5 rounded-full", c.isAppOnline ? "bg-emerald-400" : "bg-fg/25")} />
              {c.displayName}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        {channel === "private" && !partner ? (
          <Empty>Wähle eine Person für den Privatchat.</Empty>
        ) : messages.isError ? (
          <Empty>{errorMessage(messages.error)}</Empty>
        ) : !messages.data?.length ? (
          <Empty>Noch keine Nachrichten.</Empty>
        ) : (
          messages.data.map((m) => {
            const mine = m.senderId === me.data?.userId;
            return (
              <div key={m.id} className={cn("mb-2 flex flex-col", mine ? "items-end" : "items-start")}>
                <span className="text-[11px] text-subtle">
                  {mine ? "Du" : m.senderName} · {m.senderRoleLabel} ·{" "}
                  {new Date(m.createdAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <p
                  className={cn(
                    "mt-0.5 max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-1.5 text-[13px]",
                    mine ? "bg-accent text-accent-fg" : "bg-elevated",
                  )}
                >
                  {m.content}
                </p>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-border p-2">
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            disabled={channel === "private" && !partner}
            placeholder={channel === "team" ? "Nachricht an das Team…" : partner ? `Nachricht an ${partner.displayName}…` : ""}
            className="max-h-24 min-h-9 flex-1 resize-none rounded-md border border-border bg-bg/60 px-3 py-2 text-[13px] outline-none focus:border-accent"
          />
          <Btn variant="primary" aria-label="Nachricht senden" disabled={!text.trim() || (channel === "private" && !partner)} onClick={() => void send()}>
            <Send className="size-4" />
          </Btn>
        </div>
      </div>
    </div>
  );
}
