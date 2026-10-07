// Desktop-app updates (GitHub Releases via electron-updater in desktop/main.cjs):
// Windows-like toast + corner banner while an update downloads / is ready, then restart to install.
import { playSound } from "@/lib/furr/sounds";
import { MOTION } from "@/lib/furr/motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { getAppBuild } from "@/lib/furr/api/session";
import { Download } from "lucide-react";
import { useNotifications } from "@/store/notifications";
import UPDATES from "@/lib/furr/updates.json";

const UPDATE_LIST = UPDATES as { version?: string; items: string[]; date?: string; title?: string }[];

export type UpdateState = {
  status: "idle" | "unsupported" | "checking" | "current" | "downloading" | "ready" | "error";
  version: string;
  newVersion?: string;
  percent?: number;
  notes?: string;
  error?: string;
  checkedAt?: string;
};

type UpdateBridge = {
  getState(): Promise<UpdateState>;
  check(): Promise<UpdateState>;
  install(): Promise<boolean>;
  onChange(callback: (state: UpdateState) => void): () => void;
};

export function updateBridge(): UpdateBridge | null {
  if (typeof window === "undefined") return null;
  return (window as { furrbox?: { update?: UpdateBridge } }).furrbox?.update ?? null;
}

/** Current updater state of the desktop app (null in the web version). */
export function useUpdateState() {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    const bridge = updateBridge();
    if (!bridge) return;
    void bridge.getState().then(setState);
    return bridge.onChange(setState);
  }, []);
  return state;
}

// ---------- Server updates (new FurrBox deploy on the central server) ----------

export type UpdateEntry = { date: string; version?: string; title: string; items: string[] };

type ServerUpdate = {
  status: "idle" | "checking" | "current" | "available" | "error";
  /** Update entries the running app doesn't know yet. */
  news: UpdateEntry[];
  checkedAt: string | null;
  check: () => Promise<void>;
};

const entryKey = (u: UpdateEntry) => `${u.date}|${u.title}`;

const GITHUB_REPO = "Kitsulife2601/furrbox";
const SHA = /^[0-9a-f]{40}$/;

/** Strip optional leading v so 2.0.27 and v2.0.27 match. */
export function normVersion(v: string): string {
  return String(v ?? "").trim().replace(/^v/i, "");
}

