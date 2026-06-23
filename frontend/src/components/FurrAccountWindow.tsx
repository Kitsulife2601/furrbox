"use client";

import { ShieldAlert, UserPlus } from "lucide-react";
import { FurrAccountManager } from "@/components/FurrAccountManager";
import { FurrWindow } from "@/components/FurrWindow";
import { useFurrBoxStore } from "@/store/furrbox-store";
import type { FurrWindowState } from "@/store/useWindowStore";

const developerDiscordId = "1312104318006071328";

export function FurrAccountWindow({ windowState }: { windowState: FurrWindowState }) {
  const token = useFurrBoxStore((state) => state.token);
  const user = useFurrBoxStore((state) => state.user);
  const isPrimaryDeveloper = user?.discordId === developerDiscordId;

  return (
    <FurrWindow windowState={windowState} icon={<UserPlus size={15} />} minWidth={460} minHeight={560}>
      <div className="flex h-full min-h-0 flex-col bg-[#050711]/95 text-slate-100">
        <header className="border-b border-cyan-300/15 bg-slate-950/70 px-5 py-4 shadow-[0_0_28px_rgba(0,240,255,0.08)]">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-cyan-300/30 bg-cyan-400/10 text-[#00f0ff] shadow-[0_0_20px_rgba(0,240,255,0.28)]">
              <UserPlus size={19} />
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-[14px] font-black uppercase tracking-[0.16em] text-cyan-100">FurrAccountManager</h3>
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Developer Account Provisioning</p>
            </div>
          </div>
        </header>

        {isPrimaryDeveloper && token ? (
          <div className="scroll-soft min-h-0 flex-1 overflow-auto">
            <FurrAccountManager token={token} onCreated={() => undefined} />
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 place-items-center p-6 text-center">
            <div className="max-w-sm rounded-2xl border border-pink-400/25 bg-pink-500/10 p-6 shadow-[0_0_26px_rgba(255,0,127,0.16)]">
              <ShieldAlert className="mx-auto mb-3 text-[#ff007f]" size={34} />
              <h4 className="text-[13px] font-black uppercase tracking-[0.16em] text-pink-100">Zugriff verweigert</h4>
              <p className="mt-3 text-[12px] leading-5 text-slate-400">Nur der primaere Entwickler kann neue FurrBox-Accounts anlegen.</p>
            </div>
          </div>
        )}
      </div>
    </FurrWindow>
  );
}
