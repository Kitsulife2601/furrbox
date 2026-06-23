"use client";

import { Monitor, SendHorizonal, Terminal } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { FurrWindow } from "@/components/FurrWindow";
import { useFurrBoxStore, type TerminalProfile } from "@/store/furrbox-store";
import type { FurrWindowState } from "@/store/useWindowStore";

function profileTone(profile: TerminalProfile, active: boolean) {
  if (!profile.available) return "border-slate-800 bg-slate-900/35 text-slate-600";
  if (active && profile.family === "linux") return "border-cyan-300/50 bg-cyan-300/10 text-[#00f0ff] shadow-[0_0_16px_rgba(0,240,255,0.25)]";
  if (active && profile.family === "windows") return "border-[#ff007f]/50 bg-[#ff007f]/10 text-pink-100 shadow-[0_0_16px_rgba(255,0,127,0.25)]";
  if (active) return "border-purple-400/45 bg-purple-500/10 text-purple-100";
  return "border-white/10 bg-slate-900/45 text-slate-300 hover:border-cyan-300/30 hover:text-cyan-100";
}

export function TerminalWindow({ windowState }: { windowState: FurrWindowState }) {
  const { terminal, socket, terminalProfiles, activeTerminalProfileId } = useFurrBoxStore();
  const [command, setCommand] = useState("");
  const [switchError, setSwitchError] = useState<string | null>(null);
  const outputRef = useRef<HTMLDivElement | null>(null);

  const activeProfile = useMemo(
    () => terminalProfiles.find((profile) => profile.id === activeTerminalProfileId),
    [activeTerminalProfileId, terminalProfiles]
  );

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
  }, [terminal]);

  useEffect(() => {
    socket?.emit("terminal:profiles");
  }, [socket]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!command.trim()) return;
    socket?.emit("terminal:input", `${command}\r`);
    setCommand("");
  }

  function switchProfile(profile: TerminalProfile) {
    if (!profile.available) {
      setSwitchError(profile.reason || `${profile.label} ist auf diesem Host nicht verfügbar.`);
      return;
    }
    setSwitchError(null);
    socket?.emit("terminal:switch-profile", { profileId: profile.id }, (response: { ok: boolean; error?: string }) => {
      if (!response.ok) setSwitchError(response.error || "Shell konnte nicht gewechselt werden.");
    });
  }

  return (
    <FurrWindow windowState={windowState} icon={<Terminal size={15} />}>
      <div className="flex h-full min-h-0 flex-col bg-slate-950/92 text-slate-100">
        <div className="border-b border-white/10 bg-slate-950/70 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-lg border border-purple-500/20 bg-slate-900/60 px-3 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">
              <Monitor size={14} />
              Shell Mode
            </span>
            {terminalProfiles.map((profile) => {
              const active = profile.id === activeTerminalProfileId;
              return (
                <button
                  key={profile.id}
                  className={`rounded-lg border px-3 py-2 text-[11px] font-black uppercase tracking-[0.1em] transition ${profileTone(profile, active)}`}
                  disabled={!profile.available}
                  title={profile.available ? `${profile.command} ${profile.args.join(" ")}`.trim() : profile.reason}
                  onClick={() => switchProfile(profile)}
                >
                  {profile.label}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-[11px]">
            <span className="truncate text-slate-500">
              Aktiv: <span className="font-semibold text-cyan-100">{activeProfile?.label || "Warte auf Server"}</span>
              {activeProfile ? <span className="text-slate-600"> · {activeProfile.command}</span> : null}
            </span>
            {switchError ? <span className="text-[#ff007f]">{switchError}</span> : null}
          </div>
        </div>

        <div ref={outputRef} className="scroll-soft min-h-0 flex-1 overflow-auto p-4 font-mono text-[12px] leading-5">
          {terminal.map((chunk, index) => (
            <span key={`${index}-${chunk.slice(0, 8)}`} className="whitespace-pre-wrap">
              {chunk}
            </span>
          ))}
        </div>

        <form onSubmit={submit} className="flex h-12 items-center gap-2 border-t border-white/10 px-3">
          <span className="font-mono text-[12px] text-emerald-300">{activeProfile?.family === "windows" ? "furrbox>" : "furrbox$"}</span>
          <input
            className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-white outline-none placeholder:text-slate-600"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder={activeProfile?.family === "windows" ? "Windows command eingeben" : "Linux command eingeben"}
          />
          <button className="grid h-8 w-8 place-items-center rounded-lg bg-white/10 text-white hover:bg-white/20" aria-label="Send command">
            <SendHorizonal size={15} />
          </button>
        </form>
      </div>
    </FurrWindow>
  );
}
