"use client";

import { Activity, FileText, Radar, ShieldCheck, Wifi, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FurrWindow } from "@/components/FurrWindow";
import { listPresenceLogs, listPresenceUsers, type PresenceLog, type PresenceUser } from "@/lib/presence";
import { useFurrBoxStore } from "@/store/furrbox-store";
import type { FurrWindowState } from "@/store/useWindowStore";

function displayName(user: PresenceUser) {
  return user.nickname || user.discordUsername || user.displayName || user.username;
}

function formatLastSeen(value: string | null) {
  if (!value) return "Noch keine Sitzung";
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

export function FurrPresence({ windowState }: { windowState: FurrWindowState }) {
  const { token, socket } = useFurrBoxStore();
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [selected, setSelected] = useState<PresenceUser | null>(null);
  const [logs, setLogs] = useState<PresenceLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const orderedUsers = useMemo(() => sortPresence(users), [users]);
  const onlineCount = users.filter((user) => user.status === "online").length;

  useEffect(() => {
    if (!token) return;
    listPresenceUsers(token)
      .then((nextUsers) => {
        setUsers(nextUsers);
        setSelected((current) => current ?? nextUsers[0] ?? null);
      })
      .catch((nextError: Error) => setError(nextError.message));
  }, [token]);

  useEffect(() => {
    if (!socket) return;
    const snapshotHandler = ({ users: nextUsers }: { users: PresenceUser[] }) => {
      setUsers(nextUsers);
      setSelected((current) => {
        if (!current) return nextUsers[0] ?? null;
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

  return (
    <FurrWindow windowState={windowState} icon={<Radar size={15} />}>
      <div className="flex h-full min-h-0 flex-col bg-[#050711]/88 text-slate-100">
        <header className="border-b border-cyan-300/15 bg-slate-950/60 px-5 py-4 shadow-[0_0_28px_rgba(0,240,255,0.08)]">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3">
                <span className="relative grid h-9 w-9 place-items-center rounded-xl border border-cyan-300/30 bg-cyan-400/10 text-[#00f0ff] shadow-[0_0_20px_rgba(0,240,255,0.28)]">
                  <Activity size={18} />
                  <span className="absolute -right-1 -top-1 h-3 w-3 animate-ping rounded-full bg-[#00f0ff]" />
                  <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-[#00f0ff]" />
                </span>
                <div>
                  <h3 className="text-[15px] font-black tracking-[0.18em] text-cyan-100">NETWORK MONITOR // LIVE NODES</h3>
                  <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">FurrPresence Admin Edition</p>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-purple-500/25 bg-slate-950/70 px-4 py-2 text-right shadow-[0_0_18px_rgba(139,92,246,0.18)]">
              <div className="text-[22px] font-black text-[#00f0ff] drop-shadow-[0_0_9px_rgba(0,240,255,0.65)]">{onlineCount}</div>
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Online Nodes</div>
            </div>
          </div>
        </header>

        {error ? <div className="border-b border-pink-500/20 bg-pink-500/10 px-5 py-2 text-[12px] font-semibold text-pink-100">{error}</div> : null}

        <div className="grid min-h-0 flex-1 grid-cols-[1.45fr_0.95fr] gap-0">
          <section className="min-h-0 border-r border-purple-500/15">
            <div className="grid grid-cols-[1.1fr_1.3fr_1fr] border-b border-purple-500/20 bg-purple-500/5 px-4 py-3 text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">
              <span>Discord ID</span>
              <span>Nutzername & Rolle</span>
              <span>Status</span>
            </div>
            <div className="scroll-soft h-full overflow-auto pb-12">
              {orderedUsers.map((user) => {
                const isOnline = user.status === "online";
                const active = selected?.id === user.id;
                return (
                  <button
                    key={user.id}
                    className={`grid w-full grid-cols-[1.1fr_1.3fr_1fr] items-center gap-3 border-b border-white/5 px-4 py-3 text-left transition ${active ? "bg-[#ff007f]/12 shadow-[inset_3px_0_0_#ff007f]" : "hover:bg-cyan-500/5"}`}
                    onClick={() => setSelected(user)}
                  >
                    <span className="font-mono text-[12px] text-cyan-100/85">{user.discordId || "Nicht verbunden"}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-bold text-slate-100">{displayName(user)}</span>
                      <span className="mt-1 inline-flex items-center gap-1 rounded-md border border-purple-500/25 bg-purple-500/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-purple-100">
                        <ShieldCheck size={11} />
                        {user.roleName}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      {isOnline ? <Wifi size={16} className="text-[#00f0ff] drop-shadow-[0_0_9px_rgba(0,240,255,0.9)]" /> : <WifiOff size={16} className="text-slate-600" />}
                      <span>
                        <span className={`block text-[12px] font-black uppercase ${isOnline ? "animate-pulse text-[#00f0ff] drop-shadow-[0_0_8px_rgba(0,240,255,0.85)]" : "text-slate-500"}`}>
                          {isOnline ? "Online" : "Offline"}
                        </span>
                        <span className="text-[10px] text-slate-500">{isOnline ? "Heartbeat aktiv" : `Zuletzt online: ${formatLastSeen(user.lastSeenAt)}`}</span>
                      </span>
                    </span>
                  </button>
                );
              })}
              {!orderedUsers.length ? <div className="px-5 py-12 text-center text-[13px] text-slate-500">Noch keine registrierten Nutzer gefunden.</div> : null}
            </div>
          </section>

          <aside className="flex min-h-0 flex-col bg-slate-950/45">
            <div className="border-b border-purple-500/20 p-4">
              <div className="flex items-center gap-2 text-[12px] font-black uppercase tracking-[0.16em] text-pink-100">
                <FileText size={15} className="text-[#ff007f]" />
                Moderation Logs
              </div>
              <p className="mt-2 text-[12px] text-slate-500">{selected ? displayName(selected) : "Wähle einen Nutzer aus der Liste."}</p>
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
