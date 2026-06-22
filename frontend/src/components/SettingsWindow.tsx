"use client";

import { Cpu, Database, MemoryStick, MonitorCog } from "lucide-react";
import { useEffect, useState } from "react";
import { FurrWindow } from "@/components/FurrWindow";
import { useFurrBoxStore, type Wallpaper } from "@/store/furrbox-store";
import type { FurrWindowState } from "@/store/useWindowStore";

const wallpapers: { id: Wallpaper; label: string; className: string }[] = [
  { id: "bloom", label: "Bloom", className: "desktop-wallpaper" },
  { id: "aurora", label: "Aurora", className: "wallpaper-aurora" },
  { id: "ink", label: "Ink", className: "wallpaper-ink" }
];

type HardwareStats = {
  cpuLoad: number;
  ramUsedPercent: number;
  ramAvailableGb: number;
  storageUsedPercent: number;
  storageAvailableGb: number;
};

export function SettingsWindow({ windowState }: { windowState: FurrWindowState }) {
  const { wallpaper, socket, patchUi } = useFurrBoxStore();
  const [stats, setStats] = useState<HardwareStats | null>(null);

  useEffect(() => {
    if (!socket) return;
    const handler = (nextStats: HardwareStats) => setStats(nextStats);
    socket.emit("hardware:subscribe");
    socket.on("hardware:stats", handler);
    return () => {
      socket.emit("hardware:unsubscribe");
      socket.off("hardware:stats", handler);
    };
  }, [socket]);

  return (
    <FurrWindow windowState={windowState} icon={<MonitorCog size={15} />}>
      <div className="scroll-soft h-full overflow-auto p-5">
        <h3 className="text-[15px] font-semibold text-slate-850">Personalization</h3>
        <p className="mt-1 text-[12px] text-slate-500">Wallpaper choice is synced live across connected instances.</p>
        <div className="mt-5 grid grid-cols-3 gap-3">
          {wallpapers.map((item) => (
            <button key={item.id} className="text-left" onClick={() => patchUi({ wallpaper: item.id })}>
              <span className={`block h-20 rounded-xl border ${item.className} ${wallpaper === item.id ? "border-slate-900 ring-2 ring-slate-900/20" : "border-white/70"}`} />
              <span className="mt-2 block text-center text-[12px] font-medium text-slate-600">{item.label}</span>
            </button>
          ))}
        </div>

        <h3 className="mt-6 text-[15px] font-semibold text-slate-850">Hardware Monitor</h3>
        <div className="mt-3 grid gap-2">
          {[
            { label: "CPU load", value: `${stats?.cpuLoad.toFixed(1) ?? "0.0"}%`, icon: <Cpu size={16} /> },
            { label: "RAM used", value: `${stats?.ramUsedPercent.toFixed(1) ?? "0.0"}% · ${stats?.ramAvailableGb.toFixed(1) ?? "0.0"} GB free`, icon: <MemoryStick size={16} /> },
            { label: "Storage used", value: `${stats?.storageUsedPercent.toFixed(1) ?? "0.0"}% · ${stats?.storageAvailableGb.toFixed(1) ?? "0.0"} GB free`, icon: <Database size={16} /> }
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-3 rounded-xl border border-white/50 bg-white/45 px-3 py-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-white text-slate-600 shadow-sm">{item.icon}</span>
              <div>
                <p className="text-[12px] font-semibold text-slate-700">{item.label}</p>
                <p className="text-[12px] text-slate-500">{item.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </FurrWindow>
  );
}
