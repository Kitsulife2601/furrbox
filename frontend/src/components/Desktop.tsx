"use client";

import { Files, Folder, Gavel, Globe, MonitorCog, Radar, Terminal } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect } from "react";
import { FurrBrowser } from "@/components/FurrBrowser";
import { FurrFS } from "@/components/FurrFS";
import { FurrEvidence } from "@/components/FurrEvidence";
import { SettingsWindow } from "@/components/SettingsWindow";
import { Taskbar } from "@/components/Taskbar";
import { TerminalWindow } from "@/components/TerminalWindow";
import { WindowsContextMenu } from "@/components/WindowsContextMenu";
import { useBootAudio } from "@/hooks/useBootAudio";
import { ENABLE_PRESENCE_TOOL } from "@/lib/config";
import { initFurrSocket } from "@/lib/socket";
import { useFurrBoxStore, type WindowKey } from "@/store/furrbox-store";
import { useWindowStore, type FurrWindowKind } from "@/store/useWindowStore";
import { useWallpaperStore } from "@/store/useWallpaperStore";

const desktopIcons: { id: FurrWindowKind; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { id: "furrfs", label: "FurrFS", icon: Files },
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "settings", label: "Settings", icon: MonitorCog },
  { id: "browser", label: "Browser", icon: Globe },
  { id: "evidence", label: "Evidence", icon: Gavel },
  ...(ENABLE_PRESENCE_TOOL ? [{ id: "presence" as const, label: "Presence", icon: Radar }] : [])
];

const FurrPresenceWindow = ENABLE_PRESENCE_TOOL
  ? dynamic(() => import("@/components/FurrPresence").then((mod) => mod.FurrPresence), { ssr: false })
  : null;

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
  const { wallpaperUrl, wallpaperMode, wallpaperVersion, folders } = useWallpaperStore();

  useBootAudio({ enabled: Boolean(token), volume: 0.22 });

  useEffect(() => {
    if (token) initFurrSocket(token);
  }, [token]);

  return (
    <main className={`relative h-screen w-screen overflow-hidden ${wallpaperClass(wallpaper)}`} data-furr-context="desktop">
      {wallpaperMode === "image" && wallpaperUrl ? (
        <div
          key={wallpaperVersion}
          className="pointer-events-none absolute inset-0 animate-wallpaper-fade bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: `url("${wallpaperUrl}")` }}
        />
      ) : null}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(0,240,255,0.16),transparent_28%),radial-gradient(circle_at_78%_18%,rgba(255,0,127,0.12),transparent_30%),linear-gradient(180deg,rgba(10,11,16,0.2),rgba(10,11,16,0.72))]" />

      <div className="absolute left-7 top-8 z-10 grid gap-5">
        {desktopIcons.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className="group grid w-20 justify-items-center gap-2 rounded-xl px-2 py-3 text-white transition hover:bg-slate-950/45"
              onDoubleClick={() => {
                if (item.id === "browser") createWindow({ kind: "browser", title: "FurrBrowser", url: "https://example.com", x: 180, y: 90, width: 920, height: 640 });
                else {
                  openWindow(item.id);
                  patchUi({ activeWindow: item.id as WindowKey });
                }
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
              <span className="grid h-12 w-12 place-items-center rounded-[14px] border border-cyan-300/25 bg-slate-950/65 text-[#00f0ff] shadow-[0_0_18px_rgba(0,240,255,0.22),inset_0_1px_0_rgba(255,255,255,0.08)] transition group-hover:border-[#ff007f]/65 group-hover:text-[#ff007f] group-hover:shadow-[0_0_24px_rgba(255,0,127,0.38)]">
                <Icon size={24} />
              </span>
              <span className="rounded bg-black/30 px-1 text-center text-[12px] font-semibold leading-tight text-white drop-shadow-[0_2px_5px_rgba(0,0,0,0.9)]">{item.label}</span>
            </button>
          );
        })}
      </div>

      <div className="absolute inset-0 z-10">
        {folders.map((folder) => (
          <button
            key={folder.id}
            className="group absolute grid w-20 justify-items-center gap-2 rounded-xl px-2 py-3 text-white transition hover:bg-slate-950/45"
            style={{ left: folder.x, top: folder.y }}
            data-furr-context="folder"
            data-file-id={folder.id}
            data-file-name={folder.name}
          >
            <span className="grid h-12 w-12 place-items-center rounded-[14px] border border-purple-300/25 bg-slate-950/65 text-[#8b5cf6] shadow-[0_0_18px_rgba(139,92,246,0.28),inset_0_1px_0_rgba(255,255,255,0.08)] transition group-hover:border-[#00f0ff]/60 group-hover:text-[#00f0ff] group-hover:shadow-[0_0_24px_rgba(0,240,255,0.32)]">
              <Folder size={25} />
            </span>
            <span className="rounded bg-black/30 px-1 text-center text-[12px] font-semibold leading-tight text-white drop-shadow-[0_2px_5px_rgba(0,0,0,0.9)]">{folder.name}</span>
          </button>
        ))}
      </div>

      <div className="relative z-20">
        {Object.values(windows).map((win) => {
          if (win.kind === "furrfs") return <FurrFS key={win.id} windowState={win} />;
          if (win.kind === "terminal") return <TerminalWindow key={win.id} windowState={win} />;
          if (win.kind === "settings") return <SettingsWindow key={win.id} windowState={win} />;
          if (win.kind === "evidence") return <FurrEvidence key={win.id} windowState={win} />;
          if (ENABLE_PRESENCE_TOOL && FurrPresenceWindow && win.kind === "presence") return <FurrPresenceWindow key={win.id} windowState={win} />;
          if (win.kind === "browser") return <FurrBrowser key={win.id} windowState={win} />;
          return null;
        })}
      </div>

      <Taskbar />
      <WindowsContextMenu />
    </main>
  );
}
