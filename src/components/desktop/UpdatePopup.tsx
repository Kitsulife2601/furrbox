// Desktop-app updates (GitHub Releases via electron-updater in desktop/main.cjs):
// a toast while an update downloads, then a centered popup to restart and install it.
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

export const useServerUpdate = create<ServerUpdate>((set, get) => ({
  status: "idle",
  news: [],
  checkedAt: null,
  check: async () => {
    if (get().status === "checking") return;
    set({ status: get().status === "available" ? "available" : "checking" });
    try {
      const server = await getAppBuild();
      const known = new Set(UPDATE_LIST.map((u) => entryKey(u as UpdateEntry)));
      const available = server.build !== __FURRBOX_BUILD__;
      set({
        status: available ? "available" : "current",
        news: available ? server.updates.filter((u) => !known.has(entryKey(u))) : [],
        checkedAt: new Date().toISOString(),
      });
    } catch {
      set({ status: "error", checkedAt: new Date().toISOString() });
    }
  },
}));

/** Reloads FurrBox so the newest server version is used. */
export function applyServerUpdate() {
  window.location.reload();
}

const SERVER_CHECK_MS = 5 * 60_000;

export function UpdatePopup() {
  const server = useServerUpdate();
  const desktop = useUpdateState();
  const [serverDismissed, setServerDismissed] = useState(false);

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

  return (
    <>
      <DesktopUpdatePopup />
      {server.status === "available" && !serverDismissed && desktop?.status !== "ready" && (
        <UpdateDialog
          title="Ein Update ist verfügbar"
          text="FurrBox lädt sich zum Aktualisieren kurz neu – deine Dateien und Fenster-Einstellungen bleiben erhalten."
          items={server.news.flatMap((u) => u.items)}
          confirmLabel="Jetzt aktualisieren"
          onLater={() => setServerDismissed(true)}
          onConfirm={applyServerUpdate}
        />
      )}
    </>
  );
}

function UpdateDialog({
  title,
  text,
  items,
  notes,
  confirmLabel,
  busyLabel,
  onLater,
  onConfirm,
}: {
  title: string;
  text: string;
  items: string[];
  notes?: string;
  confirmLabel: string;
  busyLabel?: string;
  onLater: () => void;
  onConfirm: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-[9000] grid place-items-center bg-black/45 p-4" onMouseDown={(e) => e.stopPropagation()}>
      <div role="dialog" aria-label={title} className="mica w-[min(440px,100%)] rounded-xl p-6 text-fg win-shadow">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-accent/20 text-accent">
            <Download className="size-5" />
          </span>
          <div>
            <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-accent">FurrBox Update</p>
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          </div>
        </div>
        <p className="mt-3 text-[13px] text-muted">{text}</p>
        {items.length > 0 ? (
          <div className="mt-3 max-h-48 overflow-auto rounded-md bg-bg/60 p-3">
            <p className="text-[12px] font-medium">Das ist neu</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12px] text-fg/85">
              {items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : (
          notes && (
            <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-bg/60 p-3 font-sans text-[12px] text-fg/85">
              {notes}
            </pre>
          )
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Btn variant="ghost" onClick={onLater}>
            Später
          </Btn>
          <Btn
            variant="primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onConfirm();
            }}
          >
            {busy ? (busyLabel ?? "Wird aktualisiert…") : confirmLabel}
          </Btn>
        </div>
      </div>
    </div>
  );
}

function DesktopUpdatePopup() {
  const state = useUpdateState();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const announced = useRef<string | null>(null);

  useEffect(() => {
    if (state?.status === "downloading" && state.newVersion && announced.current !== state.newVersion) {
      announced.current = state.newVersion;
      useNotifications.getState().notify({
        version: "FurrBox Update",
        title: "Neues Update gefunden",
        description: "Das Update wird im Hintergrund heruntergeladen.",
      });
    }
  }, [state]);

  if (state?.status !== "ready" || !state.newVersion || dismissed === state.newVersion) return null;
  const items = UPDATE_LIST.find((u) => u.version === state.newVersion)?.items ?? [];

  return (
    <UpdateDialog
      title="Ein Update ist bereit"
      text="FurrBox startet zum Installieren kurz neu – deine Dateien bleiben erhalten."
      items={items}
      notes={state.notes}
      confirmLabel="Jetzt neu starten"
      busyLabel="Wird neu gestartet…"
      onLater={() => setDismissed(state.newVersion ?? null)}
      onConfirm={() => void updateBridge()?.install()}
    />
  );
}
