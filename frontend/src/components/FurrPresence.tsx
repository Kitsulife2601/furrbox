"use client";

import { Activity, Bot, FileText, Radar, Server, ShieldCheck, UserPlus, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FurrWindow } from "@/components/FurrWindow";
import { forceRegisterUser, listPresenceLogs, listPresenceUsers, type ForceRegisterPayload, type PresenceLog, type PresenceUser } from "@/lib/presence";
import { useFurrBoxStore } from "@/store/furrbox-store";
import type { FurrWindowState } from "@/store/useWindowStore";

type PresenceTab = "team" | "global";

const teamRoles = new Set(["Dev", "Owner", "Mod", "Supporter"]);
const developerDiscordId = "1312104318006071328";
const manualRoles: ForceRegisterPayload["role"][] = ["Dev", "Fish Nagie Owner", "Fish Moderator", "Supporter", "Member"];

function resolvedName(user: PresenceUser) {
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
    const aScore = (isAppOnline(a) ? 2 : 0) + (isDiscordOnline(a) ? 1 : 0);
    const bScore = (isAppOnline(b) ? 2 : 0) + (isDiscordOnline(b) ? 1 : 0);
    if (aScore !== bScore) return bScore - aScore;
    return resolvedName(a).localeCompare(resolvedName(b), "de");
  });
}

function isAppOnline(user: PresenceUser) {
  return user.isExeOnline ?? user.status === "online";
}

function isDiscordOnline(user: PresenceUser) {
  return user.isDiscordOnline ?? ["online", "idle", "dnd"].includes(user.discordStatus);
}

