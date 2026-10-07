import { UpdateTrayButton } from "./UpdatePopup";
import { StaffTrayButton } from "./StaffTray";
import { useNotifications } from "@/store/notifications";
import { useNow } from "@/lib/furr/live-interval";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Bell, MessageSquare, Search, Wifi, WifiOff } from "lucide-react";
import { APPS, canLaunch } from "@/lib/apps";
import { useMe } from "@/lib/furr/client";
import { cn } from "@/lib/utils";
import { useDesktop } from "@/store/desktop";
import { useSync } from "@/components/furr/useFurrSync";

function StartGlyph() {
  return (
    <span className="grid size-5 grid-cols-2 gap-0.5" aria-hidden>
      <span className="rounded-[2px] bg-[#7cc7ed]" />
      <span className="rounded-[2px] bg-[#4cc2ff]" />
      <span className="rounded-[2px] bg-[#3aa0d6]" />
      <span className="rounded-[2px] bg-[#7ad0ff]" />
    </span>
  );
}

function RunningDot({ focused, count }: { focused: boolean; count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn("taskbar-running", focused ? "w-5 bg-accent" : "w-2 bg-fg/55")}
      aria-hidden
    />
  );
}

export function Taskbar() {
  // HH:mm braucht keine Sekunden – isolierter Tick, kein Shell-Rerender.
  const now = useNow(30_000);
  const me = useMe();
  const windows = useDesktop((s) => s.windows);
  const focusedId = useDesktop((s) => s.focusedId);
  const startOpen = useDesktop((s) => s.startOpen);
  const searchOpen = useDesktop((s) => s.searchOpen);
  const chatOpen = useDesktop((s) => s.chatOpen);
  const tray = useDesktop((s) => s.tray);
  const desktopPeek = useDesktop((s) => s.desktopPeek);
  const toggleStart = useDesktop((s) => s.toggleStart);
  const toggleSearch = useDesktop((s) => s.toggleSearch);
  const toggleChat = useDesktop((s) => s.toggleChat);
  const setTray = useDesktop((s) => s.setTray);
  const openApp = useDesktop((s) => s.openApp);
  const restoreWindow = useDesktop((s) => s.restoreWindow);
  const focusWindow = useDesktop((s) => s.focusWindow);
  const minimizeWindow = useDesktop((s) => s.minimizeWindow);
  const toggleShowDesktop = useDesktop((s) => s.toggleShowDesktop);
  const connected = useSync((s) => s.connected);
  const unread = useSync((s) => s.unreadChat);
  // Neue Benachrichtigungen seit dem letzten Öffnen des Info-Centers (Windows-Badge).
  const newNotes = useNotifications((n) => n.history.filter((h) => h.createdAt > n.seenAt).length);

  const pinned = APPS.filter((a) => a.pinned && canLaunch(a, me.data?.permissions));
  // Running windows of apps that aren't pinned (viewer, editor, task manager) get their own buttons.
  const extra = windows.filter((w) => !pinned.some((p) => p.id === w.appId));

  function toggleWindow(id: string) {
    const win = windows.find((w) => w.id === id);
    if (!win) return;
    if (win.minimized) restoreWindow(id);
    else if (focusedId === id) minimizeWindow(id);
    else focusWindow(id);
  }

  return (
    <footer className="mica absolute inset-x-0 bottom-0 z-[70] flex h-12 items-center justify-between px-2">
      <div className="hidden w-28 sm:block" />
      <nav className="flex min-w-0 items-center gap-1 overflow-x-auto">
        <button type="button" aria-label="Start" onClick={toggleStart} className={cn("grid size-11 shrink-0 place-items-center rounded-md hover:bg-fg/8", startOpen && "bg-fg/10")}>
          <StartGlyph />
        </button>
        <button type="button" aria-label="Suchen" onClick={toggleSearch} className={cn("grid size-11 shrink-0 place-items-center rounded-md hover:bg-fg/8", searchOpen && "bg-fg/10")}>
          <Search className="size-5" />
        </button>
        {pinned.map((app, i) => {
          const Icon = app.icon;
          const running = windows.filter((w) => w.appId === app.id);
          const focused = running.some((w) => w.id === focusedId && !w.minimized);
          return (
            <button
              key={app.id}
              type="button"
              aria-label={app.name}
              title={app.name}
              onClick={() => (running[0] ? toggleWindow(running[0].id) : openApp(app.id))}
              className={cn(
                "relative grid size-11 shrink-0 place-items-center rounded-md hover:bg-fg/8",
                focused && "bg-fg/10",
                i > 2 && "hidden sm:grid",
              )}
            >
              <Icon className="size-5" strokeWidth={1.6} />
              <RunningDot focused={focused} count={running.length} />
            </button>
          );
        })}
        {extra.map((w) => {
          const Icon = APPS.find((a) => a.id === w.appId)?.icon ?? Search;
          const focused = w.id === focusedId && !w.minimized;
          return (
            <button
              key={w.id}
              type="button"
              title={w.title}
              aria-label={w.title}
              onClick={() => toggleWindow(w.id)}
              className={cn("relative grid size-11 shrink-0 place-items-center rounded-md hover:bg-fg/8", focused && "bg-fg/10")}
            >
              <Icon className="size-5" strokeWidth={1.6} />
              <RunningDot focused={focused} count={1} />
            </button>
          );
        })}
      </nav>
      <div className="flex items-center gap-0.5 pr-0">
        <StaffTrayButton />
        <UpdateTrayButton />
        <button
          type="button"
          aria-label="FurrChat öffnen"
          onClick={() => toggleChat()}
          className={cn("relative grid size-10 place-items-center rounded-md hover:bg-fg/8", chatOpen && "bg-fg/10")}
        >
          <MessageSquare className="size-4" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-fg">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
        <button
          type="button"
          aria-label="Info-Center öffnen"
          onClick={() => setTray("info")}
          className={cn("relative flex h-10 items-center gap-2 rounded-md px-2 hover:bg-fg/8", tray === "info" && "bg-fg/10")}
          title={connected ? "Secure Sync online" : "Nicht verbunden"}
        >
          {connected ? <Wifi className="size-4" /> : <WifiOff className="size-4 text-red-300" />}
          <Bell className="size-4" />
          {newNotes > 0 && tray !== "info" && (
            <span key={newNotes} className="furr-vr-pop absolute right-0.5 top-1 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-fg">
              {newNotes > 9 ? "9+" : newNotes}
            </span>
          )}
        </button>
        <button
          type="button"
          aria-label="Uhr und Kalender"
          onClick={() => setTray("clock")}
          className={cn("h-10 rounded-md px-2 text-right leading-tight hover:bg-fg/8", tray === "clock" && "bg-fg/10")}
        >
          <p className="text-[12px] font-medium tabular-nums">{format(now, "HH:mm")}</p>
          <p className="text-[11px] text-muted">{format(now, "dd.MM.yyyy", { locale: de })}</p>
        </button>
        <button
          type="button"
          aria-label="Desktop anzeigen"
          title="Desktop anzeigen"
          data-active={desktopPeek ? "true" : "false"}
          onClick={toggleShowDesktop}
          className="furr-show-desktop"
        />
      </div>
    </footer>
  );
}
