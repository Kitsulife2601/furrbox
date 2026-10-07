import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useNow } from "@/lib/furr/live-interval";
import { de } from "date-fns/locale";
import {
  AlertTriangle,
  Download,
  FileWarning,
  Info,
  MessageSquare,
  Moon,
  Search,
  Settings2,
  ShieldCheck,
  Sun,
  UserCheck,
  Video,
  Volume2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { APPS, canLaunch, desktopAppIds, groupApps, type AppId } from "@/lib/apps";
import { PopupMenu } from "@/components/furr/ui";
import { recentFiles, searchFiles } from "@/lib/furr/api/files";
import { timeAgo, useMe } from "@/lib/furr/client";
import { cn } from "@/lib/utils";
import { useDesktop } from "@/store/desktop";
import { playSound, useSounds } from "@/lib/furr/sounds";
import { NOTIFY_KIND_LABEL, kindOf, useNotifications, type NotifyKind } from "@/store/notifications";
import { openFurrFile } from "@/components/furr/FurrFS";
import { useSync } from "@/components/furr/useFurrSync";
import { PowerButton } from "./Power";

function useLaunchableApps() {
  const me = useMe();
  return APPS.filter((a) => !a.hidden && canLaunch(a, me.data?.permissions));
}

/** Right-click on an app in the start menu / search: open it, put it on or take it off the desktop. */
function useAppMenu() {
  const openApp = useDesktop((s) => s.openApp);
  const saved = useDesktop((s) => s.desktopApps);
  const setOnDesktop = useDesktop((s) => s.setOnDesktop);
  const [menu, setMenu] = useState<{ x: number; y: number; app: AppId } | null>(null);
  const onDesktop = (id: AppId) => desktopAppIds(saved).includes(id);
  const open = (e: React.MouseEvent, app: AppId) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, app });
  };
  const element = menu && (
    <PopupMenu
      x={menu.x}
      y={menu.y}
      onClose={() => setMenu(null)}
      items={[
        { label: "Öffnen", onClick: () => openApp(menu.app) },
        "divider",
        onDesktop(menu.app)
          ? { label: "Vom Desktop entfernen", onClick: () => setOnDesktop(menu.app, false) }
          : { label: "Zum Desktop hinzufügen", onClick: () => setOnDesktop(menu.app, true) },
      ]}
    />
  );
  return { open, element };
}

