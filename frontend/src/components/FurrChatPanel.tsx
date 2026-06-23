"use client";

import { MessageCircle, Send, Settings2, Shield, Users, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getChatSettings, listChatMessages, sendChatMessage, updateChatSettings, type ChatChannel, type ChatMessage } from "@/lib/chat";
import { listPresenceUsers, type PresenceUser } from "@/lib/presence";
import { useFurrBoxStore } from "@/store/furrbox-store";

const developerDiscordId = "1312104318006071328";

function isDeveloperSession(user: { discordId?: string | null; sessionRole?: string; username?: string; displayName?: string } | null) {
  return Boolean(user && (user.discordId === developerDiscordId || user.sessionRole === "Super_Admin" || user.username === "Kitsulife" || user.displayName === "Kitsulife"));
}

function displayUser(user: PresenceUser) {
  return user.nickname || user.discordUsername || user.displayName || user.username;
}

function userTag(user: PresenceUser) {
  return `@${(user.username || user.discordUsername || displayUser(user)).replace(/\s+/g, "_")}`;
}

function cleanRoleName(roleName: string) {
  const role = roleName.toLowerCase();
  if (role.includes("dev")) return "Entwickler";
  if (role.includes("owner")) return "Owner";
  if (role.includes("moderator")) return "Moderator";
  if (role.includes("supporter")) return "Supporter";
  return "Member";
}

function roleBadgeClass(roleName: string) {
  const role = roleName.toLowerCase();
  if (role.includes("dev")) return "border-pink-400/50 bg-pink-500/15 text-pink-100 shadow-[0_0_12px_rgba(255,0,127,0.26)]";
  if (role.includes("owner")) return "border-amber-300/50 bg-amber-400/15 text-amber-100 shadow-[0_0_12px_rgba(251,191,36,0.22)]";
  if (role.includes("moderator")) return "border-violet-400/50 bg-violet-500/15 text-violet-100 shadow-[0_0_12px_rgba(139,92,246,0.24)]";
  if (role.includes("supporter")) return "border-cyan-300/50 bg-cyan-500/15 text-cyan-100 shadow-[0_0_12px_rgba(0,240,255,0.22)]";
  return "border-slate-500/35 bg-slate-700/20 text-slate-300";
}

function sortUsers(users: PresenceUser[]) {
  return [...users].sort((a, b) => displayUser(a).localeCompare(displayUser(b), "de"));
}

