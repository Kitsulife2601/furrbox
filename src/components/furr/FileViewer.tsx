// FurrFS Viewer: text editing with save, image/PDF/media preview, download.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Save } from "lucide-react";
import { readFile, saveTextFile } from "@/lib/furr/api/files";
import { base64ToBlob, base64ToText, downloadBase64, errorMessage } from "@/lib/furr/client";
import { formatSize, isImage, isTextLike } from "@/lib/furr/paths";
import { useDesktop, type WindowPayload } from "@/store/desktop";
import { notifyError } from "@/store/notifications";
import { openFurrFile } from "./FurrFS";
import { Btn, Empty, PromptDialog } from "./ui";

export function FileViewer({ payload }: { payload?: WindowPayload }) {
  const queryClient = useQueryClient();
  const fileId = payload?.fileId ?? "";
  const query = useQuery({ queryKey: ["furr", "file", fileId], queryFn: () => readFile({ data: fileId }), enabled: Boolean(fileId) });
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  const [saving, setSaving] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  const file = query.data?.file;
  const textual = file ? isTextLike(file) : false;

  useEffect(() => {
    if (!query.data) return;
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

/** Editor for a brand-new document; saving stores it in FurrFS (Privat/Dokumente). */
export function Notepad({ windowId }: { windowId: string }) {
  const [text, setText] = useState("");
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