function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn("grid size-8 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-fg", className)}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export function StartMenu() {
  const me = useMe();
  const openApp = useDesktop((s) => s.openApp);
  const lock = useDesktop((s) => s.lock);
  const searchQuery = useDesktop((s) => s.searchQuery);
  const setSearchQuery = useDesktop((s) => s.setSearchQuery);
  const apps = useLaunchableApps();
  const recent = useQuery({ queryKey: ["furr", "recent"], queryFn: () => recentFiles() });
  const q = searchQuery.trim().toLowerCase();
  const shown = q
    ? apps.filter((a) => a.name.toLowerCase().includes(q) || a.subtitle.toLowerCase().includes(q))
    : apps;
  const groups = groupApps(shown);
  const appMenu = useAppMenu();

  function AppTile({ app }: { app: (typeof apps)[number] }) {
    const Icon = app.icon;
    return (
      <button
        type="button"
        onClick={() => openApp(app.id)}
        onContextMenu={(e) => appMenu.open(e, app.id)}
        title={`${app.subtitle} · Rechtsklick: Desktop`}
        className="flex flex-col items-center gap-1.5 rounded-lg px-2 py-2.5 hover:bg-fg/8"
      >
        <span className="grid size-11 place-items-center rounded-xl bg-elevated shadow-sm">
          <Icon className="size-5 text-accent" strokeWidth={1.6} />
        </span>
        <span className="line-clamp-2 text-center text-[11px] leading-snug">{app.name}</span>
      </button>
    );
  }

  return (
    <div className="mica furr-flyout-in absolute bottom-14 left-1/2 z-[80] w-[min(680px,calc(100%-1rem))] -translate-x-1/2 overflow-hidden rounded-xl p-4">
      <div className="flex items-center gap-2 rounded-full bg-bg/70 px-3 py-2">
        <Search className="size-4 text-subtle" />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Apps durchsuchen"
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-subtle"
        />
      </div>
      {appMenu.element}
      <div className="mt-3 max-h-[min(420px,52vh)] space-y-3 overflow-auto pr-1">
        {groups.map((g) => (
          <div key={g.id}>
            <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{g.label}</p>
            <div className="mt-1.5 grid grid-cols-3 gap-1 sm:grid-cols-5">
              {g.apps.map((app) => (
                <AppTile key={app.id} app={app} />
              ))}
            </div>
          </div>
        ))}
        {!groups.length && <p className="px-2 py-4 text-center text-[12px] text-subtle">Keine Apps gefunden.</p>}
      </div>
      {!searchQuery && (
        <>
          <p className="mt-4 text-[12px] font-medium text-muted">Zuletzt verwendet</p>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            {!recent.data?.length && <p className="px-2 text-[12px] text-subtle">Noch keine Dateien im Verlauf.</p>}
            {recent.data?.slice(0, 6).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => openFurrFile(f)}
                className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-fg/8"
              >
                <span className="min-w-0 flex-1 truncate text-[13px]">{f.name}</span>
                <span className="shrink-0 text-[11px] text-subtle">{timeAgo(f.updatedAt)}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
        <div className="flex items-center gap-2 text-[13px]">
          <Avatar name={me.data?.displayName ?? "?"} />
          <span>
            {me.data?.displayName ?? "…"}
            <span className="block text-[11px] text-muted">{me.data?.roleLabel}</span>
          </span>
        </div>
        <div className="flex gap-1">
          <button type="button" aria-label="Einstellungen" onClick={() => openApp("settings")} className="grid size-10 place-items-center rounded-md hover:bg-fg/8">
            <Settings2 className="size-4" />
          </button>
          <PowerButton />
        </div>
      </div>
    </div>
  );
}

/** Deep Search: apps + FurrFS file names. */
export function SearchPanel() {
  const openApp = useDesktop((s) => s.openApp);
  const searchQuery = useDesktop((s) => s.searchQuery);
  const setSearchQuery = useDesktop((s) => s.setSearchQuery);
  const apps = useLaunchableApps().filter((a) => a.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const appMenu = useAppMenu();
  const files = useQuery({
    queryKey: ["furr", "search", searchQuery],
    queryFn: () => searchFiles({ data: searchQuery }),
    enabled: searchQuery.trim().length >= 2,
  });

  return (
    <div className="mica furr-flyout-in absolute bottom-14 left-1/2 z-[80] w-[min(560px,calc(100%-1rem))] -translate-x-1/2 rounded-xl p-4">
      <div className="flex items-center gap-2 rounded-full bg-bg/70 px-3 py-2">
        <Search className="size-4 text-subtle" />
        <input
          autoFocus
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Apps und Dateien suchen"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </div>
      {appMenu.element}
      <p className="mt-3 text-[12px] font-medium text-muted">Apps</p>
      <ul className="mt-1 space-y-0.5">
        {apps.map((app) => {
          const Icon = app.icon;
          return (
            <li key={app.id}>
              <button
                type="button"
                onClick={() => openApp(app.id)}
                onContextMenu={(e) => appMenu.open(e, app.id)}
                className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-fg/8"
              >
                <Icon className="size-4 text-accent" />
                <span className="text-[13px]">{app.name}</span>
                <span className="ml-auto text-[11px] text-subtle">{app.subtitle}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {searchQuery.trim().length >= 2 && (
        <>
          <p className="mt-3 text-[12px] font-medium text-muted">Dateien</p>
          <ul className="mt-1 max-h-56 space-y-0.5 overflow-auto">
            {!files.data?.length && <li className="px-2 text-[12px] text-subtle">{files.isFetching ? "Suche…" : "Keine Treffer gefunden."}</li>}
            {files.data?.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => (f.isFolder ? openApp("explorer", { payload: { scope: f.scope, folder: f.path } }) : openFurrFile(f))}
                  className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-fg/8"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px]">{f.name}</span>
                  <span className="max-w-[45%] shrink-0 truncate text-[11px] text-subtle">
                    {f.scope === "public" ? "Shared" : "Privat"}/{f.folder}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const KIND_ICON: Record<NotifyKind, LucideIcon> = {
  vote: AlertTriangle,
  whitelist: ShieldCheck,
  incident: FileWarning,
  duty: UserCheck,
  chat: MessageSquare,
  clip: Video,
  update: Download,
  system: Info,
};

const KIND_TINT: Record<NotifyKind, string> = {
  vote: "text-red-300",
  whitelist: "text-emerald-300",
  incident: "text-amber-300",
  duty: "text-emerald-300",
  chat: "text-accent",
  clip: "text-violet-300",
  update: "text-accent",
  system: "text-muted",
};

/** Info-Center: Sync-Status, Schnellregler, Benachrichtigungen gruppiert/filterbar (wie Windows). */
export function InfoCenter() {
  const s = useDesktop();
  const soundVolume = useSounds((x) => x.volume);
  const setSoundVolume = useSounds((x) => x.setVolume);
  const sync = useSync();
  const history = useNotifications((n) => n.history);
  const clearHistory = useNotifications((n) => n.clearHistory);
  const removeHistory = useNotifications((n) => n.removeHistory);
  const markSeen = useNotifications((n) => n.markSeen);
  const [filter, setFilter] = useState<NotifyKind | "all">("all");

  // Beim Öffnen + Schließen als gelesen markieren (Badge in der Taskleiste).
  useEffect(() => {
    markSeen();
    return () => markSeen();
  }, [markSeen]);

  const counts = useMemo(() => {
    const c: Partial<Record<NotifyKind, number>> = {};
    for (const n of history) c[kindOf(n)] = (c[kindOf(n)] ?? 0) + 1;
    return c;
  }, [history]);
  const kinds = (Object.keys(NOTIFY_KIND_LABEL) as NotifyKind[]).filter((k) => counts[k]);
  const shown = filter === "all" ? history : history.filter((n) => kindOf(n) === filter);
  const startOfDay = new Date().setHours(0, 0, 0, 0);
  const groups = [
    { label: "Heute", items: shown.filter((n) => n.createdAt >= startOfDay) },
    { label: "Früher", items: shown.filter((n) => n.createdAt < startOfDay) },
  ].filter((g) => g.items.length);

  return (
    <div className="mica furr-flyout-in absolute bottom-14 right-2 z-[80] flex max-h-[calc(100%-4.5rem)] w-[min(380px,calc(100%-1rem))] flex-col rounded-xl p-3">
      <div className="flex items-center justify-between rounded-md bg-elevated/60 px-3 py-2 text-[12px]">
        <span className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full", sync.connected ? "bg-emerald-400" : "bg-danger")} />
          {sync.connected ? "Secure Sync online" : "Nicht verbunden – verbinde neu…"}
        </span>
        {sync.lastSyncAt && <span className="text-muted">{format(new Date(sync.lastSyncAt), "HH:mm:ss")}</span>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={s.toggleNightLight}
          className={cn("flex items-center gap-2 rounded-md px-3 py-3 text-left text-[12px]", s.nightLight ? "bg-accent text-accent-fg" : "bg-elevated")}
        >
          <Moon className="size-4" /> Nachtlicht
        </button>
        <button type="button" onClick={() => s.openApp("settings")} className="flex items-center gap-2 rounded-md bg-elevated px-3 py-3 text-left text-[12px]">
          <Settings2 className="size-4" /> Einstellungen
        </button>
      </div>
      <label className="mt-3 flex items-center gap-3 px-1 text-muted">
        <Sun className="size-4" />
        <input type="range" min={40} max={100} value={s.brightness} onChange={(e) => s.setBrightness(Number(e.target.value))} className="w-full accent-[var(--os-accent)]" />
      </label>
      <label className="mt-2 flex items-center gap-3 px-1 text-muted">
        <Volume2 className="size-4" />
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={soundVolume}
          aria-label="Lautstärke der FurrBox-Töne"
          title="Lautstärke der FurrBox-Töne"
          onChange={(e) => setSoundVolume(Number(e.target.value))}
          onPointerUp={() => playSound("chat", { force: true })}
          className="w-full accent-[var(--os-accent)]"
        />
      </label>
      <div className="mt-3 flex items-center justify-between">
        <p className="text-[12px] font-medium text-muted">Benachrichtigungen</p>
        {shown.length > 0 && (
          <button type="button" className="text-[11px] text-muted hover:text-fg" onClick={() => clearHistory(filter === "all" ? undefined : filter)}>
            {filter === "all" ? "Alle löschen" : `${NOTIFY_KIND_LABEL[filter]} löschen`}
          </button>
        )}
      </div>
      {kinds.length > 1 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {(["all", ...kinds] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                filter === k ? "border-accent bg-accent/15 text-fg" : "border-border text-muted hover:text-fg",
              )}
            >
              {k === "all" ? `Alle ${history.length}` : `${NOTIFY_KIND_LABEL[k]} ${counts[k]}`}
            </button>
          ))}
        </div>
      )}
      <div className="mt-1.5 min-h-0 flex-1 space-y-2 overflow-auto">
        {!shown.length && <p className="px-1 py-3 text-[12px] text-subtle">Keine Benachrichtigungen.</p>}
        {groups.map((g) => (
          <div key={g.label}>
            <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-subtle">{g.label}</p>
            <ul className="space-y-1">
              {g.items.map((n) => {
                const kind = kindOf(n);
                const Icon = KIND_ICON[kind];
                return (
                  <li key={n.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => n.onClick?.()}
                      className={cn(
                        "flex w-full gap-2.5 rounded-md bg-elevated/50 px-3 py-2 text-left transition-colors hover:bg-elevated",
                        n.tone === "error" && "border-l-2 border-danger",
                        n.tone === "alert" && "border-l-2 border-red-400",
                      )}
                    >
                      <Icon className={cn("mt-0.5 size-4 shrink-0", KIND_TINT[kind])} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11px] text-subtle">
                          {n.version} · {format(n.createdAt, "HH:mm")}
                        </span>
                        <span className="block text-[13px] font-medium">{n.title}</span>
                        <span className="block text-[12px] text-muted">{n.description}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label="Benachrichtigung entfernen"
                      onClick={() => removeHistory(n.id)}
                      className="absolute right-1.5 top-1.5 hidden size-6 place-items-center rounded text-muted hover:bg-fg/10 hover:text-fg group-hover:grid"
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ClockFlyout() {
  const now = useNow(1_000);
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return (
    <div className="mica furr-flyout-in absolute bottom-14 right-2 z-[80] w-[min(320px,calc(100%-1rem))] rounded-xl p-4">
      <p className="text-3xl font-medium tabular-nums">{format(now, "HH:mm:ss")}</p>
      <p className="mt-1 text-sm capitalize text-muted">{format(now, "EEEE, d. MMMM yyyy", { locale: de })}</p>
      <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[11px] text-subtle">
        {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((d) => (
          <span key={d}>{d}</span>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <span key={`e${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
          <span key={d} className={cn("grid aspect-square place-items-center rounded-full", d === now.getDate() && "bg-accent text-accent-fg")}>
            {d}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Toast stack (FurrNotification). */
export function Toasts() {
  const toasts = useNotifications((n) => n.toasts);
  const dismiss = useNotifications((n) => n.dismiss);
  return (
    <div className="pointer-events-none absolute bottom-14 right-2 z-[90] grid w-[min(340px,calc(100%-1rem))] gap-2">
      {toasts.map((t) => {
        const kind = kindOf(t);
        const Icon = KIND_ICON[kind];
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              if (t.exiting) return;
              t.onClick?.();
              dismiss(t.id);
            }}
            className={cn(
              "mica pointer-events-auto relative flex gap-2.5 overflow-hidden rounded-lg px-3 py-2.5 text-left",
              t.exiting ? "furr-toast-out" : "furr-toast-in",
              t.tone === "error" && "border-l-2 border-danger",
              t.tone === "success" && "border-l-2 border-emerald-400",
              t.tone === "alert" && "border-l-2 border-red-400",
            )}
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0", t.tone === "error" ? "text-red-300" : KIND_TINT[kind])} />
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] text-subtle">{t.version}</span>
              <span className="block text-[13px] font-medium">{t.title}</span>
              <span className="line-clamp-4 block whitespace-pre-line text-[12px] text-muted">{t.description}</span>
              {t.actionLabel && (
                <span className="mt-1.5 inline-flex rounded-md bg-accent/20 px-2 py-0.5 text-[12px] font-semibold text-accent">{t.actionLabel}</span>
              )}
            </span>
            {t.durationMs && t.actionLabel && !t.exiting && (
              <span
                aria-hidden
                className="furr-toast-timer absolute inset-x-0 bottom-0 h-0.5 origin-left bg-accent/70"
                style={{ animationDuration: `${t.durationMs}ms` }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
