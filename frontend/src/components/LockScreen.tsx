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
    <main className="desktop-wallpaper relative h-screen w-screen overflow-hidden text-white" onClick={onUnlock}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_22%,rgba(255,255,255,0.46),transparent_28%),linear-gradient(135deg,rgba(14,116,144,0.18),rgba(79,70,229,0.25))]" />
      <div className="absolute inset-x-0 top-[15vh] text-center drop-shadow">
        <div className="text-[96px] font-semibold leading-none tracking-normal">{time}</div>
        <div className="mt-4 text-[22px] font-medium">{date}</div>
      </div>
      <div className="absolute bottom-16 left-1/2 flex -translate-x-1/2 flex-col items-center gap-3 text-white/88">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/18 backdrop-blur-xl">
          <Shield size={23} />
        </div>
        <div className="flex items-center gap-2 text-[13px] font-medium">
          <ChevronUp size={16} />
          Click or press any key to unlock
        </div>
      </div>
    </main>
  );
}
