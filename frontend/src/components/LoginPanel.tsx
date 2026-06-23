"use client";

import { FormEvent, useState } from "react";
import { KeyRound } from "lucide-react";
import { login } from "@/lib/auth";
import { useFurrBoxStore } from "@/store/furrbox-store";

export function LoginPanel() {
  const { setSession, setAuthStage } = useFurrBoxStore();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await login(username, password);
      setSession(result.token, result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Anmeldung fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="cyber-grid relative grid h-screen w-screen place-items-center overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(255,0,127,0.16),transparent_26%),radial-gradient(circle_at_50%_58%,rgba(0,240,255,0.14),transparent_32%)]" />
      <form onSubmit={submit} className="relative w-[390px] rounded-[24px] border border-white/5 bg-slate-900/40 p-7 text-center shadow-[0_0_80px_rgba(139,92,246,0.35),0_0_30px_rgba(0,240,255,0.12)] backdrop-blur-xl">
        <div className="pointer-events-none absolute inset-0 rounded-[24px] border border-cyan-300/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]" />
        <button type="button" className="absolute left-4 top-4 text-[12px] font-medium text-cyan-200/70 hover:text-[#00f0ff]" onClick={() => setAuthStage("lock")}>
          Lock
        </button>
        <div className="mx-auto grid h-20 w-20 place-items-center rounded-2xl border border-cyan-300/25 bg-slate-950/80 text-[#00f0ff] shadow-[0_0_35px_rgba(0,240,255,0.35)]">
          <KeyRound size={32} />
        </div>
        <h1 className="mt-5 text-[24px] font-semibold text-slate-100 drop-shadow-[0_0_10px_rgba(255,0,127,0.35)]">Sign in</h1>
        <p className="mt-1 text-[13px] text-cyan-100/60">FurrBox private account access only</p>

        <div className="mt-5 grid gap-3 text-left">
          <input className="h-11 rounded-xl border border-cyan-300/20 bg-slate-900/80 px-4 text-[14px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#00f0ff] focus:ring-2 focus:ring-[#00f0ff] focus:shadow-[0_0_15px_rgba(0,240,255,0.5)]" placeholder="Username" value={username} onChange={(event) => setUsername(event.target.value)} autoFocus />
          <input className="h-11 rounded-xl border border-cyan-300/20 bg-slate-900/80 px-4 text-[14px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#00f0ff] focus:ring-2 focus:ring-[#00f0ff] focus:shadow-[0_0_15px_rgba(0,240,255,0.5)]" placeholder="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </div>

        {error && <p className="mt-4 rounded-xl border border-[#ff007f]/30 bg-[#ff007f]/10 px-3 py-2 text-left text-[12px] font-medium text-pink-100">{error}</p>}

        <button className="mt-5 h-11 w-full rounded-xl bg-gradient-to-r from-[#ff007f] via-[#8b5cf6] to-[#00f0ff] text-[14px] font-bold text-white shadow-[0_0_25px_rgba(255,0,127,0.45)] [text-shadow:0_0_8px_rgba(0,0,0,0.65)] hover:shadow-[0_0_35px_rgba(0,240,255,0.55)] disabled:cursor-not-allowed disabled:opacity-60" disabled={busy}>
          {busy ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}
