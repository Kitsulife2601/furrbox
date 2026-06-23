"use client";

import { Activity, Bot, FileText, Radar, Server, ShieldCheck, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FurrWindow } from "@/components/FurrWindow";
import { listPresenceLogs, listPresenceUsers, type PresenceLog, type PresenceUser } from "@/lib/presence";
import { useFurrBoxStore } from "@/store/furrbox-store";
import type { FurrWindowState } from "@/store/useWindowStore";

type PresenceTab = "team" | "global";

const teamRoles = new Set(["Dev", "Owner", "Mod", "Supporter"]);

function displayName(user: PresenceUser) {
  return user.nickname || user.discordUsername || user.displayName || user.username;
}

function cleanRoleName(user: PresenceUser) {
  const role = user.roleName.toLowerCase();
  if (role.includes("dev")) return "Dev";
  if (role.includes("owner")) return "Owner";
  if (role.includes("moderator") || role.includes("mod")) return "Mod";
  if (role.includes("supporter")) return "Supporter";
  return "Member";
}

function formatLastSeen(value: string | null | undefined) {
  if (!value) return "Nie verbunden";
  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60_000));
  if (minutes < 1) return "Gerade eben";
  if (minutes < 60) return `Vor ${minutes} Min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Vor ${hours} Std`;
  return new Date(value).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}

function sortPresence(users: PresenceUser[]) {
  return [...users].sort((a, b) => {
    if (a.status !== b.status) return a.status === "online" ? -1 : 1;
    return displayName(a).localeCompare(displayName(b), "de");
  });
}

