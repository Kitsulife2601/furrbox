import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useLiveInterval } from "@/lib/furr/live-interval";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Folder } from "lucide-react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { APPS, canLaunch, desktopAppIds, type AppId } from "@/lib/apps";
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
import { useChatboxStatus } from "@/components/furr/useChatboxStatus";
import { useVoteWatch } from "@/components/furr/useVoteWatch";
import { useDesktopShortcuts } from "./shortcuts";
import { ClipSavedListener } from "@/components/furr/ClipSettings";
import { ConfirmDialog, PopupMenu, PromptDialog, type MenuItem } from "@/components/furr/ui";
import { LockScreen } from "./LockScreen";
import { NoAccess } from "./NoAccess";
import { BootScreen } from "./BootScreen";
import { DesktopIcons } from "./DesktopIcons";
import { UpdatePopup } from "./UpdatePopup";
import { PowerOverlay } from "./Power";
import { Taskbar } from "./Taskbar";
import { SnapAssistPreview, WindowFrame } from "./WindowFrame";
import { AltTabSwitcher } from "./AltTab";
import { ClockFlyout, InfoCenter, SearchPanel, StartMenu, Toasts } from "./Flyouts";
import { StaffFlyout } from "./StaffTray";
import { VoteKickPanel } from "./VoteKickPanel";
import { CommandPalette } from "./CommandPalette";
import { WhatsNewDialog } from "./WhatsNew";

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
  const [booting, setBooting] = useState(true);
  const finishBoot = useCallback(() => setBooting(false), []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.setProperty("--os-accent", accent);
  }, [theme, accent]);

  const wallpaperLayout = useDesktop((s) => s.wallpaperLayout) ?? DEFAULT_WALLPAPER_LAYOUT;
  const bg = wallpaperStyle(wallpaperUrl, wallpaperLayout);

  // Auth stages from FurrBox: boot animation -> lock screen -> sign in -> desktop.
  if (booting) return <BootScreen ready={resolved} onDone={finishBoot} />;
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
  return <AccessGate backgroundStyle={bg} wallpaper={wallpaper} />;
}

/** Whitelist check: non-staff users need an entry on the FurrWhitelist (managed by the owner). */
function AccessGate({ backgroundStyle, wallpaper }: { backgroundStyle?: CSSProperties; wallpaper: string }) {
  const me = useMe();
  if (me.data && !me.data.hasAccess) {
    return <NoAccess me={me.data} onRetry={() => void me.refetch()} style={backgroundStyle} wallpaper={wallpaper} />;
  }
  return <DesktopShell backgroundStyle={backgroundStyle} />;
}

function DesktopShell({ backgroundStyle }: { backgroundStyle?: CSSProperties }) {
  const liveDesktop = useLiveInterval(10_000);
  const queryClient = useQueryClient();
  const me = useMe();
  const wallpaper = useDesktop((s) => s.wallpaper);
  const nightLight = useDesktop((s) => s.nightLight);
  const brightness = useDesktop((s) => s.brightness);
  const windows = useDesktop((s) => s.windows);
  const startOpen = useDesktop((s) => s.startOpen);
  const searchOpen = useDesktop((s) => s.searchOpen);
  const chatOpen = useDesktop((s) => s.chatOpen);
  const tray = useDesktop((s) => s.tray);
  const selectedIcon = useDesktop((s) => s.selectedIcon);
  const selectIcon = useDesktop((s) => s.selectIcon);
  const openApp = useDesktop((s) => s.openApp);
  const closeMenus = useDesktop((s) => s.closeMenus);
  const [menu, setMenu] = useState<{ x: number; y: number; file?: FurrFile; app?: AppId } | null>(null);
  const savedDesktopApps = useDesktop((s) => s.desktopApps);
  const setOnDesktop = useDesktop((s) => s.setOnDesktop);
  const arrangeIcons = useDesktop((s) => s.arrangeIcons);
  const [dialog, setDialog] = useState<null | "folder" | "text">(null);
  const [renaming, setRenaming] = useState<FurrFile | null>(null);
  const [removing, setRemoving] = useState<FurrFile | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  useFurrSync(true);
  useChatboxStatus();
  useVoteWatch();
  useDesktopShortcuts();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeMenus();
        setMenu(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeMenus]);

  // Desktop items live in the private FurrFS "Desktop" folder, so they sync across devices.
  const desktopFiles = useQuery({
    queryKey: filesKey("private", "Desktop"),
    queryFn: () => listFiles({ data: { scope: "private", folder: "Desktop" } }),
    refetchInterval: liveDesktop,
  });
  const refreshDesktop = () => queryClient.invalidateQueries({ queryKey: ["furr", "files"] });
  const desktopApps = desktopAppIds(savedDesktopApps)
    .map((id) => APPS.find((a) => a.id === id))
    .filter((a): a is (typeof APPS)[number] => Boolean(a && !a.hidden && canLaunch(a, me.data?.permissions)));
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
    { label: "Icons automatisch anordnen", onClick: () => arrangeIcons() },
    "divider",
    { label: "Aktualisieren", onClick: () => void refreshDesktop() },
    { label: "Terminal", onClick: () => openApp("terminal") },
    { label: "Tasks", onClick: () => openApp("taskmgr") },
    "divider",
    { label: "Personalisierung", onClick: () => openApp("settings") },
    { label: "Einstellungen", onClick: () => openApp("settings") },
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
      <DesktopIcons
        items={[
          ...desktopApps.map((app) => {
            const Icon = app.icon;
            return {
              id: app.id,
              label: app.name,
              icon: <Icon className="size-8 drop-shadow-sm" strokeWidth={1.4} />,
              onOpen: () => openApp(app.id),
              onContextMenu: (e: React.MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                selectIcon(app.id);
                setMenu({ x: e.clientX, y: e.clientY, app: app.id });
              },
            };
          }),
          ...(desktopFiles.data ?? []).map((f) => ({
            id: f.id,
            label: f.name,
            icon: f.isFolder ? (
              <Folder className="size-8 text-accent drop-shadow-sm" strokeWidth={1.4} />
            ) : (
              <FileText className="size-8 drop-shadow-sm" strokeWidth={1.4} />
            ),
            onOpen: () => openDesktopFile(f),
            onContextMenu: (e: React.MouseEvent) => {
              e.preventDefault();
              e.stopPropagation();
              selectIcon(f.id);
              setMenu({ x: e.clientX, y: e.clientY, file: f });
            },
          })),
        ]}
      />

      <SnapAssistPreview />
      {windows.map((win) => (
        <WindowFrame key={win.id} win={win} />
      ))}
      <AltTabSwitcher />
      <VoteKickPanel />
      <CommandPalette />
      <WhatsNewDialog />

      <div onMouseDown={(e) => e.stopPropagation()}>
        {startOpen && <StartMenu />}
        {searchOpen && <SearchPanel />}
        {tray === "info" && <InfoCenter />}
        {tray === "clock" && <ClockFlyout />}
        {tray === "staff" && <StaffFlyout />}
        {chatOpen && <ChatPanel />}
        <ClipSavedListener />
      <Toasts />
        <Taskbar />
      </div>
      <UpdatePopup />
      <PowerOverlay />

      {menu && (
        <PopupMenu x={menu.x} y={menu.y} items={
            menu.file
              ? fileMenuItems(menu.file)
              : menu.app
                ? [
                    { label: "Öffnen", onClick: () => openApp(menu.app!) },
                    "divider",
                    { label: "Vom Desktop entfernen", onClick: () => setOnDesktop(menu.app!, false) },
                  ]
                : menuItems
          } onClose={() => setMenu(null)} />
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
