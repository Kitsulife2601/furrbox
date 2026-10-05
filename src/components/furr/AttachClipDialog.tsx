// Fall-Akte: Clip (oder Datei) mit einem Klick an einen bestehenden Evidence-Fall hängen –
// mit optionalem Bezug zu einem Audit-/Modlog-Eintrag. Nachtrag landet im Moderationsprotokoll des Falls.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Film, Paperclip, UploadCloud, X } from "lucide-react";
import { listAuditLog, writeAuditEntry } from "@/lib/furr/api/audit-api";
import { uploadFile } from "@/lib/furr/api/files";
import { checkClip } from "@/lib/furr/botfile-client";
import { attachClipToCase, clipsList, hasDesktopClips, loadClipFile, type ClipInfo } from "@/lib/furr/clips-client";
import { errorMessage, fileToBase64, timeAgo } from "@/lib/furr/client";
import { MAX_UPLOAD_BYTES, formatSize } from "@/lib/furr/paths";
import type { EvidenceCase } from "@/lib/furr/types";
import { cn } from "@/lib/utils";
import { useNotifications } from "@/store/notifications";
import { Btn, ErrorText } from "./ui";

/**
 * Hängt Clip/Datei an einen bestehenden Fall:
 * – VRChat-Fall + Desktop-Clip → attachClipToCase (Clips-Pipeline: SHA-256, Sidecar mit caseId)
 * – sonst kleine Datei (≤ 3 MB) direkt per uploadFile in den Fall-Ordner
 * Danach Eintrag im gemeinsamen Audit-Log (writeAuditEntry) mit Fall-ID + optionalem Audit-Bezug.
 */
export async function attachToCase(target: EvidenceCase, pick: { clipId: string } | { file: File }, extra: { auditId?: string; note?: string }) {
  let name: string;
  let resultCase = target.caseId;
  if ("clipId" in pick && target.platform === "VRChat") {
    const res = await attachClipToCase(pick.clipId, target.caseId, { notes: extra.note });
    resultCase = res.caseId;
    name = `Clip ${pick.clipId}`;
  } else {
    const file = "file" in pick ? pick.file : await loadClipFile(pick.clipId);
    const problem = await checkClip(file);
    if (problem) throw new Error(problem);
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error(`„${file.name}“ ist ${formatSize(file.size)} groß – direkt gehen max. ${formatSize(MAX_UPLOAD_BYTES)}. Große Clips bitte an einen VRChat-Fall hängen.`);
    }
    await uploadFile({
      data: { scope: "public", folder: target.path, name: file.name, mimeType: file.type || "application/octet-stream", base64: await fileToBase64(file) },
    });
    name = file.name;
  }
  // Audit-Spur (best effort – der Anhang selbst ist schon gespeichert).
  await writeAuditEntry({
    data: {
      action: "evidence.attach",
      source: "desktop",
      caseId: resultCase,
      detail: [`Angehängt: ${name}`, extra.auditId ? `Audit-Bezug: ${extra.auditId}` : "", extra.note ?? ""].filter(Boolean).join(" · "),
    },
  }).catch(() => undefined);
  return { name, caseId: resultCase };
}