export function FurrChatPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const token = useFurrBoxStore((state) => state.token);
  const socket = useFurrBoxStore((state) => state.socket);
  const user = useFurrBoxStore((state) => state.user);
  const [channel, setChannel] = useState<ChatChannel>("team");
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [partnerId, setPartnerId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [retentionDays, setRetentionDays] = useState(7);
  const [status, setStatus] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canConfigure = isDeveloperSession(user);

  const privateUsers = useMemo(
    () => sortUsers(users.filter((entry) => !entry.id.startsWith("discord:") && entry.id !== user?.id)),
    [user?.id, users]
  );
  const selectedPartner = privateUsers.find((entry) => entry.id === partnerId) || privateUsers[0] || null;
  const activePartnerId = selectedPartner?.id || "";
  const userRolesById = useMemo(
    () => Object.fromEntries(users.map((entry) => [entry.id, entry.roleName])),
    [users]
  );

  const refreshMessages = useCallback(async () => {
    if (!token) return;
    if (channel === "private" && !activePartnerId) {
      setMessages([]);
      return;
    }
    const nextMessages = await listChatMessages(token, channel, channel === "private" ? activePartnerId : undefined);
    setMessages(nextMessages);
  }, [activePartnerId, channel, token]);

  useEffect(() => {
    if (!open || !token) return;
    Promise.all([listPresenceUsers(token, "global"), getChatSettings(token)])
      .then(([nextUsers, settings]) => {
        setUsers(nextUsers);
        setRetentionDays(settings.retentionDays);
        if (!partnerId) {
          const first = nextUsers.find((entry) => !entry.id.startsWith("discord:") && entry.id !== user?.id);
          if (first) setPartnerId(first.id);
        }
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : "Chat konnte nicht geladen werden."));
  }, [open, partnerId, token, user?.id]);

  useEffect(() => {
    if (!open) return;
    refreshMessages().catch((error) => setStatus(error instanceof Error ? error.message : "Nachrichten konnten nicht geladen werden."));
  }, [open, refreshMessages]);

  useEffect(() => {
    if (!socket) return;
    const onMessage = (message: ChatMessage) => {
      setMessages((items) => {
        if (items.some((item) => item.id === message.id)) return items;
        const belongsToTeam = channel === "team" && message.channel === "team";
        const belongsToPrivate =
          channel === "private" &&
          message.channel === "private" &&
          activePartnerId &&
          ((message.senderId === user?.id && message.recipientId === activePartnerId) || (message.senderId === activePartnerId && message.recipientId === user?.id));
        return belongsToTeam || belongsToPrivate ? [...items, message] : items;
      });
    };
    const onSettings = (settings: { retentionDays?: number }) => {
      if (typeof settings.retentionDays === "number") setRetentionDays(settings.retentionDays);
    };
    const refreshUsers = () => {
      if (token) listPresenceUsers(token, "global").then(setUsers).catch(() => undefined);
    };
    socket.on("chat:message", onMessage);
    socket.on("chat:settings", onSettings);
    socket.on("presence:update", refreshUsers);
    socket.on("registryUpdate", refreshUsers);
    return () => {
      socket.off("chat:message", onMessage);
      socket.off("chat:settings", onSettings);
      socket.off("presence:update", refreshUsers);
      socket.off("registryUpdate", refreshUsers);
    };
  }, [activePartnerId, channel, socket, token, user?.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, open]);

  async function sendMessage() {
    if (!token || !draft.trim()) return;
    if (channel === "private" && !activePartnerId) {
      setStatus("Bitte waehle zuerst einen Nutzer fuer den Privatchat.");
      return;
    }
    const content = draft.trim();
    setDraft("");
    try {
      const sent = await sendChatMessage(token, { channel, content, recipientId: channel === "private" ? activePartnerId : undefined });
      setMessages((items) => (items.some((item) => item.id === sent.id) ? items : [...items, sent]));
      setStatus("");
    } catch (error) {
      setDraft(content);
      setStatus(error instanceof Error ? error.message : "Nachricht konnte nicht gesendet werden.");
    }
  }

  async function saveRetention() {
    if (!token || !canConfigure) return;
    try {
      const settings = await updateChatSettings(token, retentionDays);
      setRetentionDays(settings.retentionDays);
      setStatus(`Chat wird nach ${settings.retentionDays} Tag(en) automatisch geloescht.`);
      await refreshMessages();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Einstellung konnte nicht gespeichert werden.");
    }
  }

  if (!open) return null;

  return (
    <aside className="absolute bottom-24 right-[calc(50%-490px)] z-40 flex h-[560px] w-[430px] animate-task-pop flex-col overflow-hidden rounded-[22px] border border-cyan-300/25 bg-slate-950/86 text-slate-100 shadow-[0_0_45px_rgba(0,240,255,0.22),0_0_30px_rgba(139,92,246,0.24)] backdrop-blur-2xl">
      <header className="flex items-center justify-between border-b border-cyan-300/15 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-cyan-300/30 bg-cyan-400/10 text-[#00f0ff] shadow-[0_0_18px_rgba(0,240,255,0.28)]">
            <MessageCircle size={19} />
          </span>
          <div>
            <h3 className="text-[13px] font-black uppercase tracking-[0.16em] text-cyan-100">FurrChat</h3>
            <p className="text-[11px] text-slate-500">Teamchat und private Nachrichten</p>
          </div>
        </div>
        <button className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-pink-500/15 hover:text-pink-100" onClick={onClose} aria-label="Chat schliessen">
          <X size={15} />
        </button>
      </header>

      <div className="grid gap-2 border-b border-purple-500/20 bg-slate-950/55 p-3">
        <div className="grid grid-cols-2 gap-2">
          <button className={`h-9 rounded-xl border text-[12px] font-bold ${channel === "team" ? "border-cyan-300/45 bg-cyan-500/10 text-cyan-100" : "border-white/5 text-slate-400 hover:bg-white/5"}`} onClick={() => setChannel("team")}>
            <Users className="mr-1 inline" size={14} /> Team
          </button>
          <button className={`h-9 rounded-xl border text-[12px] font-bold ${channel === "private" ? "border-pink-400/45 bg-pink-500/10 text-pink-100" : "border-white/5 text-slate-400 hover:bg-white/5"}`} onClick={() => setChannel("private")}>
            <Shield className="mr-1 inline" size={14} /> Privat
          </button>
        </div>

        {channel === "private" ? (
          <div className="scroll-soft grid max-h-32 gap-1 overflow-auto rounded-xl border border-purple-500/25 bg-slate-950/70 p-1">
            {privateUsers.length ? privateUsers.map((entry) => {
              const active = activePartnerId === entry.id;
              return (
                <button
                  key={entry.id}
                  className={`grid gap-1 rounded-lg border px-3 py-2 text-left transition ${active ? "border-pink-400/45 bg-pink-500/12 shadow-[0_0_16px_rgba(255,0,127,0.18)]" : "border-white/5 bg-slate-900/35 hover:border-cyan-300/30 hover:bg-cyan-500/10"}`}
                  onClick={() => setPartnerId(entry.id)}
                >
                  <span className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate text-[12px] font-black text-slate-100">{displayUser(entry)}</span>
                    <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] ${roleBadgeClass(entry.roleName)}`}>
                      {cleanRoleName(entry.roleName)}
                    </span>
                  </span>
                  <span className="flex items-center justify-between gap-2 text-[10px]">
                    <span className="truncate text-slate-500">{userTag(entry)}</span>
                    <span className={entry.isExeOnline ? "font-bold text-cyan-200" : "text-slate-600"}>
                      {entry.isExeOnline ? "APP ONLINE" : "APP OFFLINE"}
                    </span>
                  </span>
                </button>
              );
            }) : <div className="rounded-lg border border-white/5 bg-slate-900/35 px-3 py-2 text-[11px] text-slate-500">Keine installierten App-Accounts gefunden.</div>}
          </div>
        ) : null}

        <div className="flex items-center gap-2 rounded-xl border border-white/5 bg-slate-900/45 px-3 py-2">
          <Settings2 size={14} className="text-[#00f0ff]" />
          <span className="min-w-0 flex-1 text-[11px] text-slate-400">Auto-Loeschung nach</span>
          <input
            className="h-7 w-16 rounded-lg border border-cyan-300/20 bg-black/35 px-2 text-center text-[12px] text-cyan-100 outline-none disabled:opacity-50"
            type="number"
            min={1}
            max={365}
            value={retentionDays}
            disabled={!canConfigure}
            onChange={(event) => setRetentionDays(Number(event.target.value))}
          />
          <span className="text-[11px] text-slate-500">Tagen</span>
          {canConfigure ? (
            <button className="h-7 rounded-lg border border-cyan-300/20 px-2 text-[10px] font-bold uppercase text-cyan-100 hover:bg-cyan-500/10" onClick={saveRetention}>
              OK
            </button>
          ) : null}
        </div>
      </div>

      <div ref={scrollRef} className="scroll-soft min-h-0 flex-1 space-y-2 overflow-auto p-3">
        {messages.length ? messages.map((message) => {
          const own = message.senderId === user?.id;
          const senderRoleName = message.senderRoleName || userRolesById[message.senderId] || "Member";
          return (
            <div key={message.id} className={`flex ${own ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[82%] rounded-2xl border px-3 py-2 ${own ? "border-cyan-300/25 bg-cyan-500/10" : "border-purple-500/25 bg-purple-500/10"}`}>
                <div className="mb-1 flex items-center justify-between gap-3 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate">{own ? "Du" : message.senderName}</span>
                    <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.08em] ${roleBadgeClass(senderRoleName)}`}>
                      {cleanRoleName(senderRoleName)}
                    </span>
                  </span>
                  <span>{new Date(message.createdAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                <p className="whitespace-pre-wrap break-words text-[12px] leading-5 text-slate-100">{message.content}</p>
              </div>
            </div>
          );
        }) : (
          <div className="grid h-full place-items-center rounded-xl border border-white/5 bg-slate-900/25 p-5 text-center text-[12px] text-slate-500">
            Noch keine Nachrichten in diesem Chat.
          </div>
        )}
      </div>

      {status ? <div className="border-t border-pink-500/20 bg-pink-500/10 px-4 py-2 text-[11px] text-pink-100">{status}</div> : null}

      <footer className="border-t border-cyan-300/15 p-3">
        <div className="flex gap-2">
          <textarea
            className="scroll-soft h-12 min-h-12 flex-1 resize-none rounded-xl border border-cyan-300/15 bg-black/35 px-3 py-2 text-[12px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-300/45"
            value={draft}
            maxLength={2000}
            placeholder={channel === "team" ? "Nachricht an alle Moderatoren..." : "Private Nachricht schreiben..."}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
              }
            }}
          />
          <button className="grid h-12 w-12 place-items-center rounded-xl border border-cyan-300/35 bg-cyan-500/10 text-[#00f0ff] shadow-[0_0_16px_rgba(0,240,255,0.2)] hover:bg-cyan-500/20 disabled:opacity-40" disabled={!draft.trim()} onClick={sendMessage} aria-label="Nachricht senden">
            <Send size={18} />
          </button>
        </div>
      </footer>
    </aside>
  );
}
