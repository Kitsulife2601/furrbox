// German UI for FurrBox Desktop Clips (ring buffer / on-demand evidence capture).
import { useCallback, useEffect, useState } from "react";
import { Copy, Film, FolderOpen, Trash2, Video } from "lucide-react";
import {
  attachClipToCase,
  clipsConfig,
  clipsDelete,
  clipsList,
  clipsMarkIn,
  clipsMarkOut,
  clipsOpenFolder,
  clipsSetConfig,
  clipsStatus,
  hasDesktopClips,
  onClipSaved,
  requestClip,
  type ClipInfo,
  type ClipsConfig,
  type ClipsStatus,
} from "@/lib/furr/clips-client";
import { setClipEvidenceDraft } from "@/lib/furr/clip-draft";
import { formatSize } from "@/lib/furr/paths";
import { errorMessage } from "@/lib/furr/client";
import { useDesktop } from "@/store/desktop";
import { useNotifications } from "@/store/notifications";
import { Btn, ErrorText, Field } from "./ui";

const QUALITY_LABEL: Record<ClipsConfig["quality"], string> = {
  low: "Niedrig (sparsam)",
  medium: "Mittel (empfohlen)",
  high: "Hoch",
};

export function ClipSettings() {
  const available = hasDesktopClips();
  const [status, setStatus] = useState<ClipsStatus | null>(null);
  const [config, setConfig] = useState<ClipsConfig | null>(null);
  const [clips, setClips] = useState<ClipInfo[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const openApp = useDesktop((s) => s.openApp);

  const refresh = useCallback(async () => {
    if (!hasDesktopClips()) return;
    try {
      const [st, cfg, list] = await Promise.all([clipsStatus(), clipsConfig(), clipsList()]);
      setStatus(st);
      setConfig(cfg);
      setClips(list);
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(t);
  }, [refresh]);

  if (!available) {
    return (
      <p className="text-[13px] text-muted">
        Beweis-Clips sind nur in der <b>FurrBox Desktop-App</b> verfügbar (Bildschirm-/Fensteraufnahme).
      </p>
    );
  }

  async function patch(partial: Partial<ClipsConfig>) {
    setBusy(true);
    try {
      const next = await clipsSetConfig(partial);
      setConfig(next);
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveManual() {
    setBusy(true);
    try {
      const res = await requestClip({ source: "desktop", reason: "manual", meta: { source: "settings" } });
      if (!res.ok) throw new Error(res.error);
      useNotifications.getState().notify({
        version: "Clips",
        title: "Beweis bereit",
        description: res.value.name,
      });
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleMark() {
    setBusy(true);
    try {
      if (status?.markInAt) {
        const res = await clipsMarkOut({ source: "settings" });
        if (!res.ok) throw new Error(res.error);
        useNotifications.getState().notify({ version: "Clips", title: "Beweis bereit", description: res.value.name });
      } else {
        const res = await clipsMarkIn();
        if (!res.ok) throw new Error(res.error);
        useNotifications.getState().notify({
          version: "Clips",
          title: "Mark-In",
          description: "Aufnahme markiert – erneut für Mark-Out.",
        });
      }
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      const res = await clipsDelete(id);
      if (!res.ok) throw new Error(res.error || "Löschen fehlgeschlagen.");
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function attach(clip: ClipInfo) {
    setBusy(true);
    try {
      const res = await attachClipToCase(clip.id, "new", {
        targetDisplayName: clip.meta?.target ?? null,
        notes:
          clip.reason === "votekick" && clip.meta?.target
            ? `Automatischer Clip bei Votekick gegen ${clip.meta.target}${clip.meta.initiator ? ` (von ${clip.meta.initiator})` : ""}.`
            : `Desktop-Clip: ${clip.name}`,
      });
      useNotifications.getState().notify({
        version: "Clips",
        title: "Als Beweis angelegt",
        description: res.casePath,
      });
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function prepareDraft(clip: ClipInfo) {
    setClipEvidenceDraft({
      clipId: clip.id,
      clipName: clip.name,
      targetDisplayName: clip.meta?.target ?? null,
      reason: clip.reason,
      notes:
        clip.reason === "votekick" && clip.meta?.target
          ? `Automatischer Clip bei Votekick gegen ${clip.meta.target}${clip.meta.initiator ? ` (von ${clip.meta.initiator})` : ""}.${clip.sha256 ? `\nSHA-256: ${clip.sha256}` : ""}`
          : `Desktop-Clip: ${clip.name}${clip.sha256 ? `\nSHA-256: ${clip.sha256}` : ""}`,
    });
    openApp("evidence");
  }

  async function copySha(sha: string) {
    try {
      await navigator.clipboard.writeText(sha);
      useNotifications.getState().notify({ version: "Clips", title: "SHA-256 kopiert", description: sha.slice(0, 16) + "…" });
    } catch {
      setError("Zwischenablage nicht verfügbar.");
    }
  }

  return (
    <div className="grid gap-4">
      <ErrorText>{error}</ErrorText>
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
        <span>
          Status:{" "}
          <b className="text-fg">
            {!config?.enabled
              ? "Aus"
              : status?.active
                ? "Puffer aktiv"
                : status?.inInstance
                  ? config?.mode === "nurTrigger"
                    ? "Bereit (nur Trigger)"
                    : "Startet…"
                  : "Pausiert (keine Instanz)"}
          </b>
        </span>
      </div>
      <Field label="Speicherort" hint="Lokale Clips + Incident-JSON (Sidecar). Kein Upload ohne deinen Klick.">
        <div className="flex flex-wrap items-center gap-2">
          <code className="max-w-full truncate rounded bg-fg/8 px-2 py-1 text-[11px] text-fg">{status?.clipsDir || "…"}</code>
          <Btn disabled={busy} onClick={() => void clipsOpenFolder()}>
            <FolderOpen className="size-3.5" /> Ordner öffnen
          </Btn>
        </div>
      </Field>

      <Field label="Clips aktiv">
        <label className="flex items-center gap-2 text-[13px] text-fg">
          <input
            type="checkbox"
            checked={Boolean(config?.enabled)}
            disabled={busy || !config}
            onChange={(e) => void patch({ enabled: e.target.checked })}
          />
          Kurzclips bei Events speichern
        </label>
      </Field>

      <Field
        label="Modus"
        hint="Instanz: niedriger Dauer-Puffer in der Instanz (echter Pre-Buffer). Nur-Trigger: Pipeline schläft, startet erst bei Vote/Hotkey (weniger Last, kaum Vorgeschichte)."
      >
        <select
          className="h-9 w-full rounded-md border border-border bg-bg/60 px-3 text-[13px] text-fg"
          disabled={busy || !config}
          value={config?.mode ?? "instanz"}
          onChange={(e) => void patch({ mode: e.target.value === "nurTrigger" ? "nurTrigger" : "instanz" })}
        >
          <option value="instanz">Instanz-Puffer (Pre-Buffer, empfohlen)</option>
          <option value="nurTrigger">Nur bei Trigger / Vote (sparsam)</option>
        </select>
      </Field>

      <Field label="Quelle" hint="VRChat-Fenster wenn gefunden, sonst Primärmonitor.">
        <select
          className="h-9 w-full rounded-md border border-border bg-bg/60 px-3 text-[13px] text-fg"
          disabled={busy || !config}
          value={config?.source ?? "vrchat"}
          onChange={(e) => void patch({ source: e.target.value === "screen" ? "screen" : "vrchat" })}
        >
          <option value="vrchat">VRChat-Fenster (Fallback: Bildschirm)</option>
          <option value="screen">Primärmonitor</option>
        </select>
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Pre-Buffer: ${config?.preSeconds ?? 20}s`}>
          <input
            type="range"
            min={0}
            max={60}
            step={5}
            disabled={busy || !config}
            value={config?.preSeconds ?? 20}
            onChange={(e) => void patch({ preSeconds: Number(e.target.value), bufferSeconds: Math.max(Number(e.target.value), config?.bufferSeconds ?? 30) })}
            className="w-full"
          />
        </Field>
        <Field label={`Nachlauf: ${config?.postSeconds ?? 5}s`}>
          <input
            type="range"
            min={0}
            max={15}
            step={1}
            disabled={busy || !config}
            value={config?.postSeconds ?? 5}
            onChange={(e) => void patch({ postSeconds: Number(e.target.value) })}
            className="w-full"
          />
        </Field>
      </div>

      <Field label={`Ringpuffer-Länge: ${config?.bufferSeconds ?? 30}s`} hint="Max. gehaltene Segmente im Speicher (10–60).">
        <input
          type="range"
          min={10}
          max={60}
          step={5}
          disabled={busy || !config}
          value={config?.bufferSeconds ?? 30}
          onChange={(e) => void patch({ bufferSeconds: Number(e.target.value) })}
          className="w-full"
        />
      </Field>

      <Field label="Qualität">
        <select
          className="h-9 w-full rounded-md border border-border bg-bg/60 px-3 text-[13px] text-fg"
          disabled={busy || !config}
          value={config?.quality ?? "medium"}
          onChange={(e) => void patch({ quality: e.target.value as ClipsConfig["quality"] })}
        >
          {(Object.keys(QUALITY_LABEL) as ClipsConfig["quality"][]).map((q) => (
            <option key={q} value={q}>
              {QUALITY_LABEL[q]}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Abgelehnter Votekick">
        <label className="flex items-center gap-2 text-[13px] text-fg">
          <input
            type="checkbox"
            checked={config?.keepOnFailedVote !== false}
            disabled={busy || !config}
            onChange={(e) => void patch({ keepOnFailedVote: e.target.checked })}
          />
          Clip behalten, auch wenn Vote fehlschlägt (Standard: an)
        </label>
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Aufbewahrung: ${config?.keepCount ?? 40} Clips`}>
          <input
            type="range"
            min={5}
            max={100}
            step={5}
            disabled={busy || !config}
            value={config?.keepCount ?? 40}
            onChange={(e) => void patch({ keepCount: Number(e.target.value) })}
            className="w-full"
          />
        </Field>
        <Field label={`Max. Speicher: ${config?.maxTotalMb ?? 800} MB`}>
          <input
            type="range"
            min={100}
            max={2000}
            step={50}
            disabled={busy || !config}
            value={config?.maxTotalMb ?? 800}
            onChange={(e) => void patch({ maxTotalMb: Number(e.target.value) })}
            className="w-full"
          />
        </Field>
      </div>

      <p className="text-[12px] text-muted">
        Hotkeys: <kbd className="rounded bg-fg/10 px-1.5 py-0.5 text-[11px]">Strg+Umschalt+C</kbd> speichern ·{" "}
        <kbd className="rounded bg-fg/10 px-1.5 py-0.5 text-[11px]">Strg+Umschalt+M</kbd> Mark In/Out. Im Leerlauf ohne
        Instanz: Recorder komplett abgebaut.
      </p>

      <div className="flex flex-wrap gap-2">
        <Btn variant="primary" disabled={busy} onClick={() => void saveManual()}>
          <Video className="size-3.5" /> Jetzt Clip speichern
        </Btn>
        <Btn disabled={busy} onClick={() => void toggleMark()}>
          {status?.markInAt ? "Mark-Out (Clip)" : "Mark-In"}
        </Btn>
        <Btn disabled={busy} onClick={() => void refresh()}>
          Aktualisieren
        </Btn>
      </div>

      <div>
        <h4 className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
          <Film className="size-4 text-accent" /> Gespeicherte Clips
        </h4>
        {!clips.length ? (
          <p className="text-[12px] text-muted">Noch keine Clips.</p>
        ) : (
          <ul className="grid max-h-72 gap-1 overflow-auto">
            {clips.map((c) => (
              <li key={c.id} className="flex flex-col gap-1 rounded-md border border-border/70 bg-bg/40 px-2 py-1.5 text-[12px]">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-fg">{c.name}</div>
                    <div className="text-muted">
                      {formatSize(c.size)}
                      {c.reason ? ` · ${c.reason}` : ""}
                      {c.meta?.target ? ` · ${c.meta.target}` : ""}
                      {c.caseId ? ` · Fall ${c.caseId}` : " · nicht angehängt"}
                    </div>
                    {c.sha256 && (
                      <div className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-subtle">
                        <span className="truncate">SHA-256: {c.sha256}</span>
                        <button type="button" className="shrink-0 text-accent" onClick={() => void copySha(c.sha256!)} title="Kopieren">
                          <Copy className="size-3" />
                        </button>
                      </div>
                    )}
                  </div>
                  <Btn variant="ghost" className="h-7 px-2" disabled={busy} onClick={() => void attach(c)}>
                    Als Beweis
                  </Btn>
                  <Btn variant="ghost" className="h-7 px-2" disabled={busy} onClick={() => prepareDraft(c)}>
                    Evidence
                  </Btn>
                  <Btn variant="ghost" className="h-7 px-2" disabled={busy} onClick={() => void remove(c.id)} title="Löschen">
                    <Trash2 className="size-3.5" />
                  </Btn>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function ClipSavedListener() {
  const openApp = useDesktop((s) => s.openApp);
  useEffect(() => {
    if (!hasDesktopClips()) return;
    return onClipSaved((info) => {
      useNotifications.getState().notify({
        id: `clip-${info.id}`,
        version: "Clips",
        title: "Beweis bereit",
        description: info.meta?.target
          ? `${info.name} · Ziel: ${info.meta.target} – Klick: als Beweis anlegen`
          : `${info.name} – Klick: als Beweis anlegen (kein Auto-Upload)`,
        onClick: () => {
          setClipEvidenceDraft({
            clipId: info.id,
            clipName: info.name,
            targetDisplayName: info.meta?.target ?? null,
            reason: info.reason,
            notes:
              info.reason === "votekick" && info.meta?.target
                ? `Automatischer Clip bei Votekick gegen ${info.meta.target}${info.meta.initiator ? ` (von ${info.meta.initiator})` : ""}.${info.sha256 ? `\nSHA-256: ${info.sha256}` : ""}`
                : `Desktop-Clip: ${info.name}${info.sha256 ? `\nSHA-256: ${info.sha256}` : ""}`,
          });
          openApp("evidence");
        },
      });
    });
  }, [openApp]);
  return null;
}

export function ClipCaptureButton({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  if (!hasDesktopClips()) return null;
  return (
    <Btn
      className={className}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void requestClip({ source: "desktop", reason: "manual", meta: { source: "ui" } })
          .then((res) => {
            if (!res.ok) throw new Error(res.error);
            useNotifications.getState().notify({
              version: "Clips",
              title: "Beweis bereit",
              description: res.value.name,
            });
          })
          .catch((e) =>
            useNotifications.getState().notify({
              version: "Clips",
              title: "Clip fehlgeschlagen",
              description: errorMessage(e),
            }),
          )
          .finally(() => setBusy(false));
      }}
    >
      <Video className="size-3.5" /> Clip
    </Btn>
  );
}
