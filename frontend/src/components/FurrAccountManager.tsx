"use client";

import { FormEvent, useState } from "react";
import { ShieldPlus, UserPlus } from "lucide-react";
import { createAdminUser, type AccountRole } from "@/lib/presence";

const accountRoles: AccountRole[] = ["Member", "Supporter", "Fish Moderator", "Fish Nagie Owner"];

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
  const [status, setStatus] = useState<{ type: "idle" | "saving" | "success" | "error"; message: string }>({ type: "idle", message: "" });

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
      await onCreated();
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Account konnte nicht erstellt werden." });
    }
  }

  return (
    <form onSubmit={submit} className="border-b border-pink-500/20 bg-slate-950/55 p-4">
      <div className="mb-3 flex items-center gap-2 text-[12px] font-black uppercase tracking-[0.16em] text-cyan-100">
        <ShieldPlus size={15} className="text-[#00f0ff]" />
        FurrAccountManager
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
          Account in Datenbank erstellen
        </button>
        {status.type !== "idle" ? (
          <div className={`rounded-xl border px-3 py-2 text-[11px] font-semibold ${status.type === "success" ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100" : status.type === "error" ? "border-pink-300/20 bg-pink-400/10 text-pink-100" : "border-cyan-300/20 bg-cyan-400/10 text-cyan-100"}`}>
            {status.message}
          </div>
        ) : null}
      </div>
    </form>
  );
}
