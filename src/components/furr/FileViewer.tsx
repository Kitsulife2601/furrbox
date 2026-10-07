// FurrFS Viewer: text editing with save, image/PDF/media preview, download.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, HardDrive, Save } from "lucide-react";
import { downloadFromBot } from "@/lib/furr/botfile-client";
import { BOT_CHUNK_BYTES } from "@/lib/furr/paths";
import { readFile, saveTextFile } from "@/lib/furr/api/files";
import { base64ToBlob, base64ToText, downloadBase64, errorMessage } from "@/lib/furr/client";
import { formatSize, isImage, isTextLike } from "@/lib/furr/paths";
import type { FurrFile } from "@/lib/furr/types";
import { useDesktop, type WindowPayload } from "@/store/desktop";
import { useUnsaved } from "@/lib/furr/unsaved";
import { notifyError } from "@/store/notifications";
import { openFurrFile } from "./FurrFS";
import { Btn, Empty, PromptDialog } from "./ui";

export function FileViewer({ payload, windowId }: { payload?: WindowPayload; windowId?: string }) {
  const queryClient = useQueryClient();
  const fileId = payload?.fileId ?? "";
  const query = useQuery({ queryKey: ["furr", "file", fileId], queryFn: () => readFile({ data: fileId }), enabled: Boolean(fileId) });
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  // The window asks before closing while there is unsaved text.
  useUnsaved(windowId, !saved);
  const [saving, setSaving] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  const file = query.data?.file;
  const textual = file ? isTextLike(file) : false;

  useEffect(() => {
    if (!query.data || query.data.file.onBot) return;
    const { file: f, base64 } = query.data;
    if (isTextLike(f)) {
      setText(base64 ? base64ToText(base64) : "");
      setSaved(true);
      return;
    }
    const url = URL.createObjectURL(base64ToBlob(base64, f.mimeType));
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [query.data]);

  async function save() {
    if (!file || text === null) return;
    setSaving(true);
    try {
      await saveTextFile({ data: { scope: file.scope, folder: file.folder, name: file.name, content: text } });
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: ["furr", "files"] });
    } catch (error) {
      notifyError(error, "Textdokument konnte nicht gespeichert werden");
    } finally {
      setSaving(false);
    }
  }

  if (!fileId) return <Empty>Keine Datei ausgewählt.</Empty>;
  if (query.isError) return <Empty>Datei konnte nicht aus FurrFS geladen werden: {errorMessage(query.error)}</Empty>;
  if (!file) return <Empty>Datei wird geladen…</Empty>;
  if (file.onBot) return <BotFileView file={file} />;

  return (
    <div className="flex h-full flex-col bg-bg/40">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[12px]">
        <span className="min-w-0 flex-1 truncate text-muted">
          {file.scope === "public" ? "Shared Network" : "Privat"} / {file.path} · {formatSize(file.size)}
        </span>
        {textual && (
          <Btn variant="primary" disabled={saving || saved} onClick={() => void save()}>
            <Save className="size-3.5" /> {saving ? "Speichert…" : saved ? "Gespeichert" : "Speichern"}
          </Btn>
        )}
        <Btn onClick={() => query.data && downloadBase64(query.data.base64, file.name, file.mimeType)}>
          <Download className="size-3.5" /> Herunterladen
        </Btn>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {textual ? (
          <textarea
            value={text ?? ""}
            onChange={(e) => {
              setText(e.target.value);
              setSaved(false);
            }}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
                e.preventDefault();
                void save();
              }
            }}
            spellCheck={false}
            className="h-full w-full resize-none bg-transparent p-4 font-mono text-[13px] leading-relaxed outline-none"
            aria-label="Textinhalt"
          />
        ) : blobUrl && isImage(file) ? (
          <div className="grid h-full place-items-center p-4">
            <img src={blobUrl} alt={file.name} className="max-h-full max-w-full object-contain" />
          </div>
        ) : blobUrl && file.mimeType === "application/pdf" ? (
          <iframe src={blobUrl} title={file.name} className="h-full w-full" />
        ) : blobUrl && file.mimeType.startsWith("video/") ? (
          <video src={blobUrl} controls className="h-full w-full" />
        ) : blobUrl && file.mimeType.startsWith("audio/") ? (
          <div className="grid h-full place-items-center">
            <audio src={blobUrl} controls />
          </div>
        ) : (
          <Empty>Keine Vorschau verfügbar. Nutze „Herunterladen“.</Empty>
        )}
      </div>
    </div>
  );
}

