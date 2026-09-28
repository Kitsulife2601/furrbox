import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Folder } from "lucide-react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { APPS, canLaunch } from "@/lib/apps";
import { createFolder, deleteEntry, listFiles, renameEntry, saveTextFile } from "@/lib/furr/api/files";
import type { FurrFile } from "@/lib/furr/types";
import { useMe } from "@/lib/furr/client";
import { cn } from "@/lib/utils";
import { DEFAULT_WALLPAPER_LAYOUT, useDesktop, wallpaperStyle } from "@/store/desktop";
import { notifyError } from "@/store/notifications";
import { ChatPanel } from "@/components/furr/ChatPanel";
import { filesKey, openFurrFile, uploadBrowserFiles } from "@/components/furr/FurrFS";
import { LoginPanel } from "@/components/furr/LoginPanel";
import { useFurrSync } from "@/components/furr/useFurrSync";
import { ConfirmDialog, PopupMenu, PromptDialog, type MenuItem } from "@/components/furr/ui";
import { LockScreen } from "./LockScreen";
import { UpdatePopup } from "./UpdatePopup";
import { Taskbar } from "./Taskbar";
import { WindowFrame } from "./WindowFrame";
import { ClockFlyout, InfoCenter, SearchPanel, StartMenu, Toasts } from "./Flyouts";

function playBootSound(volume: number) {
  const audio = new Audio("/audio/boot.mp3");
  audio.volume = Math.max(0, Math.min(volume / 100, 1)) * 0.5;
  audio.play().catch(() => undefined);
}

export function Desktop() {
  const { user, isPending } = useCurrentUserState();
  const locked = useDesktop((s) => s.locked);
  const theme = useDesktop((s) => s.theme);
  const accent = useDesktop((s) => s.accent);
  const wallpaper = useDesktop((s) => s.wallpaper);
  const wallpaperUrl = useDesktop((s) => s.wallpaperUrl);
  const lock = useDesktop((s) => s.lock);
  // Better Auth briefly reports `isPending` again on background session refreshes;
  // only the very first resolution should show the boot screen, otherwise the login
  // form / desktop would remount and lose their state.
  const [resolved, setResolved] = useState(false);
  const lastUser = useRef(user);
  if (!isPending) lastUser.current = user;
  useEffect(() => {
    if (!isPending) setResolved(true);
  }, [isPending]);
  const sessionUser = isPending ? lastUser.current : user;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.setProperty("--os-accent", accent);
  }, [theme, accent]);

  const wallpaperLayout = useDesktop((s) => s.wallpaperLayout) ?? DEFAULT_WALLPAPER_LAYOUT;
  const bg = wallpaperStyle(wallpaperUrl, wallpaperLayout);

  // Auth stages from FurrBox: lock screen -> sign in -> desktop.
  if (locked) return <LockScreen userName={sessionUser?.displayName ?? sessionUser?.primaryEmail ?? null} style={bg} />;
  if (!resolved) {
    return <div className={`grid h-dvh place-items-center bg-cover bg-center wallpaper-${wallpaper} text-sm text-muted`} style={bg}>FurrBox startet…</div>;
  }
  if (!sessionUser) {
    return (
      <div className={`grid h-dvh place-items-center bg-cover bg-center p-4 wallpaper-${wallpaper}`} style={bg}>
        <LoginPanel onBack={lock} />
      </div>
    );
  }
  return <DesktopShell backgroundStyle={bg} />;
}

