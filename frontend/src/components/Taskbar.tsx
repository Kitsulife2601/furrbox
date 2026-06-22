"use client";

import { Files, Globe, LogOut, MonitorCog, Search, Terminal, Wifi, WifiOff } from "lucide-react";
import { useMemo } from "react";
import { useFurrBoxStore, type WindowKey } from "@/store/furrbox-store";
import { useWindowStore, type FurrWindowKind } from "@/store/useWindowStore";

const apps: { id: FurrWindowKind; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { id: "furrfs", label: "FurrFS", icon: Files },
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "settings", label: "Settings", icon: MonitorCog },
  { id: "browser", label: "Browser", icon: Globe }
];

export function Taskbar() {
  const { activeWindow, connected, startOpen, user, logout, patchUi } = useFurrBoxStore();
  const windows = useWindowStore((state) => state.windows);
  const openWindow = useWindowStore((state) => state.openWindow);
  const restoreWindow = useWindowStore((state) => state.restoreWindow);
  const createWindow = useWindowStore((state) => state.createWindow);
  const time = useMemo(() => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), []);

  function launch(id: FurrWindowKind) {
    if (id === "browser") {
      createWindow({ kind: "browser", title: "FurrBrowser", url: "https://example.com", x: 180, y: 90, width: 920, height: 640 });
      return;
    }
    if (windows[id]?.isMinimized) restoreWindow(id);
    else openWindow(id);
    patchUi({ activeWindow: id as WindowKey, startOpen: false });
  }

  return (
    <>
      {startOpen && (
        <div className="glass-strong absolute bottom-24 left-1/2 z-40 h-[460px] w-[560px] -translate-x-1/2 animate-task-pop rounded-[22px] p-5 shadow-window">
          <div className="mb-4 flex h-10 items-center gap-2 rounded-xl bg-white/70 px-3">
            <Search size={17} className="text-slate-500" />
            <input className="w-full bg-transparent text-[13px] outline-none placeholder:text-slate-400" placeholder="Search apps, files, settings" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            {apps.map((app) => {
              const Icon = app.icon;
              return (
                <button
                  key={app.id}
                  className="rounded-2xl p-4 text-center hover:bg-white/62"
                  onClick={() => launch(app.id)}
                >
                  <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white text-slate-700 shadow-sm">
                    <Icon size={22} />
                  </span>
                  <span className="mt-2 block text-[12px] font-medium text-slate-700">{app.label}</span>
                </button>
              );
            })}
          </div>
          <div className="absolute inset-x-0 bottom-0 flex h-16 items-center justify-between rounded-b-[22px] border-t border-white/55 bg-white/36 px-5">
            <span className="text-[13px] font-semibold text-slate-700">{user?.displayName || "Private local session"}</span>
            <button className="grid h-9 w-9 place-items-center rounded-xl hover:bg-white/70" aria-label="Sign out" onClick={logout}>
              <LogOut size={17} />
            </button>
          </div>
        </div>
      )}

      <footer className="glass absolute inset-x-0 bottom-0 z-50 mx-auto flex h-16 items-center justify-between px-5 shadow-glass" data-furr-context="taskbar">
        <div className="flex w-48 items-center gap-2">
          {connected ? <Wifi size={17} className="text-emerald-600" /> : <WifiOff size={17} className="text-red-500" />}
          <span className="text-[12px] font-medium text-slate-700">{connected ? "Secure sync online" : "Reconnecting"}</span>
        </div>

        <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-2">
          <button
            className="grid h-11 w-11 place-items-center rounded-xl bg-white/74 text-sky-600 shadow-sm hover:bg-white"
            aria-label="Start"
            onClick={() => patchUi({ startOpen: !startOpen })}
          >
            <span className="grid h-5 w-5 grid-cols-2 gap-0.5">
              <span className="rounded-[3px] bg-sky-500" />
              <span className="rounded-[3px] bg-sky-500" />
              <span className="rounded-[3px] bg-sky-500" />
              <span className="rounded-[3px] bg-sky-500" />
            </span>
          </button>
          {apps.map((app) => {
            const Icon = app.icon;
            const selected = app.id !== "browser" && windows[app.id]?.isOpen && !windows[app.id]?.isMinimized;
            return (
              <button
                key={app.id}
                className={`grid h-11 w-11 place-items-center rounded-xl transition ${selected ? "bg-white text-slate-900 shadow-sm" : "text-slate-700 hover:bg-white/62"}`}
                aria-label={app.label}
                onClick={() => launch(app.id)}
              >
                <Icon size={21} />
              </button>
            );
          })}
        </div>

        <div className="w-48 text-right text-[12px] font-semibold leading-tight text-slate-700">
          <div>{time}</div>
          <div>{new Date().toLocaleDateString()}</div>
        </div>
      </footer>
    </>
  );
}
