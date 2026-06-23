"use client";

import { Activity, Bot, Check, FileText, Pencil, Radar, Server, ShieldCheck, Trash2, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FurrAccountManager } from "@/components/FurrAccountManager";
import { FurrWindow } from "@/components/FurrWindow";
import { deleteAdminUser, listPresenceLogs, listPresenceUsers, updateMemberDiscordId, type PresenceLog, type PresenceUser } from "@/lib/presence";
import { useFurrBoxStore } from "@/store/furrbox-store";
import type { FurrWindowState } from "@/store/useWindowStore";

type PresenceTab = "team" | "global";

const teamRoles = new Set(["Dev", "Owner", "Mod", "Supporter"]);
const developerDiscordId = "1312104318006071328";

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

function isAppOnline(user: PresenceUser) {
  return user.isExeOnline ?? user.status === "online";
}

function isDiscordOnline(user: PresenceUser) {
  return user.isDiscordOnline ?? ["online", "idle", "dnd"].includes(user.discordStatus);
}

function sortPresence(users: PresenceUser[]) {
  return [...users].sort((a, b) => {
    const aScore = (isAppOnline(a) ? 2 : 0) + (isDiscordOnline(a) ? 1 : 0);
    const bScore = (isAppOnline(b) ? 2 : 0) + (isDiscordOnline(b) ? 1 : 0);
    if (aScore !== bScore) return bScore - aScore;
    return resolvedName(a).localeCompare(resolvedName(b), "de");
  });
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
    return <span className="inline-flex rounded-full border border-cyan-300/45 bg-cyan-300/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-[#00f0ff] shadow-[0_0_16px_rgba(0,240,255,0.34)]">APP | DC</span>;
  }
  if (appOnline) {
    return <span className="inline-flex rounded-full border border-sky-300/45 bg-sky-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-sky-200 shadow-[0_0_16px_rgba(56,189,248,0.28)]">APP | DC OFF</span>;
  }
  if (dcOnline) {
    return <span className="inline-flex rounded-full border border-violet-300/45 bg-violet-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-violet-200 shadow-[0_0_16px_rgba(139,92,246,0.32)]">APP OFF | DC</span>;
  }
  return <span className="inline-flex rounded-full border border-slate-700 bg-slate-800/50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">INAKTIV</span>;
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

function DiscordIdCell({
  user,
  canEdit,
  editing,
  value,
  saving,
  onStart,
  onChange,
  onCancel,
  onSave
}: {
  user: PresenceUser;
  canEdit: boolean;
  editing: boolean;
  value: string;
  saving: boolean;
  onStart: () => void;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  if (editing) {
    return (
      <span className="flex min-w-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>
        <input
          autoFocus
          className="h-7 min-w-0 flex-1 rounded border border-[#00f0ff] bg-slate-950 px-2 py-0.5 font-mono text-xs text-slate-100 outline-none shadow-[0_0_12px_rgba(0,240,255,0.22)]"
          inputMode="numeric"
          maxLength={19}
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 19))}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSave();
            if (event.key === "Escape") onCancel();
          }}
        />
        <button
          className="grid h-7 w-7 shrink-0 place-items-center rounded border border-emerald-300/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20 disabled:opacity-40"
          disabled={saving || !/^\d{17,19}$/.test(value)}
          onClick={(event) => {
            event.stopPropagation();
            onSave();
          }}
          aria-label="Discord ID speichern"
        >
          <Check size={14} />
        </button>
      </span>
    );
  }

  if (!user.discordId && canEdit) {
    return (
      <button
        className="inline-flex min-w-0 items-center gap-2 rounded-lg border border-transparent px-2 py-1 text-left font-mono text-[11px] text-slate-500 transition hover:border-cyan-300/25 hover:bg-cyan-300/5 hover:text-cyan-100"
        onClick={(event) => {
          event.stopPropagation();
          onStart();
        }}
        aria-label="Discord ID bearbeiten"
      >
        <span className="truncate">Nicht verbunden</span>
        <Pencil size={13} className="shrink-0 text-[#ff007f] drop-shadow-[0_0_8px_rgba(255,0,127,0.65)]" />
      </button>
    );
  }

  return <span className="truncate font-mono text-[11px] text-slate-500">{user.discordId || "Nicht verbunden"}</span>;
}