function DesktopShell({ backgroundStyle }: { backgroundStyle?: CSSProperties }) {
  const queryClient = useQueryClient();
  const me = useMe();
  const wallpaper = useDesktop((s) => s.wallpaper);
  const nightLight = useDesktop((s) => s.nightLight);
  const brightness = useDesktop((s) => s.brightness);
  const bootSound = useDesktop((s) => s.bootSound);
  const volume = useDesktop((s) => s.volume);
  const windows = useDesktop((s) => s.windows);
  const startOpen = useDesktop((s) => s.startOpen);
  const searchOpen = useDesktop((s) => s.searchOpen);
  const chatOpen = useDesktop((s) => s.chatOpen);
  const tray = useDesktop((s) => s.tray);
  const selectedIcon = useDesktop((s) => s.selectedIcon);
  const selectIcon = useDesktop((s) => s.selectIcon);
  const openApp = useDesktop((s) => s.openApp);
  const closeMenus = useDesktop((s) => s.closeMenus);
  const [now, setNow] = useState(() => new Date());
  const [menu, setMenu] = useState<{ x: number; y: number; file?: FurrFile } | null>(null);
  const [dialog, setDialog] = useState<null | "folder" | "text">(null);
  const [renaming, setRenaming] = useState<FurrFile | null>(null);
  const [removing, setRemoving] = useState<FurrFile | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const bootPlayed = useRef(false);

  useFurrSync(true);

  useEffect(() => {
    if (bootSound && !bootPlayed.current) {
      bootPlayed.current = true;
      playBootSound(volume);
    }
  }, [bootSound, volume]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeMenus();
        setMenu(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [closeMenus]);

  // Desktop items live in the private FurrFS "Desktop" folder, so they sync across devices.
  const desktopFiles = useQuery({
    queryKey: filesKey("private", "Desktop"),
    queryFn: () => listFiles({ data: { scope: "private", folder: "Desktop" } }),
    refetchInterval: 10_000,
  });
  const refreshDesktop = () => queryClient.invalidateQueries({ queryKey: ["furr", "files"] });
  const desktopApps = APPS.filter((a) => a.desktop && canLaunch(a, me.data?.permissions));
  const openDesktopFile = (f: FurrFile) =>
    f.isFolder ? openApp("explorer", { payload: { scope: "private", folder: f.path } }) : openFurrFile(f);

  // Entf deletes the selected desktop file/folder (only when no text field has focus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" || !selectedIcon) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true'], section[role='dialog']")) return;
      const file = desktopFiles.data?.find((f) => f.id === selectedIcon);
      if (file) setRemoving(file);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIcon, desktopFiles.data]);

  const fileMenuItems = (f: FurrFile): MenuItem[] => [
    { label: "Öffnen", onClick: () => openDesktopFile(f) },
    { label: "Umbenennen", onClick: () => setRenaming(f) },
    "divider",
    { label: "Löschen", danger: true, onClick: () => setRemoving(f) },
  ];

  const menuItems: MenuItem[] = [
    { label: "Neuer Ordner", onClick: () => setDialog("folder") },
    { label: "Neues Textdokument", onClick: () => setDialog("text") },
    { label: "Datei auf Desktop hochladen", onClick: () => uploadRef.current?.click() },
    "divider",
    { label: "Aktualisieren", onClick: () => void refreshDesktop() },
    { label: "In Terminal öffnen", onClick: () => openApp("terminal") },
    { label: "Task-Manager", onClick: () => openApp("taskmgr") },
    "divider",
    { label: "Hintergrund anpassen", onClick: () => openApp("settings") },
    { label: "Anzeigeeinstellungen", onClick: () => openApp("settings") },
  ];

  return (
    <div
      className={cn("relative h-dvh w-full overflow-hidden bg-cover bg-center text-fg", `wallpaper-${wallpaper}`)}
      style={{
        ...backgroundStyle,
        filter: [nightLight ? "sepia(0.18) saturate(0.9)" : "", brightness < 100 ? `brightness(${brightness / 100})` : ""].join(" ").trim() || undefined,
      }}
      onMouseDown={() => {
        closeMenus();
        setMenu(null);
        selectIcon(null);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) void uploadBrowserFiles(e.dataTransfer.files, "private", "Desktop").then(refreshDesktop);
      }}
    >
      <div className="absolute inset-x-0 top-0 bottom-12 z-10 flex flex-col flex-wrap content-start gap-1 p-3">
        {desktopApps.map((app) => {
          const Icon = app.icon;
          return (
            <button
              key={app.id}
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => selectIcon(app.id)}
              onDoubleClick={() => openApp(app.id)}
              className={cn("flex w-[76px] flex-col items-center gap-1 rounded-sm px-1 py-2 text-center", selectedIcon === app.id && "bg-accent/25")}
            >
              <Icon className="size-8 drop-shadow-sm" strokeWidth={1.4} />
              <span className="desk-label text-[11px] leading-tight">{app.name}</span>
            </button>
          );
        })}
        {desktopFiles.data?.map((f) => (
          <button
            key={f.id}
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => selectIcon(f.id)}
            onDoubleClick={() => openDesktopFile(f)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              selectIcon(f.id);
              setMenu({ x: e.clientX, y: e.clientY, file: f });
            }}
            className={cn("flex w-[76px] flex-col items-center gap-1 rounded-sm px-1 py-2 text-center", selectedIcon === f.id && "bg-accent/25")}
          >
            {f.isFolder ? <Folder className="size-8 text-accent drop-shadow-sm" strokeWidth={1.4} /> : <FileText className="size-8 drop-shadow-sm" strokeWidth={1.4} />}
            <span className="desk-label line-clamp-2 break-all text-[11px] leading-tight">{f.name}</span>
          </button>
        ))}
      </div>

      {windows.map((win) => (
        <WindowFrame key={win.id} win={win} />
      ))}

      <div onMouseDown={(e) => e.stopPropagation()}>
        {startOpen && <StartMenu />}
        {searchOpen && <SearchPanel />}
        {tray === "info" && <InfoCenter />}
        {tray === "clock" && <ClockFlyout now={now} />}
        {chatOpen && <ChatPanel />}
        <Toasts />
        <Taskbar now={now} />
      </div>
      <UpdatePopup />

      {menu && (
        <PopupMenu x={menu.x} y={menu.y} items={menu.file ? fileMenuItems(menu.file) : menuItems} onClose={() => setMenu(null)} />
      )}
      {renaming && (
        <div onMouseDown={(e) => e.stopPropagation()}>
          <PromptDialog
            title="Neuer Name"
            initial={renaming.name}
            confirmLabel="Umbenennen"
            onCancel={() => setRenaming(null)}
            onSubmit={async (name) => {
              const id = renaming.id;
              setRenaming(null);
              try {
                await renameEntry({ data: { id, name } });
                await refreshDesktop();
              } catch (error) {
                notifyError(error, "Umbenennen fehlgeschlagen");
              }
            }}
          />
        </div>
      )}
      {removing && (
        <div onMouseDown={(e) => e.stopPropagation()}>
          <ConfirmDialog
            title={`„${removing.name}“ löschen?`}
            body={removing.isFolder ? "Der Ordner und sein gesamter Inhalt werden gelöscht." : "Die Datei wird dauerhaft gelöscht."}
            onCancel={() => setRemoving(null)}
            onConfirm={async () => {
              const id = removing.id;
              setRemoving(null);
              selectIcon(null);
              try {
                await deleteEntry({ data: id });
                await refreshDesktop();
              } catch (error) {
                notifyError(error, "Löschen fehlgeschlagen");
              }
            }}
          />
        </div>
      )}
      {dialog && (
        <div onMouseDown={(e) => e.stopPropagation()}>
          <PromptDialog
            title={dialog === "folder" ? "Ordnername" : "Name des Textdokuments"}
            initial={dialog === "folder" ? "Neuer Ordner" : "Neues Textdokument.txt"}
            confirmLabel="Erstellen"
            onCancel={() => setDialog(null)}
            onSubmit={async (name) => {
              const kind = dialog;
              setDialog(null);
              try {
                if (kind === "folder") await createFolder({ data: { scope: "private", folder: "Desktop", name } });
                else openFurrFile(await saveTextFile({ data: { scope: "private", folder: "Desktop", name, content: "" } }));
                await refreshDesktop();
              } catch (error) {
                notifyError(error, "Erstellen fehlgeschlagen");
              }
            }}
          />
        </div>
      )}
      <input
        ref={uploadRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void uploadBrowserFiles(e.target.files, "private", "Desktop").then(refreshDesktop);
          e.target.value = "";
        }}
      />
    </div>
  );
}
