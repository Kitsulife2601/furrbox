"use client";

import { File, FileImage, FileText, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FurrWindow } from "@/components/FurrWindow";
import { readFileBlobUrl, readFileText, updateTextDocument } from "@/lib/files";
import { useFurrBoxStore, type FurrFile } from "@/store/furrbox-store";
import type { FurrWindowState } from "@/store/useWindowStore";

type ViewerPayload = {
  fileId: string;
};

function parseViewerPayload(url?: string): ViewerPayload | null {
  if (!url?.startsWith("furrfile:")) return null;
  try {
    return JSON.parse(decodeURIComponent(url.replace("furrfile:", ""))) as ViewerPayload;
  } catch {
    return null;
  }
}

function displayName(file: FurrFile) {
  return file.displayName || file.originalName.split(/[\\/]/).pop() || file.originalName;
}

function isTextDocument(file: FurrFile) {
  const name = displayName(file).toLowerCase();
  return file.mimeType.startsWith("text/") || file.mimeType.includes("json") || name.endsWith(".txt") || name.endsWith(".log") || name.endsWith(".md") || name.endsWith(".json");
}

function fileLabel(file: FurrFile) {
  if (file.mimeType.startsWith("image/")) return "Bilddatei";
  if (isTextDocument(file)) return file.mimeType.includes("json") || displayName(file).toLowerCase().endsWith(".json") ? "Textdokument" : "Textdatei";
  return "Datei";
}

export function FurrFileViewer({ windowState }: { windowState: FurrWindowState }) {
  const token = useFurrBoxStore((state) => state.token);
  const files = useFurrBoxStore((state) => state.files);
  const payload = useMemo(() => parseViewerPayload(windowState.url), [windowState.url]);
  const file = useMemo(() => files.find((item) => item.id === payload?.fileId), [files, payload?.fileId]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    setImageUrl(null);
    setText(null);
    setDirty(false);
    setError(null);

    if (!token || !file) return;
    const selectedFile = file;
    const authToken = token;

    async function load() {
      setLoading(true);
      try {
        if (selectedFile.mimeType.startsWith("image/")) {
          objectUrl = await readFileBlobUrl(selectedFile, authToken);
          if (!cancelled) setImageUrl(objectUrl);
          return;
        }
        if (isTextDocument(selectedFile)) {
          const content = await readFileText(selectedFile, authToken);
          if (!cancelled) setText(content);
          return;
        }
        if (!cancelled) setError("Dieser Dateityp kann aktuell nicht direkt angezeigt werden.");
      } catch {
        if (!cancelled) setError("Datei konnte nicht aus FurrFS geladen werden.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file, token]);

  async function saveText() {
    if (!file || !token || text === null || !isTextDocument(file)) return;
    setSaving(true);
    setError(null);
    try {
      await updateTextDocument(file, token, text);
      setDirty(false);
    } catch {
      setError("Textdokument konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  const Icon = file?.mimeType.startsWith("image/") ? FileImage : file && isTextDocument(file) ? FileText : File;

  return (
    <FurrWindow windowState={windowState} icon={<Icon size={15} />} minWidth={520} minHeight={360}>
      <div className="flex h-full min-h-0 flex-col bg-slate-950 text-slate-100">
        <div className="flex h-12 items-center justify-between border-b border-purple-500/20 bg-slate-900/45 px-4">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-slate-100">{file ? displayName(file) : windowState.title}</p>
            <p className="text-[11px] text-slate-500">{file ? `Virtuelles Dokument aus FurrFS / ${fileLabel(file)}` : "FurrFS Viewer"}</p>
          </div>
          {file ? (
            <span className="rounded border border-cyan-300/20 bg-cyan-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-cyan-100">
              {fileLabel(file)}
            </span>
          ) : null}
          {file && text !== null && isTextDocument(file) ? (
            <button
              className="ml-2 inline-flex h-8 items-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-500/10 px-3 text-[11px] font-bold uppercase tracking-[0.08em] text-cyan-100 transition hover:border-cyan-300/50 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!dirty || saving}
              onClick={saveText}
            >
              <Save size={13} />
              {saving ? "Speichert" : dirty ? "Speichern" : "Gespeichert"}
            </button>
          ) : null}
        </div>

        <div className="scroll-soft min-h-0 flex-1 overflow-auto">
          {!file ? (
            <div className="grid h-full place-items-center p-8 text-center text-[13px] text-slate-400">Datei wurde nicht mehr in FurrFS gefunden.</div>
          ) : loading ? (
            <div className="grid h-full place-items-center p-8 text-[13px] font-semibold text-[#00f0ff]">Datei wird geladen...</div>
          ) : error ? (
            <div className="grid h-full place-items-center p-8 text-center text-[13px] text-pink-200">{error}</div>
          ) : imageUrl ? (
            <div className="grid min-h-full place-items-center bg-[radial-gradient(circle_at_center,rgba(0,240,255,0.08),transparent_42%)] p-4">
              <img src={imageUrl} alt={displayName(file)} className="max-h-full max-w-full object-contain shadow-[0_0_42px_rgba(0,240,255,0.16)]" />
            </div>
          ) : text !== null ? (
            <textarea
              className="min-h-full w-full resize-none bg-slate-950 p-5 font-mono text-[12px] leading-5 text-slate-200 outline-none selection:bg-cyan-400/25"
              value={text}
              spellCheck={false}
              placeholder="Dieses Textdokument ist leer."
              onChange={(event) => {
                setText(event.target.value);
                setDirty(true);
              }}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
                  event.preventDefault();
                  saveText();
                }
              }}
            />
          ) : (
            <div className="grid h-full place-items-center p-8 text-center text-[13px] text-slate-400">Keine Vorschau verfuegbar.</div>
          )}
        </div>
      </div>
    </FurrWindow>
  );
}
