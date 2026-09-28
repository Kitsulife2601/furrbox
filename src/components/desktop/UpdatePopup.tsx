// Desktop-app updates (GitHub Releases via electron-updater in desktop/main.cjs):
// a toast while an update downloads, then a centered popup to restart and install it.
import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { useNotifications } from "@/store/notifications";
import { Btn } from "@/components/furr/ui";

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

export function UpdatePopup() {
  const state = useUpdateState();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const announced = useRef<string | null>(null);

  useEffect(() => {
    if (state?.status === "downloading" && state.newVersion && announced.current !== state.newVersion) {
      announced.current = state.newVersion;
      useNotifications.getState().notify({
        version: "FurrBox Update",
        title: `Update ${state.newVersion} gefunden`,
        description: "Das Update wird im Hintergrund heruntergeladen.",
      });
    }
  }, [state]);

  if (state?.status !== "ready" || !state.newVersion || dismissed === state.newVersion) return null;

  return (
    <div className="fixed inset-0 z-[9000] grid place-items-center bg-black/45 p-4" onMouseDown={(e) => e.stopPropagation()}>
      <div role="dialog" aria-label="Update verfügbar" className="mica w-[min(440px,100%)] rounded-xl p-6 text-fg win-shadow">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-accent/20 text-accent">
            <Download className="size-5" />
          </span>
          <div>
            <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-accent">FurrBox Update</p>
            <h2 className="text-lg font-semibold tracking-tight">Version {state.newVersion} ist bereit</h2>
          </div>
        </div>
        <p className="mt-3 text-[13px] text-muted">
          Du nutzt Version {state.version}. FurrBox startet zum Installieren kurz neu – deine Dateien bleiben erhalten.
        </p>
        {state.notes && (
          <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-bg/60 p-3 font-sans text-[12px] text-fg/85">
            {state.notes}
          </pre>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Btn variant="ghost" onClick={() => setDismissed(state.newVersion ?? null)}>
            Später
          </Btn>
          <Btn
            variant="primary"
            disabled={installing}
            onClick={() => {
              setInstalling(true);
              void updateBridge()?.install();
            }}
          >
            {installing ? "Wird neu gestartet…" : "Jetzt neu starten"}
          </Btn>
        </div>
      </div>
    </div>
  );
}
