"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  File,
  FileArchive,
  FileImage,
  FileText,
  FolderSync,
  Image,
  LayoutList,
  Search,
  SlidersHorizontal,
  Upload,
  X
} from "lucide-react";
import { FurrWindow } from "@/components/FurrWindow";
import { deleteFile, listFiles, readFileBlobUrl, readFileText, uploadFile } from "@/lib/files";
import { useFurrBoxStore, type FurrFile } from "@/store/furrbox-store";
import type { FurrWindowState } from "@/store/useWindowStore";

type TreeNode = {
  id: string;
  label: string;
  path: string;
  children?: TreeNode[];
};

type ExplorerRow =
  | { kind: "folder"; id: string; name: string; path: string; modified: string; type: "Dateiordner"; size: "" }
  | { kind: "file"; id: string; name: string; path: string; modified: string; type: string; size: string; file: FurrFile };

const baseTree: TreeNode[] = [
  {
    id: "pc",
    label: "Dieser PC",
    path: "",
    children: [
      {
        id: "documents",
        label: "Dokumente",
        path: "Dokumente",
        children: [
          { id: "desktop", label: "virtuelle Privater desktop", path: "Dokumente/virtuelle Privater desktop" },
          { id: "evidence", label: "Moderation_Beweise", path: "Dokumente/Moderation_Beweise" }
        ]
      },
      { id: "pictures", label: "Bilder", path: "Bilder" },
      { id: "network", label: "Netzwerk", path: "Netzwerk" }
    ]
  }
];

function displayName(file: FurrFile) {
  return file.displayName || file.originalName.split(/[\\/]/).pop() || file.originalName;
}

