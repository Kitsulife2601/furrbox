"use client";

import { ChevronUp, Shield } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    const handler = () => onUnlock();
    window.addEventListener("keydown", handler);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("keydown", handler);
    };
  }, [onUnlock]);

  const time = useMemo(() => now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), [now]);
  const date = useMemo(() => now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }), [now]);

  return (
    <main className="cyber-grid relative h-screen w-screen overflow-hidden text-white" onClick={onUnlock}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_22%,rgba(255,0,127,0.2),transparent_30%),radial-gradient(circle_at_28%_18%,rgba(0,240,255,0.18),transparent_32%),linear-gradient(180deg,rgba(10,11,16,0.14),rgba(10,11,16,0.82))]" />
      <div className="absolute inset-x-0 top-[15vh] text-center">
        <div className="text-[96px] font-semibold leading-none tracking-normal text-slate-50 drop-shadow-[0_0_18px_rgba(0,240,255,0.42)]">{time}</div>
        <div className="mt-4 text-[22px] font-medium text-cyan-100 drop-shadow-[0_0_14px_rgba(255,0,127,0.36)]">{date}</div>
      </div>
      <div className="absolute bottom-16 left-1/2 flex -translate-x-1/2 flex-col items-center gap-3 text-slate-100">
        <div className="grid h-12 w-12 place-items-center rounded-2xl border border-cyan-300/20 bg-slate-950/55 text-[#00f0ff] shadow-[0_0_24px_rgba(0,240,255,0.25)] backdrop-blur-xl">
          <Shield size={23} />
        </div>
        <div className="flex items-center gap-2 text-[13px] font-semibold text-cyan-100/80">
          <ChevronUp size={16} />
          Click or press any key to unlock
        </div>
      </div>
    </main>
  );
}