export function FurrPresence({ windowState }: { windowState: FurrWindowState }) {
  const { token, user, socket, connected, discordBotStatus } = useFurrBoxStore();
  const [activeTab, setActiveTab] = useState<PresenceTab>("team");
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [teamRegistryUsers, setTeamRegistryUsers] = useState<PresenceUser[]>([]);
  const [selected, setSelected] = useState<PresenceUser | null>(null);
  const [logs, setLogs] = useState<PresenceLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingDiscordUserId, setEditingDiscordUserId] = useState<string | null>(null);
  const [editingDiscordValue, setEditingDiscordValue] = useState("");
  const [savingDiscordId, setSavingDiscordId] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  const isPrimaryDeveloper = user?.discordId === developerDiscordId;
  const teamUsers = useMemo(() => sortPresence(teamRegistryUsers.filter((entry) => teamRoles.has(cleanRoleName(entry)))), [teamRegistryUsers]);
  const globalUsers = useMemo(() => sortPresence(users), [users]);
  const visibleUsers = activeTab === "team" ? teamUsers : globalUsers;
  const onlineCount = globalUsers.filter((entry) => isAppOnline(entry) || isDiscordOnline(entry)).length;
  const teamOnlineCount = teamUsers.filter((entry) => isAppOnline(entry) || isDiscordOnline(entry)).length;
  const rowGrid = isPrimaryDeveloper && activeTab === "global" ? "grid-cols-[1.3fr_0.55fr_0.85fr_0.9fr_44px]" : "grid-cols-[1.35fr_0.62fr_0.95fr_1fr]";

  async function refreshRegistry() {
    if (!token) return;
    const [nextUsers, nextTeamUsers] = await Promise.all([
      listPresenceUsers(token, "global"),
      listPresenceUsers(token, "team")
    ]);
    const nextVisibleUsers = activeTab === "team" ? sortPresence(nextTeamUsers) : sortPresence(nextUsers);
    setUsers(nextUsers);
    setTeamRegistryUsers(nextTeamUsers);
    setSelected((current) => {
      if (!current) return nextVisibleUsers[0] ?? null;
      return nextVisibleUsers.find((entry) => entry.id === current.id) ?? nextVisibleUsers[0] ?? null;
    });
  }

  useEffect(() => {
    refreshRegistry().catch((nextError: Error) => setError(nextError.message));
  }, [token]);

  useEffect(() => {
    if (!socket || !token) return;
    const refreshHandler = () => {
      refreshRegistry().catch((nextError: Error) => setError(nextError.message));
    };
    socket.emit("presence:subscribe");
    socket.on("presence:snapshot", refreshHandler);
    socket.on("presence:update", refreshHandler);
    socket.on("discord:presence-refreshed", refreshHandler);
    socket.on("discord:members-refreshed", refreshHandler);
    socket.on("registryUpdate", refreshHandler);
    return () => {
      socket.emit("presence:unsubscribe");
      socket.off("presence:snapshot", refreshHandler);
      socket.off("presence:update", refreshHandler);
      socket.off("discord:presence-refreshed", refreshHandler);
      socket.off("discord:members-refreshed", refreshHandler);
      socket.off("registryUpdate", refreshHandler);
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
    setEditingDiscordUserId(null);
    setEditingDiscordValue("");
    setSelected((current) => (current && nextUsers.some((entry) => entry.id === current.id) ? current : nextUsers[0] ?? null));
  }

  function startDiscordIdEdit(target: PresenceUser) {
    if (!isPrimaryDeveloper || activeTab !== "global" || target.discordId) return;
    setEditingDiscordUserId(target.id);
    setEditingDiscordValue("");
    setError(null);
  }

  async function saveDiscordIdEdit(target: PresenceUser) {
    if (!token || !isPrimaryDeveloper || savingDiscordId) return;
    if (!/^\d{17,19}$/.test(editingDiscordValue)) {
      setError("Discord ID muss 17-19 Ziffern enthalten.");
      return;
    }
    setSavingDiscordId(true);
    setError(null);
    try {
      await updateMemberDiscordId(token, { targetUserId: target.id, discordId: editingDiscordValue });
      await refreshRegistry();
      setEditingDiscordUserId(null);
      setEditingDiscordValue("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Discord ID konnte nicht gespeichert werden.");
    } finally {
      setSavingDiscordId(false);
    }
  }

  async function deleteUser(target: PresenceUser) {
    if (!token || !isPrimaryDeveloper || deletingUserId) return;
    if (target.discordId === developerDiscordId) {
      setError("Der primaere Entwickler-Account kann nicht geloescht werden.");
      return;
    }
    if (!window.confirm(`Account "${resolvedName(target)}" wirklich vollstaendig loeschen?`)) return;
    setDeletingUserId(target.id);
    setError(null);
    try {
      await deleteAdminUser(token, target.id);
      await refreshRegistry();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Account konnte nicht geloescht werden.");
    } finally {
      setDeletingUserId(null);
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
                <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Admin Uebersicht fuer FurrBox, Discord Bot und Team-Praesenz</p>
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

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(680px,1.55fr)_minmax(300px,0.9fr)] gap-0">
          <section className="min-h-0 min-w-0 border-r border-purple-500/15">
            <div className="scroll-soft h-full overflow-auto">
              <div className="min-w-[840px]">
                <div className={`grid ${rowGrid} border-b border-purple-500/20 bg-purple-500/5 px-4 py-3 text-[11px] font-black uppercase tracking-[0.14em] text-slate-400`}>
                  <span>Name / Nickname</span>
                  <span>Rolle</span>
                  <span>Status</span>
                  <span>Discord ID</span>
                  {isPrimaryDeveloper && activeTab === "global" ? <span>Aktion</span> : null}
                </div>

                {visibleUsers.map((entry) => {
                  const appOnline = isAppOnline(entry);
                  const active = selected?.id === entry.id;
                  const role = cleanRoleName(entry);
                  return (
                    <div
                      key={entry.id}
                      className={`grid w-full ${rowGrid} items-center gap-3 border-b border-white/5 px-4 py-3 text-left transition ${active ? "bg-[#ff007f]/12 shadow-[inset_3px_0_0_#ff007f]" : "hover:bg-cyan-500/5"}`}
                      onClick={() => setSelected(entry)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") setSelected(entry);
                      }}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-bold text-slate-100">{resolvedName(entry)}</span>
                        <span className="mt-1 block truncate text-[11px] text-slate-500">{entry.discordUsername ? `@${entry.discordUsername}` : entry.username}</span>
                      </span>
                      <span className={`inline-flex w-fit items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${role === "Member" ? "border-slate-600/35 bg-slate-700/10 text-slate-400" : "border-purple-500/35 bg-purple-500/10 text-purple-100"}`}>
                        <ShieldCheck size={11} />
                        {role}
                      </span>
                      <span>
                        <SplitStatusBadge user={entry} />
                        {!appOnline ? <span className="mt-1 block text-[10px] text-slate-600">{formatLastSeen(entry.lastSeenAt)}</span> : null}
                      </span>
                      <DiscordIdCell
                        user={entry}
                        canEdit={isPrimaryDeveloper && activeTab === "global"}
                        editing={editingDiscordUserId === entry.id}
                        value={editingDiscordValue}
                        saving={savingDiscordId}
                        onStart={() => startDiscordIdEdit(entry)}
                        onChange={setEditingDiscordValue}
                        onCancel={() => {
                          setEditingDiscordUserId(null);
                          setEditingDiscordValue("");
                        }}
                        onSave={() => saveDiscordIdEdit(entry)}
                      />
                      {isPrimaryDeveloper && activeTab === "global" ? (
                        <button
                          className="grid h-8 w-8 place-items-center rounded-lg border border-pink-400/25 bg-pink-500/10 text-[#ff007f] shadow-[0_0_12px_rgba(255,0,127,0.22)] transition hover:bg-pink-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                          disabled={deletingUserId === entry.id || entry.discordId === developerDiscordId}
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteUser(entry);
                          }}
                          aria-label="Account loeschen"
                        >
                          <Trash2 size={14} />
                        </button>
                      ) : null}
                    </div>
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
              <p className="mt-2 truncate text-[12px] text-slate-500">{selected ? `${resolvedName(selected)} [${cleanRoleName(selected)}]` : "Waehle einen Nutzer aus der Liste."}</p>
              {selected ? (
                <div className="mt-3 grid gap-2 rounded-xl border border-white/5 bg-slate-900/35 p-3 text-[11px]">
                  <div className="flex items-center justify-between gap-3"><span className="text-slate-500">App Status</span><StatusBadge online={isAppOnline(selected)} /></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Discord Bot Status</span><StatusBadge online={isDiscordOnline(selected)} /></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Discord Name</span><span className="truncate text-slate-300">{selected.discordUsername || "Nicht synchronisiert"}</span></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Bot Bridge</span><StatusBadge online={discordBotStatus.connected} /></div>
                </div>
              ) : null}
            </div>

            {isPrimaryDeveloper && token ? <FurrAccountManager token={token} onCreated={refreshRegistry} /> : null}

            <div className="scroll-soft min-h-0 flex-1 space-y-3 overflow-auto p-4">
              {loadingLogs ? <div className="rounded-xl border border-cyan-300/10 bg-cyan-300/5 p-4 text-[12px] text-cyan-100">Lade Reports...</div> : null}
              {!loadingLogs && logs.length === 0 ? <div className="rounded-xl border border-white/5 bg-slate-900/45 p-4 text-[12px] text-slate-500">Keine Text-Reports fuer diesen Nutzer gefunden.</div> : null}
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
