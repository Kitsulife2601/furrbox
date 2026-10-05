// Desktop-app updates (GitHub Releases via electron-updater in desktop/main.cjs):
// a toast while an update downloads, then a centered popup to restart and install it.
import { playSound } from "@/lib/furr/sounds";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { getAppBuild } from "@/lib/furr/api/session";
import { Download } from "lucide-react";
import { useNotifications } from "@/store/notifications";
import { Btn } from "@/components/furr/ui";
import UPDATES from "@/lib/furr/updates.json";

const UPDATE_LIST = UPDATES as { version?: string; items: string[] }[];

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

/** Flat list for "Das ist neu": each change, with its details indented. */
export function newsLines(news: UpdateEntry[]) {
  return news.flatMap((u) =>
    u.items.length === 1 && u.items[0] === u.title ? [u.title] : [u.title, ...u.items.map((i) => `– ${i}`)],
  );
}

/** Reloads FurrBox so the newest server version is used. */
export function applyServerUpdate() {
  window.location.reload();
}

const SERVER_CHECK_MS = 5 * 60_000;

/** One update the user can apply right now (desktop installer first, then server update). */
export function usePendingUpdate() {
  const server = useServerUpdate();
  const desktop = useUpdateState();
  if (desktop?.status === "ready" && desktop.newVersion) {
    const items = UPDATE_LIST.find((u) => u.version === desktop.newVersion)?.items ?? [];
    return {
      kind: "desktop" as const,
      key: `desktop-${desktop.newVersion}`,
      label: "Update bereit – zum Installieren neu starten",
      items,
      apply: () => void updateBridge()?.install(),
    };
  }
  if (server.status === "available") {
    return {
      kind: "server" as const,
      key: `server-${server.news.map((n) => n.title).join("|")}`,
      label: "Update verfügbar – klicken zum Aktualisieren",
      items: newsLines(server.news),
      apply: applyServerUpdate,
    };
  }
  return null;
}

/**
 * Background update watcher: checks the server regularly and announces a new update once as a
 * notification. Applying happens via the taskbar icon (UpdateTrayButton) or the notification.
 */
export function UpdatePopup() {
  const pending = usePendingUpdate();
  const desktop = useUpdateState();
  const announced = useRef<string | null>(null);

  useEffect(() => {
    const check = () => void useServerUpdate.getState().check();
    const first = window.setTimeout(check, 15_000);
    const timer = window.setInterval(check, SERVER_CHECK_MS);
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Desktop installer download started.
  useEffect(() => {
    if (desktop?.status === "downloading" && desktop.newVersion && announced.current !== `dl-${desktop.newVersion}`) {
      announced.current = `dl-${desktop.newVersion}`;
      useNotifications.getState().notify({
        version: "FurrBox Update",
        title: "Neues Update gefunden",
        description: "Das Update wird im Hintergrund heruntergeladen.",
      });
    }
  }, [desktop]);

  // Update ready to apply: one notification, clicking it applies the update.
  useEffect(() => {
    if (!pending || announced.current === pending.key) return;
    announced.current = pending.key;
    const preview = pending.items.filter((i) => !i.startsWith("– ")).slice(0, 3);
    playSound("update", { eventId: pending.key });
    useNotifications.getState().notify({
      id: `update-${pending.key}`,
      version: "FurrBox Update",
      title: pending.kind === "desktop" ? "Update bereit zum Installieren" : "Ein Update ist verfügbar",
      description: preview.length
        ? `${preview.join(" · ")} – klicken zum Aktualisieren`
        : "Klicken zum Aktualisieren – oder über das Symbol unten rechts.",
      onClick: pending.apply,
    });
  }, [pending]);

  return null;
}

/** Taskbar icon (bottom right) shown while an update is waiting; click applies it. */
export function UpdateTrayButton() {
  const pending = usePendingUpdate();
  const [busy, setBusy] = useState(false);
  if (!pending) return null;
  const tooltip = [pending.label, ...pending.items.slice(0, 6)].join("\n");
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
