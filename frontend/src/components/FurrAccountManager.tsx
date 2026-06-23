"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, ShieldCheck, ShieldPlus, Trash2, UserPlus, Users } from "lucide-react";
import { createAdminUser, deleteAdminUser, listPresenceUsers, type AccountRole, type PresenceUser } from "@/lib/presence";

const accountRoles: AccountRole[] = ["Member", "Supporter", "Fish Moderator", "Fish Nagie Owner"];
const developerDiscordId = "1312104318006071328";

function isLocalAccount(user: PresenceUser) {
  return !user.id.startsWith("discord:");
}

function displayName(user: PresenceUser) {
  return user.nickname || user.discordUsername || user.displayName || user.username;
}

function displayRole(user: PresenceUser) {
  if (user.discordId === developerDiscordId) return "Entwickler";
  const role = user.roleName.toLowerCase();
  if (role.includes("owner")) return "Owner";
  if (role.includes("moderator") || role.includes("mod")) return "Mod";
  if (role.includes("supporter")) return "Supporter";
  return "Member";
}

function isOnline(user: PresenceUser) {
  return user.isExeOnline || user.isDiscordOnline || user.status === "online";
}

export function FurrAccountManager({
  token,
  onCreated
}: {
  token: string;
  onCreated: () => Promise<void> | void;
}) {
  const [username, setUsername] = useState("");
  const [discordId, setDiscordId] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AccountRole>("Member");
  const [accounts, setAccounts] = useState<PresenceUser[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ type: "idle" | "saving" | "success" | "error"; message: string }>({ type: "idle", message: "" });

  const sortedAccounts = useMemo(
    () => [...accounts].sort((a, b) => displayName(a).localeCompare(displayName(b), "de")),
    [accounts]
  );

  const refreshAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      const users = await listPresenceUsers(token, "global");
      setAccounts(users.filter(isLocalAccount));
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Accounts konnten nicht geladen werden." });
    } finally {
      setLoadingAccounts(false);
    }
  }, [token]);

  useEffect(() => {
    refreshAccounts();
  }, [refreshAccounts]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const cleanUsername = username.trim();
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(cleanUsername)) {
      setStatus({ type: "error", message: "Wunschnutzername muss 3-32 Zeichen lang sein." });
      return;
    }
    if (!/^\d{17,22}$/.test(discordId)) {
      setStatus({ type: "error", message: "Discord-ID muss eine numerische Snowflake sein." });
      return;
    }
    if (password.length < 8) {
      setStatus({ type: "error", message: "Passwort muss mindestens 8 Zeichen lang sein." });
      return;
    }

    setStatus({ type: "saving", message: "Account wird in die lokale Datenbank geschrieben..." });
    try {
      await createAdminUser(token, { username: cleanUsername, discordId, password, role });
      setUsername("");
      setDiscordId("");
      setPassword("");
      setRole("Member");
      setStatus({ type: "success", message: "Account wurde erstellt und live synchronisiert." });
      await refreshAccounts();
      await onCreated();
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Account konnte nicht erstellt werden." });
    }
  }

  async function removeAccount(account: PresenceUser) {
    if (account.discordId === developerDiscordId) {
      setStatus({ type: "error", message: "Der primaere Entwickler-Account kann nicht geloescht werden." });
      return;
    }
    if (!window.confirm(`Account "${displayName(account)}" wirklich vollstaendig loeschen?`)) return;
    setDeletingUserId(account.id);
    setStatus({ type: "saving", message: "Account wird geloescht..." });
    try {
      await deleteAdminUser(token, account.id);
      setStatus({ type: "success", message: "Account wurde geloescht und live synchronisiert." });
      await refreshAccounts();
      await onCreated();
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Account konnte nicht geloescht werden." });
    } finally {
      setDeletingUserId(null);
    }
  }

  return (
    <div className="grid min-h-full grid-cols-[minmax(300px,0.95fr)_minmax(360px,1.15fr)] gap-0 bg-slate-950/55">
      <form onSubmit={submit} className="border-r border-pink-500/20 p-4">
        <div className="mb-3 flex items-center gap-2 text-[12px] font-black uppercase tracking-[0.16em] text-cyan-100">
          <ShieldPlus size={15} className="text-[#00f0ff]" />
          Account erstellen
        </div>
        <div className="grid gap-3">
          <label className="block">
            <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Wunschnutzername</span>
            <input
              className="h-10 w-full rounded-xl border border-cyan-300/15 bg-black/40 px-3 text-[12px] text-cyan-100 outline-none focus:border-cyan-300 focus:shadow-[0_0_16px_rgba(0,240,255,0.24)]"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="NeuerNutzer"
              autoComplete="off"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Discord-ID</span>
            <input
              className="h-10 w-full rounded-xl border border-cyan-300/15 bg-black/40 px-3 font-mono text-[12px] text-cyan-100 outline-none focus:border-cyan-300 focus:shadow-[0_0_16px_rgba(0,240,255,0.24)]"
              inputMode="numeric"
              maxLength={22}
              value={discordId}
              onChange={(event) => setDiscordId(event.target.value.replace(/\D/g, "").slice(0, 22))}
              placeholder="1312104318006071328"
              autoComplete="off"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Passwort</span>
            <input
              className="h-10 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-[12px] text-slate-100 outline-none focus:border-pink-400 focus:shadow-[0_0_16px_rgba(255,0,127,0.22)]"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Mindestens 8 Zeichen"
              autoComplete="new-password"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Rolle</span>
            <select
              className="h-10 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-[12px] font-semibold text-slate-100 outline-none focus:border-violet-300"
              value={role}
              onChange={(event) => setRole(event.target.value as AccountRole)}
            >
              {accountRoles.map((entry) => (
                <option key={entry} value={entry}>{entry}</option>
              ))}
            </select>
          </label>
          <button
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#ff007f] via-[#8b5cf6] to-[#00f0ff] text-[12px] font-black uppercase tracking-[0.12em] text-white shadow-[0_0_24px_rgba(255,0,127,0.35)] transition hover:shadow-[0_0_34px_rgba(0,240,255,0.42)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={status.type === "saving"}
          >
            <UserPlus size={15} />
            Account erstellen
          </button>
          {status.type !== "idle" ? (
            <div className={`rounded-xl border px-3 py-2 text-[11px] font-semibold ${status.type === "success" ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100" : status.type === "error" ? "border-pink-300/20 bg-pink-400/10 text-pink-100" : "border-cyan-300/20 bg-cyan-400/10 text-cyan-100"}`}>
              {status.message}
            </div>
          ) : null}
        </div>
      </form>

      <section className="flex min-h-0 flex-col p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-[12px] font-black uppercase tracking-[0.16em] text-pink-100">
            <Users size={15} className="text-[#ff007f]" />
            Hinzugefuegte Accounts
          </div>
          <button
            className="grid h-8 w-8 place-items-center rounded-lg border border-cyan-300/25 bg-cyan-400/10 text-[#00f0ff] hover:bg-cyan-400/20 disabled:opacity-45"
            disabled={loadingAccounts}
            onClick={refreshAccounts}
            type="button"
            aria-label="Accounts aktualisieren"
          >
            <RefreshCw size={14} className={loadingAccounts ? "animate-spin" : ""} />
          </button>
        </div>

        <div className="scroll-soft min-h-0 flex-1 space-y-2 overflow-auto pr-1">
          {sortedAccounts.length === 0 ? (
            <div className="rounded-xl border border-white/5 bg-slate-900/40 p-4 text-[12px] text-slate-500">Noch keine lokalen Accounts gefunden.</div>
          ) : (
            sortedAccounts.map((account) => {
              const protectedAccount = account.discordId === developerDiscordId;
              return (
                <article key={account.id} className="rounded-xl border border-white/5 bg-slate-900/45 p-3 shadow-[0_0_18px_rgba(139,92,246,0.08)]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="truncate text-[13px] font-bold text-slate-100">{displayName(account)}</h4>
                      <p className="mt-1 truncate font-mono text-[10px] text-slate-500">{account.discordId || "Nicht verbunden"}</p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] ${isOnline(account) ? "border-cyan-300/35 bg-cyan-300/10 text-[#00f0ff]" : "border-slate-700 bg-slate-800/50 text-slate-500"}`}>
                      {isOnline(account) ? "online" : "offline"}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-1 rounded-md border border-purple-500/30 bg-purple-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-purple-100">
                      <ShieldCheck size={11} />
                      {displayRole(account)}
                    </span>
                    <button
                      className="inline-flex h-8 items-center gap-2 rounded-lg border border-pink-400/25 bg-pink-500/10 px-3 text-[10px] font-black uppercase tracking-[0.12em] text-[#ff007f] shadow-[0_0_12px_rgba(255,0,127,0.16)] transition hover:bg-pink-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={protectedAccount || deletingUserId === account.id}
                      onClick={() => removeAccount(account)}
                      type="button"
                      title={protectedAccount ? "Primaerer Entwickler kann nicht geloescht werden" : "Account loeschen"}
                    >
                      <Trash2 size={13} />
                      Loeschen
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
