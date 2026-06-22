"use client";

import { FormEvent, useState } from "react";
import { KeyRound, UserPlus } from "lucide-react";
import { login, register } from "@/lib/auth";
import { useFurrBoxStore } from "@/store/furrbox-store";

type Mode = "login" | "register";

export function LoginPanel() {
  const { setSession, setAuthStage } = useFurrBoxStore();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result =
        mode === "login"
          ? await login(username, password)
          : await register(username, displayName || username, password);
      setSession(result.token, result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="desktop-wallpaper relative grid h-screen w-screen place-items-center overflow-hidden">
      <div className="absolute inset-0 bg-black/10 backdrop-blur-[2px]" />
      <form onSubmit={submit} className="glass-strong relative w-[380px] rounded-[22px] p-7 text-center shadow-window">
        <button type="button" className="absolute left-4 top-4 text-[12px] font-medium text-slate-500 hover:text-slate-900" onClick={() => setAuthStage("lock")}>
          Lock
        </button>
        <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-500 text-white shadow-lg shadow-sky-500/30">
          {mode === "login" ? <KeyRound size={32} /> : <UserPlus size={32} />}
        </div>
        <h1 className="mt-5 text-[24px] font-semibold text-slate-900">{mode === "login" ? "Sign in" : "Create account"}</h1>
        <p className="mt-1 text-[13px] text-slate-500">FurrBox private local desktop</p>

        <div className="mt-6 grid grid-cols-2 rounded-xl bg-white/48 p-1">
          <button type="button" className={`h-9 rounded-lg text-[13px] font-semibold ${mode === "login" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`} onClick={() => setMode("login")}>
            Sign In
          </button>
          <button type="button" className={`h-9 rounded-lg text-[13px] font-semibold ${mode === "register" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`} onClick={() => setMode("register")}>
            Create Account
          </button>
        </div>

        <div className="mt-5 grid gap-3 text-left">
          <input className="h-11 rounded-xl border border-white/60 bg-white/72 px-4 text-[14px] outline-none placeholder:text-slate-400 focus:border-sky-400" placeholder="Username" value={username} onChange={(event) => setUsername(event.target.value)} autoFocus />
          {mode === "register" && (
            <input className="h-11 rounded-xl border border-white/60 bg-white/72 px-4 text-[14px] outline-none placeholder:text-slate-400 focus:border-sky-400" placeholder="Display name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          )}
          <input className="h-11 rounded-xl border border-white/60 bg-white/72 px-4 text-[14px] outline-none placeholder:text-slate-400 focus:border-sky-400" placeholder="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </div>

        {error && <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-left text-[12px] font-medium text-red-700">{error}</p>}

        <button className="mt-5 h-11 w-full rounded-xl bg-slate-950 text-[14px] font-semibold text-white shadow-lg shadow-slate-900/20 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60" disabled={busy}>
          {busy ? "Working..." : mode === "login" ? "Sign in" : "Create account"}
        </button>
      </form>
    </main>
  );
}