/** Markdown/HTML release body → short bullet texts. */
export function parseReleaseBody(notes: string): string[] {
  return String(notes ?? "")
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((line) =>
      line
        .replace(/<[^>]+>/g, "")
        .replace(/^#{1,6}\s*/, "")
        .replace(/^[-*•–—]\s+/, "")
        .replace(/^\d+[.)]\s+/, "")
        .trim(),
    )
    .filter((line) => line.length > 0 && !/^FurrBox Update$/i.test(line));
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function entryFromUpdatesJson(version: string): UpdateEntry | undefined {
  const nv = normVersion(version);
  const raw = UPDATE_LIST.find((u) => u.version && normVersion(u.version) === nv);
  if (!raw) return undefined;
  return {
    date: raw.date ?? todayDate(),
    version: raw.version ?? nv,
    title: raw.title ?? `Version ${nv}`,
    items: Array.isArray(raw.items) ? raw.items : [],
  };
}

function entryFromNotes(version: string, notes: string, titleHint?: string): UpdateEntry | null {
  const items = parseReleaseBody(notes);
  if (!items.length) return null;
  const nv = normVersion(version);
  const json = entryFromUpdatesJson(nv);
  return {
    date: json?.date ?? todayDate(),
    version: nv,
    title: titleHint || json?.title || `Version ${nv}`,
    items,
  };
}

/** Live GitHub release body for the target tag (vX.Y.Z). */
export async function fetchGithubReleaseEntry(version: string): Promise<UpdateEntry | null> {
  const nv = normVersion(version);
  for (const tag of [`v${nv}`, nv]) {
    try {
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${tag}`, {
        headers: { accept: "application/vnd.github+json" },
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { body?: string; name?: string; published_at?: string };
      const hint = data.name?.replace(/^FurrBox\s+/i, "").trim();
      const entry = entryFromNotes(nv, String(data.body ?? ""), hint);
      if (entry) {
        if (data.published_at) entry.date = data.published_at.slice(0, 10);
        return entry;
      }
    } catch {
      /* try next tag */
    }
  }
  return null;
}

/**
 * Changelog for a desktop target version.
 * Primary: GitHub release body (via electron-updater notes); fallback: updates.json; then live GitHub API.
 */
export function resolveDesktopChangelogSync(version: string, notes?: string): UpdateEntry[] {
  const fromNotes = notes?.trim() ? entryFromNotes(version, notes) : null;
  if (fromNotes) return [fromNotes];
  const fromJson = entryFromUpdatesJson(version);
  return fromJson ? [fromJson] : [];
}

/** Sync notes/json first; if empty, fetch GitHub release body once. */
export function useDesktopChangelog(version?: string, notes?: string): UpdateEntry[] {
  const sync = useMemo(
    () => (version ? resolveDesktopChangelogSync(version, notes) : []),
    [version, notes],
  );
  const [remote, setRemote] = useState<UpdateEntry[]>([]);
  useEffect(() => {
    if (!version || sync.length > 0) {
      setRemote([]);
      return;
    }
    let cancelled = false;
    void fetchGithubReleaseEntry(version).then((entry) => {
      if (!cancelled && entry) setRemote([entry]);
    });
    return () => {
      cancelled = true;
    };
  }, [version, notes, sync.length]);
  return sync.length > 0 ? sync : remote;
}


/**
 * What changed between the running build and the server's build, straight from the GitHub
 * commits (one entry per commit: title = first line, items = its "- " bullet lines).
 * Returns null when GitHub can't answer (then updates.json is used instead).
 */
async function githubChanges(from: string, to: string): Promise<UpdateEntry[] | null> {
  if (!SHA.test(from) || !SHA.test(to)) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/compare/${from}...${to}`, {
      headers: { accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      commits?: { commit: { message: string; author?: { date?: string } }; parents?: unknown[] }[];
    };
    return (data.commits ?? [])
      .filter((c) => (c.parents?.length ?? 1) <= 1)
      .reverse()
      .map((c) => {
        const raw = c.commit.message.split("\n");
        const lines = raw.map((l) => l.trim());
        // "- " starts a point; indented lines right after it continue that point.
        const items: string[] = [];
        let inItem = false;
        for (const line of raw) {
          if (/^[-*] /.test(line)) {
            items.push(line.slice(2).trim());
            inItem = true;
          } else if (inItem && /^\s+\S/.test(line)) {
            items[items.length - 1] += ` ${line.trim()}`;
          } else {
            inItem = false;
          }
        }
        return {
          date: (c.commit.author?.date ?? new Date().toISOString()).slice(0, 10),
          title: lines[0] ?? "Update",
          items: items.length ? items : [lines[0] ?? "Verbesserungen"],
        };
      });
  } catch {
    return null;
  }
}

export const useServerUpdate = create<ServerUpdate>((set, get) => ({
  status: "idle",
  news: [],
  checkedAt: null,
  check: async () => {
    if (get().status === "checking") return;
    set({ status: get().status === "available" ? "available" : "checking" });
    try {
      const server = await getAppBuild();
      const available = server.build !== __FURRBOX_BUILD__;
      let news: UpdateEntry[] = [];
      if (available) {
        const known = new Set(UPDATE_LIST.map((u) => entryKey(u as UpdateEntry)));
        news =
          (await githubChanges(__FURRBOX_BUILD__, server.build)) ??
          server.updates.filter((u) => !known.has(entryKey(u)));
      }
      set({ status: available ? "available" : "current", news, checkedAt: new Date().toISOString() });
    } catch {
      set({ status: "error", checkedAt: new Date().toISOString() });
    }
  },
}));

/** Short, scannable bullet for changelog UI (title stays full; details get trimmed). */
export function shortPoint(text: string, max = 92): string {
  const t = text
    .replace(/^–\s*/, "")
    .replace(/^-\s*/, "")
    .replace(/^Neu:\s*/i, "")
    .replace(/^Behoben:\s*/i, "")
    .trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 36 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

/** Flat list for tooltips / short previews. Prefer ChangelogEntries for Settings UI. */
export function newsLines(news: UpdateEntry[]) {
  return news.flatMap((u) =>
    u.items.length === 1 && u.items[0] === u.title ? [u.title] : [u.title, ...u.items.map((i) => `– ${i}`)],
  );
}

/** Preview bullets for toast/banner: titles first, then short item points (max N). */
export function newsPreview(news: UpdateEntry[], max = 4): string[] {
  const out: string[] = [];
  for (const u of news) {
    if (out.length >= max) break;
    if (u.title) out.push(shortPoint(u.title, 72));
    for (const item of u.items) {
      if (out.length >= max) break;
      if (item === u.title) continue;
      out.push(shortPoint(item, 80));
    }
  }
  return out;
}

type ChangelogEntriesProps = {
  entries: UpdateEntry[];
  /** Max bullets per entry (rest as „+N weitere“). */
  maxItemsPer?: number;
  /** Compact = smaller padding for Settings cards. */
  compact?: boolean;
  /** Only bullets (for nested history where title is already in a summary). */
  bulletsOnly?: boolean;
};

/** Title + short bullet list — clear Windows-Update-style changelog blocks. */
export function ChangelogEntries({
  entries,
  maxItemsPer = 6,
  compact = false,
  bulletsOnly = false,
}: ChangelogEntriesProps) {
  if (!entries.length) return null;
  return (
    <div className={`grid ${compact ? "gap-2" : "gap-3"}`}>
      {entries.map((entry) => {
        const items = entry.items.filter((i) => i && i !== entry.title);
        const shown = items.slice(0, maxItemsPer);
        const more = items.length - shown.length;
        const list = shown.length > 0 && (
          <ul className={`space-y-1 ${compact ? "text-[12px]" : "text-[12.5px]"} text-muted ${bulletsOnly ? "" : "mt-1.5"}`}>
            {shown.map((item) => (
              <li key={item} className="flex gap-2 leading-snug">
                <span className="mt-[0.35em] size-1.5 shrink-0 rounded-full bg-accent/70" aria-hidden />
                <span>{shortPoint(item, compact ? 100 : 120)}</span>
              </li>
            ))}
            {more > 0 && <li className="pl-3.5 text-[11px] text-subtle">+{more} weitere Punkte</li>}
          </ul>
        );
        if (bulletsOnly) {
          return <div key={`${entry.date}|${entry.version ?? ""}|${entry.title}`}>{list}</div>;
        }
        return (
          <article
            key={`${entry.date}|${entry.version ?? ""}|${entry.title}`}
            className={`rounded-xl border border-accent/35 bg-accent/8 ${compact ? "px-3 py-2.5" : "px-3.5 py-3"}`}
          >
            <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              {entry.version && (
                <span className="rounded-md bg-accent/20 px-1.5 py-0.5 text-[11px] font-semibold text-accent">
                  v{entry.version}
                </span>
              )}
              <h3 className={`font-semibold leading-snug ${compact ? "text-[13px]" : "text-[14px]"}`}>
                {entry.title}
              </h3>
              {entry.date && (
                <span className="text-[11px] text-subtle">
                  {new Date(`${entry.date}T12:00:00`).toLocaleDateString("de-DE")}
                </span>
              )}
            </header>
            {list}
          </article>
        );
      })}
    </div>
  );
}

/** Reloads FurrBox so the newest server version is used. */
export function applyServerUpdate() {
  window.location.reload();
}

const SERVER_CHECK_MS = 5 * 60_000;
const UPDATE_TOAST_MS = Math.max(MOTION.toastMs, 7800);

/** One update the user can apply right now (desktop installer first, then server update). */
export function usePendingUpdate() {
  const server = useServerUpdate();
  const desktop = useUpdateState();
  const desktopActive =
    !!desktop?.newVersion && (desktop.status === "ready" || desktop.status === "downloading");
  const desktopEntries = useDesktopChangelog(
    desktopActive ? desktop!.newVersion : undefined,
    desktop?.notes,
  );

  if (desktopActive && desktop?.newVersion) {
    const ready = desktop.status === "ready";
    return {
      kind: "desktop" as const,
      key: `desktop-${desktop.newVersion}-${desktop.status}`,
      label: ready
        ? "Update bereit – zum Installieren neu starten"
        : `Update wird heruntergeladen (${desktop.percent ?? 0} %)`,
      versionLabel: desktop.newVersion,
      entries: desktopEntries,
      items: newsLines(desktopEntries),
      apply: () => {
        if (ready) void updateBridge()?.install();
      },
      canApply: ready,
    };
  }
  if (server.status === "available") {
    return {
      kind: "server" as const,
      key: `server-${server.news.map((n) => n.title).join("|")}`,
      label: "Update verfügbar – klicken zum Aktualisieren",
      versionLabel: server.news.find((n) => n.version)?.version,
      entries: server.news,
      items: newsLines(server.news),
      apply: applyServerUpdate,
      canApply: true,
    };
  }
  return null;
}

/**
 * Background update watcher: checks the server regularly and announces a new update once as a
 * Windows-like notification + corner banner. Applying via banner, tray, or toast click.
 */
export function UpdatePopup() {
  const pending = usePendingUpdate();
  const desktop = useUpdateState();
  const announced = useRef<string | null>(null);

  useEffect(() => {
    let first: number | undefined;
    let timer: number | undefined;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      void useServerUpdate.getState().check();
    };
    const arm = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      timer = window.setTimeout(() => {
        check();
        arm();
      }, SERVER_CHECK_MS);
    };
    first = window.setTimeout(() => {
      check();
      arm();
    }, 15_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        check();
        arm();
      } else if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (first !== undefined) window.clearTimeout(first);
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Desktop download/ready and server updates: one toast with bullets.
  useEffect(() => {
    if (!pending || announced.current === pending.key) return;
    announced.current = pending.key;
    const preview = newsPreview(pending.entries, 3);
    playSound("update", { eventId: pending.key });
    useNotifications.getState().notify({
      id: `update-${pending.key}`,
      kind: "update",
      version: pending.versionLabel ? `FurrBox ${pending.versionLabel}` : "FurrBox Update",
      title:
        pending.kind === "desktop"
          ? pending.canApply
            ? "Update bereit zum Installieren"
            : `Update ${pending.versionLabel ?? ""} wird heruntergeladen`.trim()
          : "Ein Update ist verfügbar",
      description: preview.length
        ? preview.map((p) => `• ${p}`).join("\n")
        : "Klicken zum Aktualisieren – oder über das Symbol unten rechts.",
      actionLabel: pending.kind === "desktop" ? (pending.canApply ? "Neu starten" : "Details") : "Aktualisieren",
      durationMs: UPDATE_TOAST_MS,
      tone: "info",
      onClick: pending.apply,
    });
  }, [pending]);

  // One message is enough: the toast above, plus the taskbar symbol until the update is installed.
  return null;
}

/** Taskbar icon (bottom right) shown while an update is waiting; click applies it. */
export function UpdateTrayButton() {
  const pending = usePendingUpdate();
  const [busy, setBusy] = useState(false);
  if (!pending) return null;
  const preview = newsPreview(pending.entries, 5);
  const tooltip = [pending.label, ...preview].join("\n");
  return (
    <button
      type="button"
      aria-label={pending.label}
      title={tooltip}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        pending.apply();
      }}
      className="furr-toast-in relative grid size-10 place-items-center rounded-md text-accent hover:bg-fg/8 disabled:opacity-60"
    >
      <Download className="size-4 furr-update-pulse" />
      <span className="absolute right-2 top-2 size-2 rounded-full bg-accent ring-2 ring-[var(--os-taskbar)]" />
    </button>
  );
}
