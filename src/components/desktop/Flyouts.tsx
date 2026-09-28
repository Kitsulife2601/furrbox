import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Lock, Moon, Search, Settings2, Sun, Volume2 } from "lucide-react";
import { APPS, canLaunch } from "@/lib/apps";
import { recentFiles, searchFiles } from "@/lib/furr/api/files";
import { timeAgo, useMe } from "@/lib/furr/client";
import { cn } from "@/lib/utils";
import { useDesktop } from "@/store/desktop";
import { useNotifications } from "@/store/notifications";
import { openFurrFile } from "@/components/furr/FurrFS";
import { useSync } from "@/components/furr/useFurrSync";

function useLaunchableApps() {
  const me = useMe();
  return APPS.filter((a) => !a.hidden && canLaunch(a, me.data?.permissions));
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
  const shown = searchQuery ? apps.filter((a) => a.name.toLowerCase().includes(searchQuery.toLowerCase())) : apps;

  return (
    <div className="mica absolute bottom-14 left-1/2 z-[80] w-[min(640px,calc(100%-1rem))] -translate-x-1/2 overflow-hidden rounded-xl p-4">
      <div className="flex items-center gap-2 rounded-full bg-bg/70 px-3 py-2">
        <Search className="size-4 text-subtle" />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Apps durchsuchen"
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-subtle"
        />
      </div>
      <p className="mt-4 text-[12px] font-medium text-muted">Apps</p>
      <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
        {shown.map((app) => {
          const Icon = app.icon;
          return (
            <button
              key={app.id}
              type="button"
              onClick={() => openApp(app.id)}
              className="flex flex-col items-center gap-2 rounded-md px-2 py-3 hover:bg-fg/8"
            >
              <span className="grid size-10 place-items-center rounded-md bg-elevated">
                <Icon className="size-5 text-accent" strokeWidth={1.6} />
              </span>
              <span className="text-center text-[11px] leading-tight">{app.name}</span>
            </button>
          );
        })}
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
          <button type="button" aria-label="Sperren" onClick={lock} className="grid size-10 place-items-center rounded-md hover:bg-fg/8">
            <Lock className="size-4" />
          </button>
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
  const files = useQuery({
    queryKey: ["furr", "search", searchQuery],
    queryFn: () => searchFiles({ data: searchQuery }),
    enabled: searchQuery.trim().length >= 2,
  });

  return (
    <div className="mica absolute bottom-14 left-1/2 z-[80] w-[min(560px,calc(100%-1rem))] -translate-x-1/2 rounded-xl p-4">
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
      <p className="mt-3 text-[12px] font-medium text-muted">Apps</p>
      <ul className="mt-1 space-y-0.5">
        {apps.map((app) => {
          const Icon = app.icon;
          return (
            <li key={app.id}>
              <button type="button" onClick={() => openApp(app.id)} className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-fg/8">
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

/** Info-Center: sync status, quick sliders, notification history. */
export function InfoCenter() {
  const s = useDesktop();
  const sync = useSync();
  const history = useNotifications((n) => n.history);
  const clearHistory = useNotifications((n) => n.clearHistory);

  return (
    <div className="mica absolute bottom-14 right-2 z-[80] flex max-h-[calc(100%-4.5rem)] w-[min(360px,calc(100%-1rem))] flex-col rounded-xl p-3">
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
        <input type="range" min={0} max={100} value={s.volume} onChange={(e) => s.setVolume(Number(e.target.value))} className="w-full accent-[var(--os-accent)]" />
      </label>
      <div className="mt-3 flex items-center justify-between">
        <p className="text-[12px] font-medium text-muted">Benachrichtigungen</p>
        {history.length > 0 && (
          <button type="button" className="text-[11px] text-muted hover:text-fg" onClick={clearHistory}>
            Alle löschen
          </button>
        )}
      </div>
      <ul className="mt-1 min-h-0 flex-1 space-y-1 overflow-auto">
        {!history.length && <li className="px-1 py-3 text-[12px] text-subtle">Keine Benachrichtigungen.</li>}
        {history.map((n) => (
          <li key={n.id}>
            <button type="button" onClick={() => n.onClick?.()} className="w-full rounded-md bg-elevated/50 px-3 py-2 text-left">
              <p className="text-[11px] text-subtle">
                {n.version} · {format(n.createdAt, "HH:mm")}
              </p>
              <p className="text-[13px] font-medium">{n.title}</p>
              <p className="text-[12px] text-muted">{n.description}</p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ClockFlyout({ now }: { now: Date }) {
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return (
    <div className="mica absolute bottom-14 right-2 z-[80] w-[min(320px,calc(100%-1rem))] rounded-xl p-4">
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
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => {
            t.onClick?.();
            dismiss(t.id);
          }}
          className="mica pointer-events-auto rounded-lg px-3 py-2.5 text-left"
        >
          <p className="text-[11px] text-subtle">{t.version}</p>
          <p className="text-[13px] font-medium">{t.title}</p>
          <p className="line-clamp-3 text-[12px] text-muted">{t.description}</p>
        </button>
      ))}
    </div>
  );
}