function virtualPath(file: FurrFile) {
  if (file.virtualPath !== undefined) return file.virtualPath;
  const parts = file.originalName.split(/[\\/]/);
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "Dokumente/virtuelle Privater desktop/release";
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function fileType(file: FurrFile) {
  if (file.mimeType.startsWith("image/")) return "Bilddatei";
  if (file.mimeType.startsWith("video/")) return "Videoclip";
  if (file.mimeType.includes("json")) return "JSON-Datei";
  if (file.mimeType.startsWith("text/")) return "Textdokument";
  if (file.mimeType.includes("zip") || file.mimeType.includes("compressed")) return "Komprimierter Ordner";
  return "Datei";
}

function isTextDocument(file: FurrFile) {
  const name = displayName(file).toLowerCase();
  return file.mimeType.startsWith("text/") || file.mimeType.includes("json") || name.endsWith(".txt") || name.endsWith(".log") || name.endsWith(".md") || name.endsWith(".json");
}

function FileIcon({ file }: { file: FurrFile }) {
  if (file.mimeType.startsWith("image/")) return <FileImage size={18} />;
  if (file.mimeType.includes("zip") || file.mimeType.includes("compressed")) return <FileArchive size={18} />;
  if (file.mimeType.startsWith("text/") || file.mimeType.includes("json")) return <FileText size={18} />;
  return <File size={18} />;
}

function NeonFolderIcon({ open = false, size = 18 }: { open?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3.5 7.2A2.2 2.2 0 0 1 5.7 5h4.15l2 2.05h6.45a2.2 2.2 0 0 1 2.2 2.2v1.15H3.5V7.2Z" fill="rgba(0,240,255,0.18)" stroke="#00f0ff" strokeWidth="1.35" />
      <path d="M3.35 10.15h17.3l-1.34 7.25a2.45 2.45 0 0 1-2.4 2H6.6a2.45 2.45 0 0 1-2.4-2l-.85-7.25Z" fill={open ? "rgba(255,0,127,0.20)" : "rgba(139,92,246,0.18)"} stroke={open ? "#ff007f" : "#8b5cf6"} strokeWidth="1.35" />
      <path d="M6 13h12" stroke="#00f0ff" strokeWidth="1" strokeLinecap="round" opacity=".65" />
    </svg>
  );
}

function pathSegments(path: string) {
  return path ? path.split("/").filter(Boolean) : ["Dieser PC"];
}

function childFolderRows(files: FurrFile[], currentPath: string): ExplorerRow[] {
  const folders = new Map<string, string>();
  for (const file of files) {
    const path = virtualPath(file);
    if (!path.startsWith(currentPath)) continue;
    const rest = path.slice(currentPath.length).replace(/^\/+/, "");
    const folderName = rest.split("/").filter(Boolean)[0];
    if (folderName) folders.set(folderName, currentPath ? `${currentPath}/${folderName}` : folderName);
  }
  return [...folders.entries()].map(([name, path]) => ({
    kind: "folder",
    id: `folder:${path}`,
    name,
    path,
    modified: new Date().toLocaleString(),
    type: "Dateiordner",
    size: ""
  }));
}

function TreeBranch({ node, currentPath, expanded, toggle, navigate, depth = 0 }: { node: TreeNode; currentPath: string; expanded: Set<string>; toggle: (id: string) => void; navigate: (path: string) => void; depth?: number }) {
  const hasChildren = Boolean(node.children?.length);
  const isOpen = expanded.has(node.id);
  const selected = currentPath === node.path;
  return (
    <div>
      <button
        className={`flex h-8 w-full items-center gap-1 rounded-md pr-2 text-left text-[13px] transition ${selected ? "bg-cyan-400/10 text-[#00f0ff] shadow-[inset_2px_0_0_#00f0ff,0_0_14px_rgba(0,240,255,0.12)]" : "text-slate-300 hover:bg-white/5 hover:text-slate-100"}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => {
          if (hasChildren) toggle(node.id);
          navigate(node.path);
        }}
      >
        {hasChildren ? isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : <span className="w-3.5" />}
        <NeonFolderIcon open={isOpen} size={16} />
        <span className="truncate">{node.label}</span>
      </button>
      {hasChildren && isOpen ? node.children!.map((child) => <TreeBranch key={child.id} node={child} currentPath={currentPath} expanded={expanded} toggle={toggle} navigate={navigate} depth={depth + 1} />) : null}
    </div>
  );
}

export function FurrFS({ windowState }: { windowState: FurrWindowState }) {
  const { files, socket, connected, token, activeFileScope, uploadProgress, setFiles, setUploadProgress, setActiveFileScope } = useFurrBoxStore();
  const [currentPath, setCurrentPath] = useState("Dokumente/virtuelle Privater desktop/release");
  const [history, setHistory] = useState<string[]>([]);
  const [future, setFuture] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(() => new Set(["pc", "documents"]));
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);
  const [textPreview, setTextPreview] = useState<{ name: string; content: string; type: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    setFiles(await listFiles(token, activeFileScope));
  }, [activeFileScope, setFiles, token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onDelete = (event: Event) => {
      const detail = (event as CustomEvent<{ targetId?: string }>).detail;
      if (detail?.targetId && token) deleteFile(detail.targetId, token).then(refresh);
    };
    window.addEventListener("furrfs:delete", onDelete);
    return () => window.removeEventListener("furrfs:delete", onDelete);
  }, [refresh, token]);

  const rows = useMemo(() => {
    const folderRows = childFolderRows(files, currentPath);
    const fileRows: ExplorerRow[] = files
      .filter((file) => virtualPath(file) === currentPath)
      .map((file) => ({
        kind: "file",
        id: file.id,
        name: displayName(file),
        path: virtualPath(file),
        modified: new Date(file.uploadedAt).toLocaleString(),
        type: fileType(file),
        size: formatSize(file.size),
        file
      }));
    return [...folderRows, ...fileRows]
      .filter((row) => row.name.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "folder" ? -1 : 1));
  }, [currentPath, files, query]);

  const navigate = useCallback(
    (path: string) => {
      if (path === currentPath) return;
      setHistory((items) => [...items, currentPath]);
      setFuture([]);
      setCurrentPath(path);
    },
    [currentPath]
  );

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

  async function openRow(row: ExplorerRow) {
    if (row.kind === "folder") {
      navigate(row.path);
      return;
    }
    if (row.file.mimeType.startsWith("image/") && token) {
      const url = await readFileBlobUrl(row.file, token);
      setPreview({ name: row.name, url });
      return;
    }
    if (isTextDocument(row.file) && token) {
      const content = await readFileText(row.file, token);
      setTextPreview({ name: row.name, content, type: row.type });
    }
  }

  return (
    <FurrWindow windowState={windowState} icon={<FolderSync size={15} />}>
      <div className="grid h-full grid-cols-[245px_1fr] bg-slate-950/80 text-slate-100">
        <aside className="scroll-soft overflow-auto border-r border-purple-500/20 bg-slate-900/45 p-3 shadow-[inset_-1px_0_0_rgba(0,240,255,0.08)]">
          <div className="mb-3 flex items-center gap-2 px-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg border border-cyan-300/25 bg-slate-950/80 text-[#00f0ff] shadow-[0_0_18px_rgba(0,240,255,0.28)]">
              <FolderSync size={19} />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-slate-100">FurrFS Explorer</p>
              <p className={connected ? "text-[11px] font-medium text-[#00f0ff]" : "text-[11px] font-medium text-[#ff007f]"}>{connected ? "Live synchronisiert" : "Offline"}</p>
            </div>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg border border-white/5 bg-slate-950/70 p-1">
            {[
              { label: "Privat", scope: "private" as const },
              { label: "Public", scope: "public" as const }
            ].map((item) => (
              <button
                key={item.scope}
                className={`h-8 rounded-md text-[12px] font-semibold transition ${activeFileScope === item.scope ? "bg-[#00f0ff]/12 text-[#00f0ff] shadow-[0_0_14px_rgba(0,240,255,0.18)]" : "text-slate-400 hover:text-slate-100"}`}
                onClick={() => {
                  setActiveFileScope(item.scope);
                  if (token) listFiles(token, item.scope).then(setFiles);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          {baseTree.map((node) => (
            <TreeBranch
              key={node.id}
              node={node}
              currentPath={currentPath}
              expanded={expanded}
              toggle={(id) =>
                setExpanded((state) => {
                  const next = new Set(state);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
              navigate={navigate}
            />
          ))}
        </aside>

        <main className="flex min-w-0 flex-col">
          <div className="border-b border-purple-500/20 bg-slate-900/50 p-3 shadow-[inset_0_-1px_0_rgba(0,240,255,0.08)]">
            <div className="mb-3 flex items-center gap-2">
              <button className="grid h-8 w-8 place-items-center rounded-lg border border-white/5 text-slate-300 hover:border-cyan-300/30 hover:bg-cyan-500/10 hover:text-[#00f0ff] disabled:opacity-35" disabled={!history.length} onClick={() => {
                const previous = history.at(-1);
                if (!previous) return;
                setHistory((items) => items.slice(0, -1));
                setFuture((items) => [currentPath, ...items]);
                setCurrentPath(previous);
              }}>
                <ArrowLeft size={16} />
              </button>
              <button className="grid h-8 w-8 place-items-center rounded-lg border border-white/5 text-slate-300 hover:border-cyan-300/30 hover:bg-cyan-500/10 hover:text-[#00f0ff] disabled:opacity-35" disabled={!future.length} onClick={() => {
                const next = future[0];
                if (!next) return;
                setFuture((items) => items.slice(1));
                setHistory((items) => [...items, currentPath]);
                setCurrentPath(next);
              }}>
                <ArrowRight size={16} />
              </button>
              <div className="flex h-9 min-w-0 flex-1 items-center gap-1 rounded-lg border border-cyan-300/15 bg-slate-950/65 px-3 text-[13px] text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                {pathSegments(currentPath).map((segment, index, segments) => (
                  <span key={`${segment}-${index}`} className="flex items-center gap-1">
                    <button className="rounded px-1 hover:bg-cyan-500/10 hover:text-[#00f0ff]" onClick={() => navigate(segments.slice(0, index + 1).join("/"))}>{segment}</button>
                    {index < segments.length - 1 ? <ChevronRight size={13} className="text-purple-300/70" /> : null}
                  </span>
                ))}
              </div>
              <div className="flex h-9 w-64 items-center gap-2 rounded-lg border border-cyan-300/15 bg-slate-950/65 px-3">
                <Search size={15} className="text-[#00f0ff]" />
                <input className="min-w-0 flex-1 bg-transparent text-[13px] text-slate-100 outline-none placeholder:text-slate-500" placeholder="Suchen" value={query} onChange={(event) => setQuery(event.target.value)} />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <button className="flex h-8 items-center gap-2 rounded-lg border border-white/5 px-3 text-[13px] text-slate-300 hover:border-purple-400/30 hover:bg-purple-500/10 hover:text-violet-100"><SlidersHorizontal size={15} />Sortieren</button>
                <button className="flex h-8 items-center gap-2 rounded-lg border border-white/5 px-3 text-[13px] text-slate-300 hover:border-purple-400/30 hover:bg-purple-500/10 hover:text-violet-100"><LayoutList size={15} />Anzeigen</button>
              </div>
              <label className="flex h-8 cursor-pointer items-center gap-2 rounded-none border border-cyan-300/30 bg-slate-950 px-3 text-[12px] font-bold uppercase tracking-[0.08em] text-white shadow-[2px_2px_0px_#ff007f,0_0_18px_rgba(255,0,127,0.25)] transition hover:-translate-y-0.5 hover:border-[#00f0ff] hover:text-[#00f0ff]">
                <Upload size={14} />
                Upload
                <input className="hidden" type="file" multiple onChange={(event) => event.target.files && handleFiles(event.target.files)} />
              </label>
            </div>
          </div>

          <div
            className={`scroll-soft min-h-0 flex-1 overflow-auto p-3 transition ${dragging ? "bg-cyan-500/10 shadow-[inset_0_0_0_1px_rgba(0,240,255,0.35)]" : "bg-slate-950/30"}`}
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
            <div className="min-w-[720px] overflow-hidden rounded-lg border border-purple-500/20 bg-slate-950/60 shadow-[0_0_24px_rgba(139,92,246,0.14),inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="grid grid-cols-[1fr_180px_150px_100px] border-b border-purple-500/20 bg-slate-900/70 px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.04em] text-cyan-100/70">
                <span>Name</span>
                <span>Änderungsdatum</span>
                <span>Typ</span>
                <span>Größe</span>
              </div>
              {rows.length === 0 ? (
                <div className="grid h-44 place-items-center text-[13px] text-slate-400">{busy ? `Upload ${uploadProgress}%` : "Dieser Ordner ist leer."}</div>
              ) : (
                rows.map((row) => (
                  <div
                    key={row.id}
                    className="grid grid-cols-[1fr_180px_150px_100px] items-center border-b border-white/5 px-3 py-2 text-[13px] last:border-0 hover:bg-cyan-500/10 hover:shadow-[inset_2px_0_0_#00f0ff]"
                    onDoubleClick={() => openRow(row)}
                    data-furr-context={row.kind}
                    data-file-id={row.kind === "file" ? row.file.id : row.id}
                    data-file-name={row.name}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={row.kind === "folder" ? "text-[#00f0ff]" : "text-violet-200"}>{row.kind === "folder" ? <NeonFolderIcon size={18} /> : <FileIcon file={row.file} />}</span>
                      <span className="truncate text-slate-100">{row.name}</span>
                    </div>
                    <span className="text-slate-400">{row.modified}</span>
                    <span className="text-slate-400">{row.type}</span>
                    <span className="text-slate-400">{row.size}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </main>
      </div>

      {preview ? (
        <div className="fixed inset-0 z-[10010] grid place-items-center bg-black/70 p-8 backdrop-blur-sm">
          <div className="max-h-full max-w-5xl overflow-hidden rounded-2xl bg-slate-950 shadow-2xl">
            <div className="flex h-11 items-center justify-between border-b border-white/10 px-4 text-white">
              <div className="flex items-center gap-2 text-[13px] font-semibold"><Image size={16} />{preview.name}</div>
              <button onClick={() => {
                URL.revokeObjectURL(preview.url);
                setPreview(null);
              }} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white/10"><X size={16} /></button>
            </div>
            <img src={preview.url} alt={preview.name} className="max-h-[78vh] max-w-full object-contain" />
          </div>
        </div>
      ) : null}

      {textPreview ? (
        <div className="fixed inset-0 z-[10010] grid place-items-center bg-black/70 p-8 backdrop-blur-sm">
          <div className="flex max-h-full w-[min(920px,calc(100vw-64px))] flex-col overflow-hidden rounded-2xl border border-cyan-300/20 bg-slate-950 shadow-[0_0_40px_rgba(0,240,255,0.2)]">
            <div className="flex h-12 items-center justify-between border-b border-white/10 px-4 text-white">
              <div className="flex min-w-0 items-center gap-2 text-[13px] font-semibold">
                <FileText size={16} className="text-[#00f0ff]" />
                <span className="truncate">{textPreview.name}</span>
                <span className="rounded border border-purple-500/25 bg-purple-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-purple-100">{textPreview.type}</span>
              </div>
              <button onClick={() => setTextPreview(null)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white/10"><X size={16} /></button>
            </div>
            <div className="border-b border-white/5 bg-slate-900/45 px-4 py-2 text-[11px] text-slate-500">
              Virtuelles Textdokument aus FurrFS / Moderation_Beweise
            </div>
            <pre className="scroll-soft max-h-[72vh] overflow-auto whitespace-pre-wrap bg-slate-950 p-5 font-mono text-[12px] leading-5 text-slate-200">{textPreview.content || "Dieses Textdokument ist leer."}</pre>
          </div>
        </div>
      ) : null}
    </FurrWindow>
  );
}
