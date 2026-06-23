"use client";

import { FileText, Files, Gavel, Globe, LogOut, MonitorCog, Radar, Search, Terminal, Wifi, WifiOff } from "lucide-react";
import { useMemo } from "react";
import { ENABLE_PRESENCE_TOOL } from "@/lib/config";
import { useFurrBoxStore, type WindowKey } from "@/store/furrbox-store";
import { useWindowStore, type FurrWindowKind } from "@/store/useWindowStore";

const apps: { id: FurrWindowKind; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { id: "furrfs", label: "FurrFS", icon: Files },
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "settings", label: "Settings", icon: MonitorCog },
  { id: "browser", label: "Browser", icon: Globe },
  { id: "evidence", label: "Evidence", icon: Gavel },
  ...(ENABLE_PRESENCE_TOOL ? [{ id: "presence" as const, label: "Presence", icon: Radar }] : [])
];

export function Taskbar() {
  const { activeWindow, connected, startOpen, user, logout, patchUi } = useFurrBoxStore();
  const windows = useWindowStore((state) => state.windows);
  const openWindow = useWindowStore((state) => state.openWindow);
  const restoreWindow = useWindowStore((state) => state.restoreWindow);
  const createWindow = useWindowStore((state) => state.createWindow);
  const time = useMemo(() => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), []);
  const viewerWindows = useMemo(
    () =>
      Object.values(windows)
        .filter((win) => win.kind === "viewer" && win.isOpen)
        .sort((a, b) => a.zIndex - b.zIndex),
    [windows]
  );

  function launch(id: FurrWindowKind) {
    if (id === "browser") {
      const existingBrowser = Object.values(useWindowStore.getState().windows)
        .filter((win) => win.kind === "browser")
        .sort((a, b) => b.zIndex - a.zIndex)[0];
      if (existingBrowser) openWindow(existingBrowser.id);
      else createWindow({ kind: "browser", title: "FurrBrowser", url: "https://example.com", x: 180, y: 90, width: 920, height: 640 });
      return;
    }
    if (windows[id]?.isMinimized) restoreWindow(id);
    else openWindow(id);
    patchUi({ activeWindow: id as WindowKey, startOpen: false });
  }

  return (
    <>
      {startOpen && (
        <div className="absolute bottom-24 left-1/2 z-40 h-[460px] w-[560px] -translate-x-1/2 animate-task-pop rounded-[22px] border border-purple-500/25 bg-slate-950/70 p-5 shadow-[0_0_55px_rgba(139,92,246,0.34),0_0_22px_rgba(0,240,255,0.12)] backdrop-blur-2xl">
          <div className="mb-4 flex h-10 items-center gap-2 rounded-xl border border-cyan-300/15 bg-slate-900/70 px-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
            <Search size={17} className="text-[#00f0ff]" />
            <input className="w-full bg-transparent text-[13px] text-slate-100 outline-none placeholder:text-slate-500" placeholder="Search apps, files, settings" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            {apps.map((app) => {
              const Icon = app.icon;
              return (
                <button
                  key={app.id}
                  className="rounded-2xl border border-white/5 p-4 text-center transition hover:border-[#ff007f]/35 hover:bg-[#ff007f]/10 hover:shadow-[0_0_22px_rgba(255,0,127,0.22)]"
                  onClick={() => launch(app.id)}
                >
                  <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-cyan-300/20 bg-slate-900/80 text-[#00f0ff] shadow-[0_0_16px_rgba(0,240,255,0.22)]">
                    <Icon size={22} />
                  </span>
                  <span className="mt-2 block text-[12px] font-semibold text-slate-100">{app.label}</span>
                </button>
              );
            })}
          </div>
          <div className="absolute inset-x-0 bottom-0 flex h-16 items-center justify-between rounded-b-[22px] border-t border-purple-500/20 bg-slate-900/55 px-5">
            <span className="text-[13px] font-semibold text-cyan-100">{user?.displayName || "Private local session"}</span>
            <button className="grid h-9 w-9 place-items-center rounded-xl text-slate-300 hover:bg-[#ff007f]/15 hover:text-pink-100" aria-label="Sign out" onClick={logout}>
              <LogOut size={17} />
            </button>
          </div>
        </div>
      )}

      <footer className="absolute bottom-3 left-1/2 z-50 flex h-16 w-[min(980px,calc(100vw-32px))] -translate-x-1/2 items-center justify-between rounded-2xl border border-purple-500/30 bg-slate-900/60 px-5 shadow-[0_0_30px_rgba(139,92,246,0.35),0_0_16px_rgba(0,240,255,0.12)] backdrop-blur-2xl" data-furr-context="taskbar">
        <div className="flex w-48 items-center gap-2">
          {connected ? <Wifi size={17} className="text-[#00f0ff] drop-shadow-[0_0_7px_rgba(0,240,255,0.8)]" /> : <WifiOff size={17} className="text-[#ff007f] drop-shadow-[0_0_7px_rgba(255,0,127,0.8)]" />}
          <span className="text-[12px] font-semibold text-slate-200">{connected ? "Secure sync online" : "Reconnecting"}</span>
        </div>

        <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-2">
          <button
            className="grid h-11 w-11 place-items-center rounded-xl border border-cyan-300/25 bg-slate-950/70 text-[#00f0ff] shadow-[0_0_18px_rgba(0,240,255,0.25)] transition hover:border-[#ff007f]/55 hover:text-[#ff007f] hover:shadow-[0_0_22px_rgba(255,0,127,0.35)]"
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
                className={`relative grid h-11 w-11 place-items-center rounded-xl border transition ${selected ? "border-[#ff007f]/55 bg-[#ff007f]/15 text-pink-100 shadow-[0_0_20px_rgba(255,0,127,0.34)] after:absolute after:-bottom-2 after:h-1 after:w-5 after:rounded-full after:bg-[#ff007f] after:shadow-[0_0_12px_rgba(255,0,127,0.95)]" : "border-white/5 text-slate-300 hover:border-cyan-300/30 hover:bg-cyan-500/10 hover:text-[#00f0ff]"}`}
                aria-label={app.label}
                onClick={() => launch(app.id)}
              >
                <Icon size={21} />
              </button>
            );
          })}
          {viewerWindows.map((win) => {
            const selected = !win.isMinimized;
            return (
              <button
                key={win.id}
                className={`relative grid h-11 w-11 place-items-center rounded-xl border transition ${selected ? "border-[#ff007f]/55 bg-[#ff007f]/15 text-pink-100 shadow-[0_0_20px_rgba(255,0,127,0.34)] after:absolute after:-bottom-2 after:h-1 after:w-5 after:rounded-full after:bg-[#ff007f] after:shadow-[0_0_12px_rgba(255,0,127,0.95)]" : "border-white/5 text-slate-300 hover:border-cyan-300/30 hover:bg-cyan-500/10 hover:text-[#00f0ff]"}`}
                aria-label={win.title}
                title={win.title}
                onClick={() => {
                  if (win.isMinimized) restoreWindow(win.id);
                  else openWindow(win.id);
                }}
              >
                <FileText size={20} />
              </button>
            );
          })}
        </div>

        <div className="w-48 text-right text-[12px] font-semibold leading-tight text-slate-200">
          <div>{time}</div>
          <div>{new Date().toLocaleDateString()}</div>
        </div>
      </footer>
    </>
  );
}
