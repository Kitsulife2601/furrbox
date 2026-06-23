"use client";

import { Files, Folder, Gavel, Globe, MonitorCog, Radar, Terminal, UserPlus } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FurrBrowser } from "@/components/FurrBrowser";
import { FurrFS } from "@/components/FurrFS";
import { FurrEvidence } from "@/components/FurrEvidence";
import { FurrFileViewer } from "@/components/FurrFileViewer";
import { FurrNotification } from "@/components/FurrNotification";
import { SettingsWindow } from "@/components/SettingsWindow";
import { Taskbar } from "@/components/Taskbar";
import { TerminalWindow } from "@/components/TerminalWindow";
import { WindowsContextMenu } from "@/components/WindowsContextMenu";
import { useBootAudio } from "@/hooks/useBootAudio";
import { ENABLE_PRESENCE_TOOL } from "@/lib/config";
import { initFurrSocket } from "@/lib/socket";
import { FURRBOX_VERSION } from "@/lib/version";
import { useFurrBoxStore, type WindowKey } from "@/store/furrbox-store";
import { useNotificationStore } from "@/store/useNotificationStore";
import { useWindowStore, type FurrWindowKind } from "@/store/useWindowStore";
import { useWallpaperStore } from "@/store/useWallpaperStore";

declare global {
  interface Window {
    furrboxUpdater?: {
      check: () => Promise<{ ok: boolean; updateInfo?: { version?: string } | null; error?: string }>;
      install: () => Promise<boolean>;
      onStatus: (callback: (payload: { status: string; version?: string; percent?: number; message?: string; edition?: string; channel?: string }) => void) => () => void;
    };
  }
}

const developerDiscordId = "1312104318006071328";

function isDeveloperSession(user: { discordId?: string | null; sessionRole?: string; username?: string; displayName?: string } | null) {
  return Boolean(user && (user.discordId === developerDiscordId || user.sessionRole === "Super_Admin" || user.username === "Kitsulife" || user.displayName === "Kitsulife"));
}

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

const FurrAccountWindow = ENABLE_PRESENCE_TOOL
  ? dynamic(() => import("@/components/FurrAccountWindow").then((mod) => mod.FurrAccountWindow), { ssr: false })
  : null;

function wallpaperClass(wallpaper: string) {
  if (wallpaper === "aurora") return "wallpaper-aurora";
  if (wallpaper === "ink") return "wallpaper-ink";
  return "desktop-wallpaper";
}

const installedVersionStorageKey = "furrbox:last-installed-version-toast";
const updaterReadyStorageKey = "furrbox:last-ready-update-toast";

