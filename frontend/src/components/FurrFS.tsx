"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Cloud, Download, File, FileArchive, FileImage, FileText, FolderSync, Search, Trash2, Upload } from "lucide-react";
import { FurrWindow } from "@/components/FurrWindow";
import { deleteFile, downloadFile, listFiles, uploadFile } from "@/lib/files";
import { useFurrBoxStore, type FurrFile } from "@/store/furrbox-store";
import type { FurrWindowState } from "@/store/useWindowStore";

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function FileIcon({ file }: { file: FurrFile }) {
  if (file.mimeType.startsWith("image/")) return <FileImage size={20} />;
  if (file.mimeType.includes("zip") || file.mimeType.includes("compressed")) return <FileArchive size={20} />;
  if (file.mimeType.startsWith("text/") || file.mimeType.includes("pdf")) return <FileText size={20} />;
  return <File size={20} />;
}

export function FurrFS({ windowState }: { windowState: FurrWindowState }) {
  const { files, socket, connected, token, activeFileScope, uploadProgress, setFiles, setUploadProgress, setActiveFileScope } = useFurrBoxStore();
  const [dragging, setDragging] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => files.filter((file) => file.originalName.toLowerCase().includes(query.toLowerCase())), [files, query]);

  const refresh = useCallback(async () => {
    if (!token) return;
    setFiles(await listFiles(token, activeFileScope));
  }, [activeFileScope, setFiles, token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const selected = Array.from(fileList);
      if (!selected.length || !token) return;
      setBusy(true);
      try {
        for (const file of selected) {
          setUploadProgress(3);
          await uploadFile(file, token, activeFileScope, setUploadProgress);
          socket?.emit("file-uploaded", { scope: activeFileScope });
        }
        await refresh();
      } finally {
        setUploadProgress(0);
        setBusy(false);
      }
    },
    [activeFileScope, refresh, setUploadProgress, socket, token]
  );

  return (
    <FurrWindow windowState={windowState} icon={<FolderSync size={15} />}>
      <div className="grid h-full grid-cols-[210px_1fr]">
        <aside className="border-r border-white/45 bg-white/24 p-4">
          <div className="mb-5 flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-sky-500 text-white shadow-lg shadow-sky-500/25">
              <FolderSync size={21} />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-slate-800">FurrFS</p>
              <p className="text-[11px] text-slate-500">{connected ? "Secure sync online" : "Offline retrying"}</p>
            </div>
          </div>

          {[
            { label: "My Files", scope: "private" as const },
            { label: "Shared Network", scope: "public" as const }
          ].map((item) => (
            <button
              key={item.scope}
              className={`mb-1 flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] ${
                activeFileScope === item.scope ? "bg-white/70 text-slate-900 shadow-sm" : "text-slate-600 hover:bg-white/42"
              }`}
              onClick={() => {
                setActiveFileScope(item.scope);
                if (token) listFiles(token, item.scope).then(setFiles);
              }}
            >
              <File size={15} />
              {item.label}
            </button>
          ))}
        </aside>

        <main className="flex min-w-0 flex-col p-5">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 flex-1 items-center gap-2 rounded-xl border border-white/60 bg-white/55 px-3">
              <Search size={16} className="text-slate-500" />
              <input
                className="w-full bg-transparent text-[13px] text-slate-700 outline-none placeholder:text-slate-400"
                placeholder={activeFileScope === "public" ? "Search public shared files" : "Search private files"}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <label className="flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-slate-900 px-4 text-[13px] font-semibold text-white shadow-lg shadow-slate-900/20 hover:bg-slate-800">
              <Upload size={16} />
              Upload
              <input className="hidden" type="file" multiple onChange={(event) => event.target.files && handleFiles(event.target.files)} />
            </label>
          </div>

          <div
            className={`mb-4 grid min-h-32 place-items-center rounded-2xl border border-dashed p-5 text-center transition ${
              dragging ? "border-sky-500 bg-sky-100/70" : "border-slate-300/80 bg-white/36"
            }`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              handleFiles(event.dataTransfer.files);
            }}
          >
            <div>
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-white text-sky-600 shadow-sm">
                <Cloud size={24} />
              </div>
              <p className="text-[14px] font-semibold text-slate-800">{activeFileScope === "public" ? "Drop files into Shared Network" : "Drop files into My Files"}</p>
              <p className="mt-1 text-[12px] text-slate-500">
                {activeFileScope === "public" ? "Public uploads sync instantly to all active users." : "Private uploads stay isolated to your FurrBox account."}
              </p>
              {busy && (
                <div className="mx-auto mt-4 h-2 w-56 overflow-hidden rounded-full bg-white/70">
                  <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${uploadProgress}%` }} />
                </div>
              )}
            </div>
          </div>

          <div className="scroll-soft min-h-0 flex-1 overflow-auto rounded-2xl border border-white/52 bg-white/42">
            <div className="grid grid-cols-[1fr_110px_150px_96px] border-b border-white/60 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
              <span>Name</span>
              <span>Size</span>
              <span>Uploaded</span>
              <span>Actions</span>
            </div>
            {filtered.length === 0 ? (
              <div className="grid h-32 place-items-center text-[13px] text-slate-500">No synced files yet.</div>
            ) : (
              filtered.map((file) => (
                <div
                  key={file.id}
                  className="grid grid-cols-[1fr_110px_150px_96px] items-center border-b border-white/46 px-4 py-3 text-[13px] last:border-0 hover:bg-white/45"
                  data-furr-context="file"
                  data-file-id={file.id}
                  data-file-name={file.originalName}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-slate-600 shadow-sm">
                      <FileIcon file={file} />
                    </span>
                    <span className="truncate font-medium text-slate-800">{file.originalName}</span>
                  </div>
                  <span className="text-slate-500">{formatSize(file.size)}</span>
                  <span className="text-slate-500">{new Date(file.uploadedAt).toLocaleString()}</span>
                  <div className="flex items-center gap-1">
                    <button className="grid h-8 w-8 place-items-center rounded-lg text-slate-600 hover:bg-white" onClick={() => token && downloadFile(file, token)}>
                      <Download size={15} />
                    </button>
                    <button className="grid h-8 w-8 place-items-center rounded-lg text-slate-600 hover:bg-red-500 hover:text-white" onClick={() => token && deleteFile(file.id, token).then(refresh)}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </main>
      </div>
    </FurrWindow>
  );
}