export function AttachClipDialog({ target, onClose }: { target: EvidenceCase; onClose: () => void }) {
  const queryClient = useQueryClient();
  const desktop = hasDesktopClips();
  const [clips, setClips] = useState<ClipInfo[] | null>(desktop ? null : []);
  const [clipId, setClipId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [auditId, setAuditId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!desktop) return;
    void clipsList()
      .then((list) => setClips([...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20)))
      .catch(() => setClips([]));
  }, [desktop]);

  // Audit-Bezug: letzte 40 Einträge aus dem gemeinsamen Audit-Log (nur Auswahl, kein Zwang).
  const audit = useQuery({
    queryKey: ["furr", "audit", "recent"],
    queryFn: () => listAuditLog({ data: { limit: 40 } }),
    staleTime: 30_000,
    retry: false,
  });

  async function attach() {
    setError("");
    setBusy(true);
    try {
      const pick = clipId ? { clipId } : file ? { file } : null;
      if (!pick) throw new Error("Wähle einen Clip oder eine Datei.");
      setProgress(null);
      const res = await attachToCase(target, pick, { auditId: auditId || undefined, note: note || undefined });
      setDone(res.name);
      useNotifications.getState().notify({
        version: "FurrEvidence",
        kind: "incident",
        tone: "success",
        title: "An Fall angehängt",
        description: `${res.name} → ${res.caseId}`,
      });
      await queryClient.invalidateQueries({ queryKey: ["furr", "evidence-cases"] });
      window.setTimeout(onClose, 900);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-bg/55 p-4" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-label="An Fall anhängen"
        onMouseDown={(e) => e.stopPropagation()}
        className="furr-window-in grid w-full max-w-md gap-3 rounded-xl border border-border bg-surface p-4 shadow-2xl"
      >
        <header className="flex items-start gap-2">
          <Paperclip className="mt-0.5 size-4 text-accent" />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold">An Fall anhängen</p>
            <p className="truncate font-mono text-[11px] text-muted">{target.caseId}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Schließen" className="rounded p-1 text-muted hover:text-fg">
            <X className="size-4" />
          </button>
        </header>

        {desktop && (
          <div className="grid gap-1">
            <p className="text-[12px] font-medium text-muted">Clip aus FurrBox Desktop</p>
            <div className="grid max-h-44 gap-1 overflow-auto rounded-lg border border-border/70 bg-bg/40 p-1">
              {clips === null && <p className="px-2 py-2 text-[12px] text-subtle">Lade Clips…</p>}
              {clips?.length === 0 && <p className="px-2 py-2 text-[12px] text-subtle">Noch keine Clips gespeichert.</p>}
              {clips?.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setClipId(c.id === clipId ? null : c.id);
                    setFile(null);
                  }}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors",
                    clipId === c.id ? "bg-accent/15 ring-1 ring-accent/60" : "hover:bg-fg/6",
                  )}
                >
                  <Film className="size-3.5 shrink-0 text-violet-300" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className="block truncate text-subtle">
                      {timeAgo(c.createdAt)} · {formatSize(c.size)}
                      {c.meta?.target ? ` · Ziel: ${c.meta.target}` : ""}
                      {c.reason && c.reason !== "manual" ? ` · ${c.reason}` : ""}
                    </span>
                  </span>
                  {clipId === c.id && <Check className="size-3.5 text-accent" />}
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-[12px] text-muted hover:border-accent hover:text-fg">
          <UploadCloud className="size-4" />
          <span className="min-w-0 flex-1 truncate">{file ? `${file.name} · ${formatSize(file.size)}` : desktop ? "…oder andere Datei wählen" : "Datei wählen (Bild, Video, Text)"}</span>
          <input
            type="file"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f) setClipId(null);
              e.target.value = "";
            }}
          />
        </label>

        <label className="grid gap-1 text-[12px] text-muted">
          <span className="font-medium">Bezug zu Audit-Eintrag (optional)</span>
          <select
            value={auditId}
            onChange={(e) => setAuditId(e.target.value)}
            className="h-9 rounded-md border border-border bg-bg/60 px-2 text-[12px] text-fg outline-none focus:border-accent"
          >
            <option value="">– kein Bezug –</option>
            {(audit.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {new Date(a.at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · {a.action}
                {a.targetName ? ` · ${a.targetName}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-[12px] text-muted">
          <span className="font-medium">Notiz (optional)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="z. B. Ab 0:40 sieht man den Vorfall"
            className="h-9 rounded-md border border-border bg-bg/60 px-3 text-[13px] text-fg outline-none focus:border-accent"
          />
        </label>

        <ErrorText>{error}</ErrorText>
        {progress !== null && (
          <div className="h-1.5 overflow-hidden rounded-full bg-fg/10">
            <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${progress}%` }} />
          </div>
        )}
        <div className="flex items-center justify-end gap-2">
          {target.platform !== "VRChat" && desktop && !done && (
            <span className="mr-auto text-[11px] text-subtle">Discord-Fall: Clips bis 3 MB direkt</span>
          )}
          {done && (
            <span className="furr-vr-pop mr-auto flex items-center gap-1 text-[12px] text-emerald-300">
              <Check className="size-3.5" /> Angehängt
            </span>
          )}
          <Btn variant="ghost" onClick={onClose}>
            Abbrechen
          </Btn>
          <Btn variant="primary" disabled={busy || (!clipId && !file)} onClick={() => void attach()}>
            <Paperclip className="size-3.5" /> {busy ? (progress !== null ? `Lädt… ${progress}%` : "Hängt an…") : "Anhängen"}
          </Btn>
        </div>
      </section>
    </div>
  );
}