/** Big evidence file on the Discord bot's PC: fetched in pieces, then shown like any other file. */
function BotFileView({ file }: { file: FurrFile }) {
  const [url, setUrl] = useState<string | null>(null);
  const [pieces, setPieces] = useState(0);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const total = Math.max(1, Math.ceil(file.size / BOT_CHUNK_BYTES));

  useEffect(() => {
    if (file.botState !== "stored") return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setError("");
    setPieces(0);
    downloadFromBot(file.id, (n) => !cancelled && setPieces(n))
      .then((parts) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob(parts as BlobPart[], { type: file.mimeType || "application/octet-stream" }));
        setUrl(objectUrl);
      })
      .catch((e: unknown) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id, file.botState, file.mimeType, attempt]);

  function save() {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
  }

  return (
    <div className="flex h-full flex-col bg-bg/40">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[12px]">
        <HardDrive className="size-3.5 shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate text-muted">
          Gespeichert beim Discord-Bot · {file.path} · {formatSize(file.size)}
        </span>
        <Btn disabled={!url} onClick={save}>
          <Download className="size-3.5" /> Herunterladen
        </Btn>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {file.botState === "uploading" ? (
          <Empty>Die Datei wird gerade noch zum Discord-Bot hochgeladen.</Empty>
        ) : file.botState === "failed" ? (
          <Empty>Die Datei konnte nicht beim Discord-Bot gespeichert werden.</Empty>
        ) : error ? (
          <div className="grid h-full place-items-center gap-2 p-6 text-center">
            <p className="text-[13px] text-muted">{error}</p>
            <Btn onClick={() => setAttempt((n) => n + 1)}>Erneut versuchen</Btn>
          </div>
        ) : !url ? (
          <div className="grid h-full place-items-center p-6">
            <div className="grid w-64 gap-2 text-center">
              <p className="text-[13px] text-muted">Hole die Datei vom Discord-Bot…</p>
              <div className="h-1.5 overflow-hidden rounded-full bg-fg/10">
                <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round((pieces / total) * 100)}%` }} />
              </div>
              <p className="text-[11px] text-subtle">{Math.round((pieces / total) * 100)} %</p>
            </div>
          </div>
        ) : isImage(file) ? (
          <div className="grid h-full place-items-center p-4">
            <img src={url} alt={file.name} className="max-h-full max-w-full object-contain" />
          </div>
        ) : file.mimeType.startsWith("video/") ? (
          <video src={url} controls autoPlay className="h-full w-full" />
        ) : file.mimeType.startsWith("audio/") ? (
          <div className="grid h-full place-items-center">
            <audio src={url} controls />
          </div>
        ) : file.mimeType === "application/pdf" ? (
          <iframe src={url} title={file.name} className="h-full w-full" />
        ) : (
          <Empty>Keine Vorschau verfügbar. Nutze „Herunterladen“.</Empty>
        )}
      </div>
    </div>
  );
}

/** Editor for a brand-new document; saving stores it in FurrFS (Privat/Dokumente). */
export function Notepad({ windowId }: { windowId: string }) {
  const [text, setText] = useState("");
  useUnsaved(windowId, text.trim().length > 0);
  const [asking, setAsking] = useState(false);
  const closeWindow = useDesktop((s) => s.closeWindow);
  const queryClient = useQueryClient();

  return (
    <div className="relative flex h-full flex-col bg-bg/40">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-[12px] text-muted">
        <span>Unbenannt – wird in Privat/Dokumente gespeichert</span>
        <Btn variant="primary" onClick={() => setAsking(true)}>
          <Save className="size-3.5" /> Speichern unter…
        </Btn>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            setAsking(true);
          }
        }}
        className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-[13px] leading-relaxed outline-none"
        aria-label="Editor"
        autoFocus
      />
      {asking && (
        <PromptDialog
          title="Dateiname"
          initial="Neues Textdokument.txt"
          confirmLabel="Speichern"
          onCancel={() => setAsking(false)}
          onSubmit={async (name) => {
            setAsking(false);
            try {
              const file = await saveTextFile({ data: { scope: "private", folder: "Dokumente", name, content: text } });
              await queryClient.invalidateQueries({ queryKey: ["furr", "files"] });
              closeWindow(windowId);
              openFurrFile(file);
            } catch (error) {
              notifyError(error, "Speichern fehlgeschlagen");
            }
          }}
        />
      )}
    </div>
  );
}
