// FurrChat: team channel + private messages (taskbar panel) with emojis, stickers, evidence-case
// links and files from the PC.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, FolderLock, Paperclip, Send, Smile, X } from "lucide-react";
import { listChatMessages, readChatAttachment, sendChatMessage } from "@/lib/furr/api/chat";
import { listPresence } from "@/lib/furr/api/presence";
import { errorMessage, useMe } from "@/lib/furr/client";
import { MAX_UPLOAD_BYTES } from "@/lib/furr/paths";
import type { ChatAttachment, ChatChannel, ChatMessage } from "@/lib/furr/types";
import { cn } from "@/lib/utils";
import { useDesktop } from "@/store/desktop";
import { AnySticker, AttachMenu, EmojiStickerPicker } from "./ChatPickers";
import { useSync } from "./useFurrSync";
import { Btn, Empty, ErrorText } from "./ui";

type Pending =
  | { type: "case"; path: string; caseId: string; platform: string }
  | { type: "file"; name: string; mimeType: string; base64: string; size: number };

type SendExtra = { stickerId?: string; casePath?: string; file?: { name: string; mimeType: string; base64: string } };

function readAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
    reader.readAsDataURL(file);
  });
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Case folder names end in a timestamp ("Name_2026-10-02T…") – show only the name. */
function caseTitle(caseId: string) {
  return caseId.replace(/_\d{4}-.*$/, "");
}

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s)+$/u;

export function ChatPanel() {
  const me = useMe();
  const queryClient = useQueryClient();
  const toggleChat = useDesktop((s) => s.toggleChat);
  const [channel, setChannel] = useState<ChatChannel>("team");
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [popup, setPopup] = useState<"emoji" | "attach" | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
  const blocked = channel === "private" && !partner;

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

  async function post(extra: SendExtra) {
    setError("");
    setSending(true);
    try {
      await sendChatMessage({ data: { channel, content: text.trim(), recipientId: partnerId ?? undefined, ...extra } });
      setText("");
      setPending(null);
      await queryClient.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  function send() {
    if (sending || blocked) return;
    if (pending?.type === "case") return void post({ casePath: pending.path });
    if (pending?.type === "file") {
      return void post({ file: { name: pending.name, mimeType: pending.mimeType, base64: pending.base64 } });
    }
    if (text.trim()) void post({});
  }

  function insertEmoji(emoji: string) {
    const el = inputRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + emoji + text.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }

  async function attachFile(file: File) {
    setError("");
    if (file.size > MAX_UPLOAD_BYTES) return setError("Die Datei ist zu groß (max. 3 MB).");
    try {
      setPending({
        type: "file",
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        base64: await readAsBase64(file),
        size: file.size,
      });
      inputRef.current?.focus();
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
                <MessageBody message={m} mine={mine} />
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      <div
        className="relative border-t border-border p-2"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f && !blocked) void attachFile(f);
        }}
      >
        <ErrorText>{error}</ErrorText>
        {popup && <div className="fixed inset-0 z-0" onClick={() => setPopup(null)} />}
        {popup === "emoji" && (
          <EmojiStickerPicker
            onEmoji={insertEmoji}
            onSticker={(stickerId) => {
              setPopup(null);
              void post({ stickerId });
            }}
          />
        )}
        {popup === "attach" && (
          <AttachMenu
            canUseEvidence={Boolean(me.data?.permissions.canUseEvidence)}
            onCase={(c) => setPending({ type: "case", ...c })}
            onFile={(f) => void attachFile(f)}
            onClose={() => setPopup(null)}
          />
        )}
        {pending && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-elevated/60 px-2.5 py-1.5">
            {pending.type === "case" ? (
              <FolderLock className="size-4 shrink-0 text-amber-300" />
            ) : (
              <FileText className="size-4 shrink-0 text-accent" />
            )}
            <span className="min-w-0 flex-1 truncate text-[12px]">
              {pending.type === "case" ? `Fallakte: ${caseTitle(pending.caseId)}` : `${pending.name} · ${formatSize(pending.size)}`}
            </span>
            <button type="button" aria-label="Anhang entfernen" onClick={() => setPending(null)} className="rounded p-0.5 text-muted hover:text-fg">
              <X className="size-3.5" />
            </button>
          </div>
        )}
        <div className="relative z-[1] flex items-end gap-1">
          <ToolButton label="Fallakte oder Datei anhängen" active={popup === "attach"} disabled={blocked} onClick={() => setPopup(popup === "attach" ? null : "attach")}>
            <Paperclip className="size-4" />
          </ToolButton>
          <ToolButton label="Emojis und Sticker" active={popup === "emoji"} disabled={blocked} onClick={() => setPopup(popup === "emoji" ? null : "emoji")}>
            <Smile className="size-4" />
          </ToolButton>
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            onPaste={(e) => {
              const f = e.clipboardData.files?.[0];
              if (f) {
                e.preventDefault();
                void attachFile(f);
              }
            }}
            rows={1}
            disabled={blocked}
            placeholder={
              pending
                ? "Text dazu (optional)…"
                : channel === "team"
                  ? "Nachricht an das Team…"
                  : partner
                    ? `Nachricht an ${partner.displayName}…`
                    : ""
            }
            className="max-h-24 min-h-9 min-w-0 flex-1 resize-none rounded-md border border-border bg-bg/60 px-3 py-2 text-[13px] outline-none focus:border-accent"
          />
          <Btn
            variant="primary"
            aria-label="Nachricht senden"
            className="h-9"
            disabled={sending || blocked || (!text.trim() && !pending)}
            onClick={send}
          >
            <Send className="size-4" />
          </Btn>
        </div>
      </div>
    </div>
  );
}

function ToolButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-md text-muted hover:bg-fg/8 hover:text-fg disabled:opacity-40",
        active && "bg-fg/10 text-fg",
      )}
    >
      {children}
    </button>
  );
}

function MessageBody({ message: m, mine }: { message: ChatMessage; mine: boolean }) {
  const a = m.attachment;
  const bubble = cn(
    "mt-0.5 max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-1.5 text-[13px]",
    mine ? "bg-accent text-accent-fg" : "bg-elevated",
  );
  if (a?.type === "sticker") {
    return (
      <div className="mt-1">
        <AnySticker stickerId={a.stickerId} />
      </div>
    );
  }
  // Just a few emojis: show them big, like in other messengers.
  if (!a && EMOJI_ONLY.test(m.content) && [...m.content.replace(/\s/g, "")].length <= 8) {
    return <p className="mt-0.5 text-[34px] leading-tight">{m.content}</p>;
  }
  const defaultText = a?.type === "case" ? `Fallakte: ${a.caseId}` : a?.type === "file" ? `Datei: ${a.name}` : null;
  const caption = m.content !== defaultText ? m.content : null;
  return (
    <>
      {a?.type === "case" && <CaseCard attachment={a} />}
      {a?.type === "file" && <FileCard attachment={a} />}
      {caption && <p className={bubble}>{caption}</p>}
    </>
  );
}

function CaseCard({ attachment: a }: { attachment: Extract<ChatAttachment, { type: "case" }> }) {
  const openApp = useDesktop((s) => s.openApp);
  return (
    <button
      type="button"
      onClick={() => openApp("explorer", { payload: { scope: "public", folder: a.path } })}
      className="mt-0.5 flex max-w-[85%] items-center gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-left hover:bg-amber-500/20"
      title="Fallakte in FurrFS öffnen"
    >
      <FolderLock className="size-5 shrink-0 text-amber-300" />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold">{caseTitle(a.caseId)}</span>
        <span className="block text-[11px] text-muted">Fallakte · {a.platform} · zum Öffnen klicken</span>
      </span>
    </button>
  );
}

function FileCard({ attachment: a }: { attachment: Extract<ChatAttachment, { type: "file" }> }) {
  const isImage = a.mimeType.startsWith("image/");
  const isVideo = a.mimeType.startsWith("video/");
  const file = useQuery({
    queryKey: ["furr", "chat", "file", a.id],
    queryFn: () => readChatAttachment({ data: a.id }),
    enabled: isImage || isVideo,
    staleTime: Infinity,
  });
  const dataUrl = file.data ? `data:${file.data.mimeType};base64,${file.data.base64}` : null;

  async function download() {
    const f = file.data ?? (await readChatAttachment({ data: a.id }));
    const bytes = Uint8Array.from(atob(f.base64), (ch) => ch.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: f.mimeType }));
    const link = document.createElement("a");
    link.href = url;
    link.download = f.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  if (dataUrl && isImage) {
    return (
      <button type="button" onClick={() => void download()} title={`${a.name} – zum Speichern klicken`} className="mt-0.5 max-w-[85%]">
        <img src={dataUrl} alt={a.name} className="max-h-60 rounded-lg object-contain" />
      </button>
    );
  }
  if (dataUrl && isVideo) return <video src={dataUrl} controls className="mt-0.5 max-h-60 max-w-[85%] rounded-lg" />;
  return (
    <div className="mt-0.5 flex max-w-[85%] items-center gap-2.5 rounded-lg border border-border bg-elevated px-3 py-2">
      <FileText className="size-5 shrink-0 text-accent" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{a.name}</span>
        <span className="block text-[11px] text-muted">{file.isLoading ? "Lade…" : formatSize(a.size)}</span>
      </span>
      <button type="button" onClick={() => void download()} className="rounded p-1.5 text-muted hover:bg-fg/10 hover:text-fg" aria-label="Herunterladen">
        <Download className="size-4" />
      </button>
    </div>
  );
}
