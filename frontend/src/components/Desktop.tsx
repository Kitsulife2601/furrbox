"use client";

import { Files, Globe, MonitorCog, Terminal } from "lucide-react";
import { useEffect } from "react";
import { FurrBrowser } from "@/components/FurrBrowser";
import { FurrFS } from "@/components/FurrFS";
import { SettingsWindow } from "@/components/SettingsWindow";
import { Taskbar } from "@/components/Taskbar";
import { TerminalWindow } from "@/components/TerminalWindow";
import { WindowsContextMenu } from "@/components/WindowsContextMenu";
import { initFurrSocket } from "@/lib/socket";
import { useFurrBoxStore, type WindowKey } from "@/store/furrbox-store";
import { useWindowStore, type FurrWindowKind } from "@/store/useWindowStore";

const desktopIcons: { id: FurrWindowKind; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { id: "furrfs", label: "FurrFS", icon: Files },
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "settings", label: "Settings", icon: MonitorCog },
  { id: "browser", label: "Browser", icon: Globe }
];

function wallpaperClass(wallpaper: string) {
  if (wallpaper === "aurora") return "wallpaper-aurora";
  if (wallpaper === "ink") return "wallpaper-ink";
  return "desktop-wallpaper";
}

export function Desktop() {
  const { activeWindow, wallpaper, token, patchUi } = useFurrBoxStore();
  const windows = useWindowStore((state) => state.windows);
  const openWindow = useWindowStore((state) => state.openWindow);
  const createWindow = useWindowStore((state) => state.createWindow);

  useEffect(() => {
    if (token) initFurrSocket(token);
  }, [token]);

  return (
    <main className={`relative h-screen w-screen overflow-hidden ${wallpaperClass(wallpaper)}`} data-furr-context="desktop">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(255,255,255,0.42),transparent_36%)]" />

      <div className="absolute left-7 top-8 z-10 grid gap-5">
        {desktopIcons.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className="group grid w-20 justify-items-center gap-2 rounded-xl px-2 py-3 text-white drop-shadow hover:bg-white/20"
              onDoubleClick={() => {
                if (item.id === "browser") createWindow({ kind: "browser", title: "FurrBrowser", url: "https://example.com", x: 180, y: 90, width: 920, height: 640 });
                else patchUi({ activeWindow: item.id as WindowKey });
              }}
              onClick={() => {
                if (item.id === "browser") {
                  createWindow({ kind: "browser", title: "FurrBrowser", url: "https://example.com", x: 180, y: 90, width: 920, height: 640 });
                } else {
                  openWindow(item.id);
                  patchUi({ activeWindow: item.id as WindowKey });
                }
              }}
            >
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/80 text-slate-700 shadow-sm transition group-hover:bg-white">
                <Icon size={24} />
              </span>
              <span className="rounded bg-black/20 px-1 text-center text-[12px] font-medium leading-tight">{item.label}</span>
            </button>
          );
        })}
      </div>

      <div className="relative z-20">
        {Object.values(windows).map((win) => {
          if (win.kind === "furrfs") return <FurrFS key={win.id} windowState={win} />;
          if (win.kind === "terminal") return <TerminalWindow key={win.id} windowState={win} />;
          if (win.kind === "settings") return <SettingsWindow key={win.id} windowState={win} />;
          if (win.kind === "browser") return <FurrBrowser key={win.id} windowState={win} />;
          return null;
        })}
      </div>

      <Taskbar />
      <WindowsContextMenu />
    </main>
  );
}
