// Desktop-app updates (GitHub Releases via electron-updater in desktop/main.cjs):
// Windows-like toast + corner banner while an update downloads / is ready, then restart to install.
import { playSound } from "@/lib/furr/sounds";
import { MOTION } from "@/lib/furr/motion";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { getAppBuild } from "@/lib/furr/api/session";
import { Download, Sparkles, X } from "lucide-react";
import { useNotifications } from "@/store/notifications";
import { Btn } from "@/components/furr/ui";
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
  if (desktop?.status === "ready" && desktop.newVersion) {
    const entry = UPDATE_LIST.find((u) => u.version === desktop.newVersion) as UpdateEntry | undefined;
    const entries: UpdateEntry[] = entry
      ? [
          {
            date: entry.date ?? new Date().toISOString().slice(0, 10),
            version: entry.version,
            title: entry.title ?? `Version ${desktop.newVersion}`,
            items: entry.items ?? [],
          },
        ]
      : desktop.notes
        ? [
            {
              date: new Date().toISOString().slice(0, 10),
              version: desktop.newVersion,
              title: `Version ${desktop.newVersion}`,
              items: desktop.notes
                .split(/\n+/)
                .map((l) => l.replace(/^[-*•]\s*/, "").trim())
                .filter(Boolean),
            },
          ]
        : [];
    return {
      kind: "desktop" as const,
      key: `desktop-${desktop.newVersion}`,
      label: "Update bereit – zum Installieren neu starten",
      versionLabel: desktop.newVersion,
      entries,
      items: newsLines(entries),
      apply: () => void updateBridge()?.install(),
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

  // Desktop installer download started — Windows-like notice.
  useEffect(() => {
    if (desktop?.status === "downloading" && desktop.newVersion && announced.current !== `dl-${desktop.newVersion}`) {
      announced.current = `dl-${desktop.newVersion}`;
      playSound("update", { eventId: `dl-${desktop.newVersion}` });
      useNotifications.getState().notify({
        id: `update-dl-${desktop.newVersion}`,
        kind: "update",
        version: "FurrBox Update",
        title: `Update ${desktop.newVersion} wird heruntergeladen`,
        description: "Wie bei Windows: Download im Hintergrund. Du wirst benachrichtigt, sobald es bereit ist.",
        actionLabel: "Details",
        durationMs: UPDATE_TOAST_MS,
        tone: "info",
      });
    }
  }, [desktop]);

  // Update ready to apply: toast + sound (banner is separate UI).
  useEffect(() => {
    if (!pending || announced.current === pending.key) return;
    announced.current = pending.key;
    const preview = newsPreview(pending.entries, 3);
    playSound("update", { eventId: pending.key });
    useNotifications.getState().notify({
      id: `update-${pending.key}`,
      kind: "update",
      version: pending.versionLabel ? `FurrBox ${pending.versionLabel}` : "FurrBox Update",
      title: pending.kind === "desktop" ? "Update bereit zum Installieren" : "Ein Update ist verfügbar",
      description: preview.length
        ? preview.map((p) => `• ${p}`).join("\n")
        : "Klicken zum Aktualisieren – oder über das Symbol unten rechts.",
      actionLabel: pending.kind === "desktop" ? "Neu starten" : "Aktualisieren",
      durationMs: UPDATE_TOAST_MS,
      tone: "info",
      onClick: pending.apply,
    });
  }, [pending]);

  return <UpdateBanner />;
}

/** Windows-11-like update card (bottom-right): title, short bullets, install / dismiss. */
export function UpdateBanner() {
  const pending = usePendingUpdate();
  const [hiddenKey, setHiddenKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!pending || hiddenKey === pending.key) return null;

  const bullets = newsPreview(pending.entries, 4);

  return (
    <div
      className="pointer-events-none absolute bottom-14 right-2 z-[88] w-[min(360px,calc(100%-1rem))]"
      role="status"
      aria-live="polite"
    >
      <div
        className="mica furr-toast-in pointer-events-auto overflow-hidden rounded-xl border border-accent/40 shadow-2xl"
        style={{ animationDuration: `${MOTION.popMs}ms`, animationTimingFunction: MOTION.easePop }}
      >
        <div className="flex items-start gap-3 border-b border-border/50 px-3.5 py-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent/18 text-accent">
            <Download className="size-5 furr-update-pulse" strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Update verfügbar</p>
            <p className="text-[14px] font-semibold leading-snug">
              {pending.versionLabel ? `FurrBox ${pending.versionLabel}` : "Neues FurrBox-Update"}
            </p>
            <p className="mt-0.5 text-[12px] text-muted">{pending.label}</p>
          </div>
          <button
            type="button"
            aria-label="Schließen"
            className="rounded-md p-1.5 text-muted hover:bg-fg/10 hover:text-fg"
            onClick={() => setHiddenKey(pending.key)}
          >
            <X className="size-4" />
          </button>
        </div>
        {bullets.length > 0 && (
          <ul className="grid gap-1.5 px-3.5 py-2.5 text-[12px] text-muted">
            {bullets.map((b) => (
              <li key={b} className="flex gap-2 leading-snug">
                <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent/80" strokeWidth={1.7} />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2 border-t border-border/50 px-3 py-2.5">
          <button
            type="button"
            className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-muted hover:bg-fg/8"
            onClick={() => setHiddenKey(pending.key)}
          >
            Später
          </button>
          <Btn
            variant="primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              pending.apply();
            }}
          >
            {pending.kind === "desktop" ? "Neu starten" : "Jetzt aktualisieren"}
          </Btn>
        </div>
      </div>
    </div>
  );
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