export function Desktop() {
  const { activeWindow, wallpaper, token, user, patchUi } = useFurrBoxStore();
  const notify = useNotificationStore((state) => state.notify);
  const windows = useWindowStore((state) => state.windows);
  const openWindow = useWindowStore((state) => state.openWindow);
  const createWindow = useWindowStore((state) => state.createWindow);
  const updateWindow = useWindowStore((state) => state.updateWindow);
  const { wallpaperUrl, wallpaperMode, wallpaperVersion, folders, removeFolder } = useWallpaperStore();
  const [selectedDesktopItem, setSelectedDesktopItem] = useState<string | null>(null);
  const canManageAccounts = ENABLE_PRESENCE_TOOL && isDeveloperSession(user);
  const visibleDesktopIcons = useMemo(
    () => (canManageAccounts ? [...desktopIcons, { id: "accounts" as const, label: "Accounts", icon: UserPlus }] : desktopIcons),
    [canManageAccounts]
  );

  const launchDesktopApp = useCallback(
    (id: FurrWindowKind) => {
      if (id === "browser") {
        const existingBrowser = Object.values(useWindowStore.getState().windows)
          .filter((win) => win.kind === "browser")
          .sort((a, b) => b.zIndex - a.zIndex)[0];
        if (existingBrowser) {
          openWindow(existingBrowser.id);
        } else {
          createWindow({ kind: "browser", title: "FurrBrowser", url: "https://example.com", x: 180, y: 90, width: 920, height: 640 });
        }
        return;
      }
      openWindow(id);
      patchUi({ activeWindow: id as WindowKey });
    },
    [createWindow, openWindow, patchUi]
  );

  const openDesktopFolder = useCallback(
    (folder: { id: string; name: string }) => {
      const folderPath = `Dokumente/${folder.name}`;
      updateWindow("furrfs", { url: `furrfs:path:${encodeURIComponent(folderPath)}` });
      openWindow("furrfs");
      patchUi({ activeWindow: "furrfs" });
    },
    [openWindow, patchUi, updateWindow]
  );

  useBootAudio({
    enabled: Boolean(token),
    volume: 0.22,
    onPlayed: () => {
      const lastNotifiedVersion = window.localStorage.getItem(installedVersionStorageKey);
      if (lastNotifiedVersion === FURRBOX_VERSION) return;
      window.localStorage.setItem(installedVersionStorageKey, FURRBOX_VERSION);
      notify({
        version: FURRBOX_VERSION,
        title: "Version installiert",
        description: `${FURRBOX_VERSION} wurde erfolgreich installiert und ist jetzt aktiv.`
      });
    }
  });

  useEffect(() => {
    if (token) initFurrSocket(token);
  }, [token]);

  useEffect(() => {
    const onDesktopFolderDelete = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string; targetId?: string }>).detail;
      if (detail?.kind === "folder" && detail.targetId && folders.some((folder) => folder.id === detail.targetId)) {
        removeFolder(detail.targetId);
      }
    };
    window.addEventListener("furrfs:delete", onDesktopFolderDelete);
    return () => window.removeEventListener("furrfs:delete", onDesktopFolderDelete);
  }, [folders, removeFolder]);

  useEffect(() => {
    if (!window.furrboxUpdater) return;
    return window.furrboxUpdater.onStatus((payload) => {
      if (payload.status === "error") {
        console.warn("FurrBox updater error:", payload.message || "Update check failed.");
        notify({
          version: FURRBOX_VERSION,
          title: "Updater nicht erreichbar",
          description: payload.message || "Die Update-Pruefung konnte nicht abgeschlossen werden."
        });
        return;
      }

      if (payload.status === "available" && payload.version) {
        notify({
          version: `v${payload.version}`,
          title: "Update gefunden",
          description: `${payload.edition || "FurrBox"} laedt Version v${payload.version} im Hintergrund.`
        });
        return;
      }

      if (payload.status === "downloading" && typeof payload.percent === "number" && payload.percent >= 100) {
        notify({
          version: FURRBOX_VERSION,
          title: "Update heruntergeladen",
          description: "Das Update wird vorbereitet und kann gleich installiert werden."
        });
        return;
      }

      if (payload.status === "ready" && payload.version) {
        const storageKey = `${payload.channel || "default"}:${payload.version}`;
        if (window.localStorage.getItem(updaterReadyStorageKey) === storageKey) return;
        window.localStorage.setItem(updaterReadyStorageKey, storageKey);
        notify({
          version: `v${payload.version}`,
          title: "Update bereit",
          description: `${payload.edition || "FurrBox"} v${payload.version} ist heruntergeladen. Beim naechsten Neustart wird es installiert.`
        });
      }
    });
  }, [notify]);

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
        {visibleDesktopIcons.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={`group grid w-20 justify-items-center gap-2 rounded-xl px-2 py-3 text-white transition hover:bg-slate-950/45 ${selectedDesktopItem === item.id ? "bg-cyan-400/10 ring-1 ring-cyan-300/35" : ""}`}
              aria-label={`${item.label} öffnen`}
              onClick={() => {
                setSelectedDesktopItem(item.id);
                launchDesktopApp(item.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") launchDesktopApp(item.id);
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

      <div className="pointer-events-none absolute inset-0 z-10">
        {folders.map((folder) => (
          <button
            key={folder.id}
            className={`pointer-events-auto group absolute grid w-20 justify-items-center gap-2 rounded-xl px-2 py-3 text-white transition hover:bg-slate-950/45 ${selectedDesktopItem === folder.id ? "bg-purple-400/10 ring-1 ring-purple-300/35" : ""}`}
            style={{ left: folder.x, top: folder.y }}
            data-furr-context="folder"
            data-file-id={folder.id}
            data-file-name={folder.name}
            aria-label={`${folder.name} in FurrFS öffnen`}
            onClick={() => {
              setSelectedDesktopItem(folder.id);
              openDesktopFolder(folder);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") openDesktopFolder(folder);
            }}
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
          if (ENABLE_PRESENCE_TOOL && FurrAccountWindow && win.kind === "accounts") return <FurrAccountWindow key={win.id} windowState={win} />;
          if (win.kind === "browser") return <FurrBrowser key={win.id} windowState={win} />;
          if (win.kind === "viewer") return <FurrFileViewer key={win.id} windowState={win} />;
          return null;
        })}
      </div>

      <Taskbar />
      <WindowsContextMenu />
      <FurrNotification />
    </main>
  );
}