function StatusBadge({ online, onlineLabel = "ONLINE", offlineLabel = "OFFLINE" }: { online: boolean; onlineLabel?: string; offlineLabel?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${online ? "animate-pulse border-cyan-300/45 bg-cyan-300/10 text-[#00f0ff] shadow-[0_0_14px_rgba(0,240,255,0.28)]" : "border-slate-700 bg-slate-800/50 text-slate-500"}`}>
      {online ? <span aria-hidden="true">{"\u25CF"}</span> : null}
      {online ? onlineLabel : offlineLabel}
    </span>
  );
}

function SplitStatusBadge({ user }: { user: PresenceUser }) {
  const appOnline = isAppOnline(user);
  const dcOnline = isDiscordOnline(user);
  if (appOnline && dcOnline) {
    return <span className="inline-flex rounded-full border border-cyan-300/45 bg-cyan-300/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-[#00f0ff] shadow-[0_0_16px_rgba(0,240,255,0.34)]">🟢 APP | 🟢 DC</span>;
  }
  if (appOnline) {
    return <span className="inline-flex rounded-full border border-sky-300/45 bg-sky-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-sky-200 shadow-[0_0_16px_rgba(56,189,248,0.28)]">🟢 APP | ⚫ DC</span>;
  }
  if (dcOnline) {
    return <span className="inline-flex rounded-full border border-violet-300/45 bg-violet-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-violet-200 shadow-[0_0_16px_rgba(139,92,246,0.32)]">⚫ APP | 🟢 DC</span>;
  }
  return <span className="inline-flex rounded-full border border-slate-700 bg-slate-800/50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">⚫ INAKTIV</span>;
}

function LogText({ content }: { content: string }) {
  const lines = content.split(/\r?\n/);
  return (
    <div className="max-h-64 overflow-auto rounded-lg border border-white/5 bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
      {lines.map((line, index) => (
        <div key={`${index}-${line}`} className={line.startsWith("=") || line.startsWith("-") || line.startsWith("[") ? "text-cyan-100" : "text-slate-300"}>
          {line || "\u00A0"}
        </div>
      ))}
    </div>
  );
}

export function FurrPresence({ windowState }: { windowState: FurrWindowState }) {
  const { token, user, socket, connected, discordBotStatus } = useFurrBoxStore();
  const [activeTab, setActiveTab] = useState<PresenceTab>("team");
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [selected, setSelected] = useState<PresenceUser | null>(null);
  const [logs, setLogs] = useState<PresenceLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualDiscordId, setManualDiscordId] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualRole, setManualRole] = useState<ForceRegisterPayload["role"]>("Member");
  const [manualStatus, setManualStatus] = useState<{ type: "idle" | "saving" | "success" | "error"; message: string }>({ type: "idle", message: "" });

  const isPrimaryDeveloper = user?.discordId === developerDiscordId;
  const teamUsers = useMemo(() => sortPresence(users.filter((user) => teamRoles.has(cleanRoleName(user)))), [users]);
  const globalUsers = useMemo(() => sortPresence(users), [users]);
  const visibleUsers = activeTab === "team" ? teamUsers : globalUsers;
  const onlineCount = users.filter((user) => isAppOnline(user) || isDiscordOnline(user)).length;
  const teamOnlineCount = teamUsers.filter((user) => isAppOnline(user) || isDiscordOnline(user)).length;

  useEffect(() => {
    if (!token) return;
    listPresenceUsers(token, "global")
      .then((nextUsers) => {
        setUsers(nextUsers);
        const ordered = sortPresence(nextUsers);
        const initialTeam = ordered.find((user) => teamRoles.has(cleanRoleName(user)));
        setSelected((current) => current ?? initialTeam ?? ordered[0] ?? null);
      })
      .catch((nextError: Error) => setError(nextError.message));
  }, [token]);

  useEffect(() => {
    if (!socket || !token) return;
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
    const refreshHandler = () => {
      listPresenceUsers(token, "global")
        .then((nextUsers) => {
          setUsers(nextUsers);
          setSelected((current) => {
            if (!current) return sortPresence(nextUsers)[0] ?? null;
            return nextUsers.find((user) => user.id === current.id) ?? current;
          });
        })
        .catch((nextError: Error) => setError(nextError.message));
    };
    socket.emit("presence:subscribe");
    socket.on("presence:snapshot", snapshotHandler);
    socket.on("presence:update", updateHandler);
    socket.on("discord:presence-refreshed", refreshHandler);
    socket.on("discord:members-refreshed", refreshHandler);
    return () => {
      socket.emit("presence:unsubscribe");
      socket.off("presence:snapshot", snapshotHandler);
      socket.off("presence:update", updateHandler);
      socket.off("discord:presence-refreshed", refreshHandler);
      socket.off("discord:members-refreshed", refreshHandler);
    };
  }, [socket, token]);

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

  async function submitManualUser() {
    if (!token || !isPrimaryDeveloper) return;
    if (!/^\d{17,22}$/.test(manualDiscordId)) {
      setManualStatus({ type: "error", message: "Discord-ID muss eine gültige Snowflake sein." });
      return;
    }
    if (manualName.trim().length < 2) {
      setManualStatus({ type: "error", message: "Bitte Nutzername / Nickname eintragen." });
      return;
    }
    setManualStatus({ type: "saving", message: "Nutzer wird direkt in die Datenbank geschrieben..." });
    try {
      await forceRegisterUser(token, { discordId: manualDiscordId, displayName: manualName.trim(), role: manualRole });
      const nextUsers = await listPresenceUsers(token, "global");
      setUsers(nextUsers);
      const injected = nextUsers.find((entry) => entry.discordId === manualDiscordId);
      setSelected(injected ?? selected);
      setManualDiscordId("");
      setManualName("");
      setManualRole("Member");
      setManualStatus({ type: "success", message: "Nutzer wurde manuell registriert und live synchronisiert." });
    } catch (nextError) {
      setManualStatus({ type: "error", message: nextError instanceof Error ? nextError.message : "Manuelle Registrierung fehlgeschlagen." });
    }
  }

  const cards = [
    { label: "FurrBox Sync", value: connected ? "Online" : "Offline", detail: connected ? "WebSocket verbunden" : "Client reconnecting", online: connected, icon: Server },
    { label: "Discord Bot", value: discordBotStatus.connected ? "Online" : "Offline", detail: discordBotStatus.connected ? `Seit ${formatLastSeen(discordBotStatus.connectedAt)}` : `Zuletzt ${formatLastSeen(discordBotStatus.disconnectedAt)}`, online: discordBotStatus.connected, icon: Bot },
    { label: "Team Nodes", value: `${teamOnlineCount}/${teamUsers.length}`, detail: "Dev, Owner, Mod, Supporter", online: teamOnlineCount > 0, icon: ShieldCheck },
    { label: "Global Registry", value: `${onlineCount}/${globalUsers.length}`, detail: "Alle registrierten Nutzer", online: onlineCount > 0, icon: Users }
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
            <StatusBadge online={connected && discordBotStatus.connected} onlineLabel="SYSTEM OK" offlineLabel="TEILWEISE OFFLINE" />
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
                <div className="grid grid-cols-[1.35fr_0.62fr_0.95fr_1fr] border-b border-purple-500/20 bg-purple-500/5 px-4 py-3 text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">
                  <span>Name / Nickname</span>
                  <span>Rolle</span>
                  <span>Status</span>
                  <span>Discord ID</span>
                </div>

                {visibleUsers.map((user) => {
                  const appOnline = isAppOnline(user);
                  const active = selected?.id === user.id;
                  const role = cleanRoleName(user);
                  return (
                    <button
                      key={user.id}
                      className={`grid w-full grid-cols-[1.35fr_0.62fr_0.95fr_1fr] items-center gap-3 border-b border-white/5 px-4 py-3 text-left transition ${active ? "bg-[#ff007f]/12 shadow-[inset_3px_0_0_#ff007f]" : "hover:bg-cyan-500/5"}`}
                      onClick={() => setSelected(user)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-bold text-slate-100">{resolvedName(user)}</span>
                        <span className="mt-1 block truncate text-[11px] text-slate-500">{user.discordUsername ? `@${user.discordUsername}` : user.username}</span>
                      </span>
                      <span className={`inline-flex w-fit items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${role === "Member" ? "border-slate-600/35 bg-slate-700/10 text-slate-400" : "border-purple-500/35 bg-purple-500/10 text-purple-100"}`}>
                        <ShieldCheck size={11} />
                        {role}
                      </span>
                      <span>
                        <SplitStatusBadge user={user} />
                        {!appOnline ? <span className="mt-1 block text-[10px] text-slate-600">{formatLastSeen(user.lastSeenAt)}</span> : null}
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
              <p className="mt-2 truncate text-[12px] text-slate-500">{selected ? `${resolvedName(selected)} [${cleanRoleName(selected)}]` : "Wähle einen Nutzer aus der Liste."}</p>
              {selected ? (
                <div className="mt-3 grid gap-2 rounded-xl border border-white/5 bg-slate-900/35 p-3 text-[11px]">
                  <div className="flex items-center justify-between gap-3"><span className="text-slate-500">App Status</span><StatusBadge online={isAppOnline(selected)} /></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Discord Bot Status</span><StatusBadge online={isDiscordOnline(selected)} /></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Discord Name</span><span className="truncate text-slate-300">{selected.discordUsername || "Nicht synchronisiert"}</span></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Bot Bridge</span><StatusBadge online={discordBotStatus.connected} /></div>
                </div>
              ) : null}
            </div>

            {isPrimaryDeveloper ? (
              <div className="border-b border-pink-500/20 bg-slate-950/55 p-4">
                <div className="mb-3 flex items-center gap-2 text-[12px] font-black uppercase tracking-[0.16em] text-cyan-100">
                  <UserPlus size={15} className="text-[#00f0ff]" />
                  Manuelles Mitglieder-Management
                </div>
                <div className="grid gap-3">
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Discord-ID eingeben</span>
                    <input
                      className="h-10 w-full rounded-xl border border-cyan-300/15 bg-black/40 px-3 font-mono text-[12px] text-cyan-100 outline-none focus:border-cyan-300 focus:shadow-[0_0_16px_rgba(0,240,255,0.24)]"
                      inputMode="numeric"
                      value={manualDiscordId}
                      onChange={(event) => setManualDiscordId(event.target.value.replace(/\D/g, ""))}
                      placeholder="1312104318006071328"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Nutzername / Nickname</span>
                    <input
                      className="h-10 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-[12px] text-slate-100 outline-none focus:border-pink-400 focus:shadow-[0_0_16px_rgba(255,0,127,0.22)]"
                      value={manualName}
                      onChange={(event) => setManualName(event.target.value)}
                      placeholder="Display Name"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Rolle zuweisen</span>
                    <select
                      className="h-10 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-[12px] font-semibold text-slate-100 outline-none focus:border-violet-300"
                      value={manualRole}
                      onChange={(event) => setManualRole(event.target.value as ForceRegisterPayload["role"])}
                    >
                      {manualRoles.map((role) => (
                        <option key={role} value={role}>{role}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="h-11 rounded-xl bg-gradient-to-r from-[#ff007f] via-[#8b5cf6] to-[#00f0ff] text-[12px] font-black uppercase tracking-[0.12em] text-white shadow-[0_0_24px_rgba(255,0,127,0.35)] transition hover:shadow-[0_0_34px_rgba(0,240,255,0.42)] disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={manualStatus.type === "saving"}
                    onClick={submitManualUser}
                  >
                    Nutzer manuell in DB eintragen
                  </button>
                  {manualStatus.type !== "idle" ? (
                    <div className={`rounded-xl border px-3 py-2 text-[11px] font-semibold ${manualStatus.type === "success" ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100" : manualStatus.type === "error" ? "border-pink-300/20 bg-pink-400/10 text-pink-100" : "border-cyan-300/20 bg-cyan-400/10 text-cyan-100"}`}>
                      {manualStatus.message}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="scroll-soft min-h-0 flex-1 space-y-3 overflow-auto p-4">
              {loadingLogs ? <div className="rounded-xl border border-cyan-300/10 bg-cyan-300/5 p-4 text-[12px] text-cyan-100">Lade Reports...</div> : null}
              {!loadingLogs && logs.length === 0 ? <div className="rounded-xl border border-white/5 bg-slate-900/45 p-4 text-[12px] text-slate-500">Keine Text-Reports für diesen Nutzer gefunden.</div> : null}
              {logs.map((log) => (
                <article key={log.virtualPath} className="rounded-xl border border-purple-500/20 bg-slate-950/70 p-3 shadow-[0_0_20px_rgba(139,92,246,0.12)]">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h4 className="truncate text-[12px] font-black text-slate-100">{log.fileName}</h4>
                    <span className="shrink-0 text-[10px] text-slate-500">{new Date(log.updatedAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}</span>
                  </div>
                  <LogText content={log.content} />
                </article>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </FurrWindow>
  );
}