function StatusBadge({ online, onlineLabel = "Online", offlineLabel = "Offline" }: { online: boolean; onlineLabel?: string; offlineLabel?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${online ? "animate-pulse border-cyan-300/45 bg-cyan-300/10 text-[#00f0ff] shadow-[0_0_14px_rgba(0,240,255,0.28)]" : "border-slate-700 bg-slate-800/50 text-slate-500"}`}>
      {online ? `● ${onlineLabel}` : offlineLabel}
    </span>
  );
}

export function FurrPresence({ windowState }: { windowState: FurrWindowState }) {
  const { token, socket, connected, discordBotStatus } = useFurrBoxStore();
  const [activeTab, setActiveTab] = useState<PresenceTab>("team");
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [selected, setSelected] = useState<PresenceUser | null>(null);
  const [logs, setLogs] = useState<PresenceLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teamUsers = useMemo(() => sortPresence(users.filter((user) => teamRoles.has(cleanRoleName(user)))), [users]);
  const globalUsers = useMemo(() => sortPresence(users), [users]);
  const visibleUsers = activeTab === "team" ? teamUsers : globalUsers;
  const onlineCount = users.filter((user) => user.status === "online").length;
  const teamOnlineCount = teamUsers.filter((user) => user.status === "online").length;

  useEffect(() => {
    if (!token) return;
    listPresenceUsers(token)
      .then((nextUsers) => {
        setUsers(nextUsers);
        const ordered = sortPresence(nextUsers);
        const initialTeam = ordered.find((user) => teamRoles.has(cleanRoleName(user)));
        setSelected((current) => current ?? initialTeam ?? ordered[0] ?? null);
      })
      .catch((nextError: Error) => setError(nextError.message));
  }, [token]);

  useEffect(() => {
    if (!socket) return;
    const snapshotHandler = ({ users: nextUsers }: { users: PresenceUser[] }) => {
      setUsers(nextUsers);
      setSelected((current) => {
        if (!current) return sortPresence(nextUsers)[0] ?? null;
        return nextUsers.find((user) => user.id === current.id) ?? current;
      });
    };
    const updateHandler = (updated: PresenceUser) => {
      setUsers((current) => {
        const without = current.filter((user) => user.id !== updated.id);
        return sortPresence([updated, ...without]);
      });
      setSelected((current) => (current?.id === updated.id ? updated : current));
    };
    socket.emit("presence:subscribe");
    socket.on("presence:snapshot", snapshotHandler);
    socket.on("presence:update", updateHandler);
    return () => {
      socket.emit("presence:unsubscribe");
      socket.off("presence:snapshot", snapshotHandler);
      socket.off("presence:update", updateHandler);
    };
  }, [socket]);

  useEffect(() => {
    if (!token || !selected?.discordId) {
      setLogs([]);
      return;
    }
    setLoadingLogs(true);
    setError(null);
    listPresenceLogs(token, selected.discordId)
      .then(setLogs)
      .catch((nextError: Error) => setError(nextError.message))
      .finally(() => setLoadingLogs(false));
  }, [selected?.discordId, token]);

  function switchTab(tab: PresenceTab) {
    const nextUsers = tab === "team" ? teamUsers : globalUsers;
    setActiveTab(tab);
    setSelected((current) => (current && nextUsers.some((user) => user.id === current.id) ? current : nextUsers[0] ?? null));
  }

  const cards = [
    {
      label: "FurrBox Sync",
      value: connected ? "Online" : "Offline",
      detail: connected ? "WebSocket verbunden" : "Client reconnecting",
      online: connected,
      icon: Server
    },
    {
      label: "Discord Bot",
      value: discordBotStatus.connected ? "Online" : "Offline",
      detail: discordBotStatus.connected ? `Seit ${formatLastSeen(discordBotStatus.connectedAt)}` : `Zuletzt ${formatLastSeen(discordBotStatus.disconnectedAt)}`,
      online: discordBotStatus.connected,
      icon: Bot
    },
    {
      label: "Team Nodes",
      value: `${teamOnlineCount}/${teamUsers.length}`,
      detail: "Dev, Owner, Mod, Supporter",
      online: teamOnlineCount > 0,
      icon: ShieldCheck
    },
    {
      label: "Global Registry",
      value: `${onlineCount}/${globalUsers.length}`,
      detail: "Alle registrierten Nutzer",
      online: onlineCount > 0,
      icon: Users
    }
  ];

  return (
    <FurrWindow windowState={windowState} icon={<Radar size={15} />} minWidth={980} minHeight={620}>
      <div className="flex h-full min-h-0 flex-col bg-[#050711]/88 text-slate-100">
        <header className="border-b border-cyan-300/15 bg-slate-950/60 px-5 py-4 shadow-[0_0_28px_rgba(0,240,255,0.08)]">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-cyan-300/30 bg-cyan-400/10 text-[#00f0ff] shadow-[0_0_20px_rgba(0,240,255,0.28)]">
                <Activity size={19} />
                <span className="absolute -right-1 -top-1 h-3 w-3 animate-ping rounded-full bg-[#00f0ff]" />
                <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-[#00f0ff]" />
              </span>
              <div className="min-w-0">
                <h3 className="truncate text-[15px] font-black tracking-[0.18em] text-cyan-100">NETWORK MONITOR // LIVE NODES</h3>
                <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Admin Übersicht für FurrBox, Discord Bot und Team-Präsenz</p>
              </div>
            </div>
            <StatusBadge online={connected && discordBotStatus.connected} onlineLabel="System OK" offlineLabel="Teilweise offline" />
          </div>

          <div className="mt-4 grid grid-cols-4 gap-2">
            {cards.map((card) => {
              const Icon = card.icon;
              return (
                <div key={card.label} className={`min-w-0 rounded-xl border bg-slate-950/70 p-3 ${card.online ? "border-cyan-300/20 shadow-[0_0_18px_rgba(0,240,255,0.11)]" : "border-slate-800"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">{card.label}</span>
                    <Icon size={15} className={card.online ? "text-[#00f0ff]" : "text-slate-600"} />
                  </div>
                  <div className={card.online ? "mt-2 text-[20px] font-black text-[#00f0ff] drop-shadow-[0_0_9px_rgba(0,240,255,0.65)]" : "mt-2 text-[20px] font-black text-slate-500"}>{card.value}</div>
                  <div className="mt-1 truncate text-[11px] text-slate-500">{card.detail}</div>
                </div>
              );
            })}
          </div>
        </header>

        <div className="flex items-center gap-2 border-b border-purple-500/20 bg-slate-950/45 px-4 py-3">
          {[
            { id: "team" as const, label: "TEAM MATRIX", count: teamUsers.length, online: teamOnlineCount },
            { id: "global" as const, label: "GLOBAL REGISTRY", count: globalUsers.length, online: onlineCount }
          ].map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                className={`rounded-xl border px-4 py-2 text-left transition ${active ? "border-[#00f0ff]/55 bg-cyan-400/10 text-cyan-100 shadow-[0_0_18px_rgba(0,240,255,0.22)]" : "border-white/5 bg-slate-900/45 text-slate-500 hover:border-purple-500/30 hover:text-slate-200"}`}
                onClick={() => switchTab(tab.id)}
              >
                <span className="block text-[11px] font-black uppercase tracking-[0.18em]">{tab.label}</span>
                <span className="mt-1 block text-[10px] font-semibold text-slate-500">{tab.online}/{tab.count} online</span>
              </button>
            );
          })}
        </div>

        {error ? <div className="border-b border-pink-500/20 bg-pink-500/10 px-5 py-2 text-[12px] font-semibold text-pink-100">{error}</div> : null}

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(620px,1.55fr)_minmax(300px,0.9fr)] gap-0">
          <section className="min-h-0 min-w-0 border-r border-purple-500/15">
            <div className="scroll-soft h-full overflow-auto">
              <div className="min-w-[760px]">
                <div className="grid grid-cols-[1.45fr_0.65fr_0.8fr_1fr] border-b border-purple-500/20 bg-purple-500/5 px-4 py-3 text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">
                  <span>Name / Nickname</span>
                  <span>Rolle</span>
                  <span>Status</span>
                  <span>Discord ID</span>
                </div>

                {visibleUsers.map((user) => {
                  const isOnline = user.status === "online";
                  const active = selected?.id === user.id;
                  const role = cleanRoleName(user);
                  return (
                    <button
                      key={user.id}
                      className={`grid w-full grid-cols-[1.45fr_0.65fr_0.8fr_1fr] items-center gap-3 border-b border-white/5 px-4 py-3 text-left transition ${active ? "bg-[#ff007f]/12 shadow-[inset_3px_0_0_#ff007f]" : "hover:bg-cyan-500/5"}`}
                      onClick={() => setSelected(user)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-bold text-slate-100">{displayName(user)}</span>
                        <span className="mt-1 block truncate text-[11px] text-slate-500">{user.discordUsername ? `@${user.discordUsername}` : user.username}</span>
                      </span>
                      <span className={`inline-flex w-fit items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${role === "Member" ? "border-slate-600/35 bg-slate-700/10 text-slate-400" : "border-purple-500/35 bg-purple-500/10 text-purple-100"}`}>
                        <ShieldCheck size={11} />
                        {role}
                      </span>
                      <span>
                        <StatusBadge online={isOnline} />
                        {!isOnline ? <span className="mt-1 block text-[10px] text-slate-600">{formatLastSeen(user.lastSeenAt)}</span> : null}
                      </span>
                      <span className="truncate font-mono text-[11px] text-slate-500">{user.discordId || "Nicht verbunden"}</span>
                    </button>
                  );
                })}

                {!visibleUsers.length ? (
                  <div className="px-5 py-12 text-center text-[13px] text-slate-500">
                    {activeTab === "team" ? "Keine Team-Nutzer mit Dev, Owner, Mod oder Supporter Rolle gefunden." : "Noch keine registrierten Nutzer gefunden."}
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <aside className="flex min-h-0 min-w-0 flex-col bg-slate-950/45">
            <div className="border-b border-purple-500/20 p-4">
              <div className="flex items-center gap-2 text-[12px] font-black uppercase tracking-[0.16em] text-pink-100">
                <FileText size={15} className="text-[#ff007f]" />
                Moderation Logs
              </div>
              <p className="mt-2 truncate text-[12px] text-slate-500">{selected ? `${displayName(selected)} [${cleanRoleName(selected)}]` : "Wähle einen Nutzer aus der Liste."}</p>
              {selected ? (
                <div className="mt-3 grid gap-2 rounded-xl border border-white/5 bg-slate-900/35 p-3 text-[11px]">
                  <div className="flex items-center justify-between gap-3"><span className="text-slate-500">App Status</span><StatusBadge online={selected.status === "online"} /></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Discord Name</span><span className="truncate text-slate-300">{selected.discordUsername || "Nicht synchronisiert"}</span></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Discord Bot</span><StatusBadge online={discordBotStatus.connected} onlineLabel="Online" /></div>
                </div>
              ) : null}
            </div>

            <div className="scroll-soft min-h-0 flex-1 space-y-3 overflow-auto p-4">
              {loadingLogs ? <div className="rounded-xl border border-cyan-300/10 bg-cyan-300/5 p-4 text-[12px] text-cyan-100">Lade Reports...</div> : null}
              {!loadingLogs && logs.length === 0 ? <div className="rounded-xl border border-white/5 bg-slate-900/45 p-4 text-[12px] text-slate-500">Keine Text-Reports für diesen Nutzer gefunden.</div> : null}
              {logs.map((log) => (
                <article key={log.virtualPath} className="rounded-xl border border-purple-500/20 bg-slate-950/70 p-3 shadow-[0_0_20px_rgba(139,92,246,0.12)]">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h4 className="truncate text-[12px] font-black text-slate-100">{log.fileName}</h4>
                    <span className="shrink-0 text-[10px] text-slate-500">{new Date(log.updatedAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}</span>
                  </div>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-white/5 bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-slate-300">{log.content}</pre>
                </article>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </FurrWindow>
  );
}
