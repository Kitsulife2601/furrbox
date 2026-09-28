// FurrFS Explorer: private home + Shared Network, folders, upload, text docs, cut/copy/paste.
import { useMemo, useRef, useState, type DragEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import {
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  File,
  FileText,
  Folder,
  FolderPlus,
  HardDrive,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Network,
  RefreshCw,
  Upload,
} from "lucide-react";
import { createFolder, deleteEntry, listFiles, pasteEntry, readFile, renameEntry, saveTextFile, uploadFile } from "@/lib/furr/api/files";
import { downloadBase64, errorMessage, fileToBase64 } from "@/lib/furr/client";
import { EVIDENCE_ROOT, MAX_UPLOAD_BYTES, formatSize, isImage, isTextLike } from "@/lib/furr/paths";
import type { FurrFile, Scope } from "@/lib/furr/types";
import { cn } from "@/lib/utils";
import { useDesktop, type WindowPayload } from "@/store/desktop";
import { notifyError, useNotifications } from "@/store/notifications";
import { Btn, ConfirmDialog, Empty, PopupMenu, PromptDialog, type MenuItem } from "./ui";

type Location = { scope: Scope; folder: string } | { scope: "pc"; folder: "" };

export const useFurrClipboard = create<{ file: FurrFile | null; move: boolean; set: (file: FurrFile | null, move: boolean) => void }>(
  (set) => ({ file: null, move: false, set: (file, move) => set({ file, move }) }),
);

export const filesKey = (scope: Scope, folder: string) => ["furr", "files", scope, folder] as const;

const QUICK: { label: string; scope: Scope; folder: string }[] = [
  { label: "Desktop", scope: "private", folder: "Desktop" },
  { label: "Dokumente", scope: "private", folder: "Dokumente" },
  { label: "Downloads", scope: "private", folder: "Downloads" },
  { label: "Bilder", scope: "private", folder: "Bilder" },
  { label: "Moderation_Beweise", scope: "public", folder: EVIDENCE_ROOT },
];

function FileGlyph({ file, className }: { file: FurrFile; className?: string }) {
  if (file.isFolder) return <Folder className={cn("text-accent", className)} strokeWidth={1.4} />;
  if (isImage(file)) return <ImageIcon className={cn("text-muted", className)} strokeWidth={1.4} />;
  if (isTextLike(file)) return <FileText className={cn("text-muted", className)} strokeWidth={1.4} />;
  return <File className={cn("text-muted", className)} strokeWidth={1.4} />;
}

export async function uploadBrowserFiles(files: FileList | File[], scope: Scope, folder: string) {
  const notify = useNotifications.getState().notify;
  let done = 0;
  for (const file of Array.from(files)) {
    if (file.size > MAX_UPLOAD_BYTES) {
      notify({ version: "FurrFS", title: "Upload abgelehnt", description: `${file.name} ist größer als 3 MB.` });
      continue;
    }
    try {
      const base64 = await fileToBase64(file);
      await uploadFile({ data: { scope, folder, name: file.name, mimeType: file.type, base64 } });
      done += 1;
    } catch (error) {
      notifyError(error, `Upload fehlgeschlagen: ${file.name}`);
    }
  }
  if (done) notify({ version: "FurrFS", title: "Upload abgeschlossen", description: `${done} Datei(en) synchronisiert.` });
}

/** Opens a file the way FurrBox did: text in the editor, everything else in the viewer. */
export function openFurrFile(file: FurrFile) {
  const openApp = useDesktop.getState().openApp;
  openApp("viewer", { payload: { fileId: file.id, scope: file.scope, folder: file.folder }, title: file.name });
}

export function FurrFS({ payload, startAtPc }: { payload?: WindowPayload; startAtPc?: boolean }) {
  const queryClient = useQueryClient();
  const [loc, setLoc] = useState<Location>(
    startAtPc ? { scope: "pc", folder: "" } : { scope: payload?.scope ?? "private", folder: payload?.folder ?? "" },
  );
  const [history, setHistory] = useState<Location[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [sort, setSort] = useState<"name" | "date" | "size">("name");
  const [dialog, setDialog] = useState<null | "folder" | "text" | { rename: FurrFile } | { remove: FurrFile }>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; file: FurrFile | null } | null>(null);
  const [dragging, setDragging] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const clipboard = useFurrClipboard();

  const scope = loc.scope === "pc" ? null : loc.scope;
  const query = useQuery({
    queryKey: scope ? filesKey(scope, loc.folder) : ["furr", "files", "pc"],
    queryFn: () => listFiles({ data: { scope: scope!, folder: loc.folder } }),
    enabled: Boolean(scope),
    refetchInterval: 5_000,
  });

  const files = useMemo(() => {
    const list = (query.data ?? []).filter((f) => f.name.toLowerCase().includes(filter.toLowerCase()));
    return [...list].sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      if (sort === "date") return b.updatedAt.localeCompare(a.updatedAt);
      if (sort === "size") return b.size - a.size;
      return a.name.localeCompare(b.name, "de");
    });
  }, [query.data, filter, sort]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["furr", "files"] });

  function go(next: Location) {
    setHistory((h) => [...h, loc]);
    setLoc(next);
    setSelected(null);
    setFilter("");
  }

  function back() {
    const prev = history.at(-1);
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setLoc(prev);
  }

  function up() {
    if (loc.scope === "pc") return;
    if (!loc.folder) return go({ scope: "pc", folder: "" });
    const idx = loc.folder.lastIndexOf("/");
    go({ scope: loc.scope, folder: idx === -1 ? "" : loc.folder.slice(0, idx) });
  }

  function open(file: FurrFile) {
    if (file.isFolder) go({ scope: file.scope, folder: file.path });
    else openFurrFile(file);
  }

  async function run(task: () => Promise<unknown>, errorTitle: string) {
    try {
      await task();
      await refresh();
    } catch (error) {
      notifyError(error, errorTitle);
    }
  }

  async function download(file: FurrFile) {
    try {
      const res = await readFile({ data: file.id });
      downloadBase64(res.base64, file.name, file.mimeType);
    } catch (error) {
      notifyError(error, "Download fehlgeschlagen");
    }
  }

  function paste() {
    if (!clipboard.file || !scope) return;
    const { file, move } = clipboard;
    void run(async () => {
      await pasteEntry({ data: { id: file.id, scope, folder: loc.folder, move } });
      if (move) clipboard.set(null, false);
    }, "Einfügen fehlgeschlagen");
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (!scope || !e.dataTransfer.files.length) return;
    void uploadBrowserFiles(e.dataTransfer.files, scope, loc.folder).then(refresh);
  }

  const itemMenu = (file: FurrFile): MenuItem[] => [
    { label: "Öffnen", onClick: () => open(file) },
    ...(file.isFolder ? [] : [{ label: "Herunterladen", onClick: () => void download(file) }]),
    "divider",
    ...(file.isFolder
      ? []
      : [
          { label: "Ausschneiden", onClick: () => clipboard.set(file, true) },
          { label: "Kopieren", onClick: () => clipboard.set(file, false) },
        ]),
    { label: "Umbenennen", onClick: () => setDialog({ rename: file }) },
    { label: "Löschen", danger: true, onClick: () => setDialog({ remove: file }) },
  ];

  const folderMenu: MenuItem[] = [
    { label: "Neuer Ordner", onClick: () => setDialog("folder") },
    { label: "Neues Textdokument", onClick: () => setDialog("text") },
    { label: "Dateien hochladen", onClick: () => uploadRef.current?.click() },
    "divider",
    { label: clipboard.file ? `Einfügen (${clipboard.file.name})` : "Einfügen", disabled: !clipboard.file, onClick: paste },
    { label: "Aktualisieren", onClick: () => void refresh() },
  ];

  const crumbs = loc.scope === "pc" ? [] : loc.folder ? loc.folder.split("/") : [];
  const selectedFile = files.find((f) => f.id === selected) ?? null;

  return (
    <div className="relative flex h-full bg-bg/40 text-fg">
      <aside className="hidden w-52 shrink-0 overflow-auto border-r border-border bg-elevated/30 p-2 text-[13px] md:block">
        <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-subtle">Schnellzugriff</p>
        {QUICK.map((q) => (
          <button
            key={q.label}
            type="button"
            onClick={() => go({ scope: q.scope, folder: q.folder })}
            className={cn(
              "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-fg/6",
              loc.scope === q.scope && loc.folder === q.folder && "bg-fg/10",
            )}
          >
            <Folder className="size-4 text-accent" strokeWidth={1.5} />
            <span className="truncate">{q.label}</span>
          </button>
        ))}
        <p className="px-2 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wide text-subtle">Dieser PC</p>
        <button
          type="button"
          onClick={() => go({ scope: "private", folder: "" })}
          className={cn("flex w-full items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-fg/6", loc.scope === "private" && !loc.folder && "bg-fg/10")}
        >
          <HardDrive className="size-4" strokeWidth={1.5} /> Privat (Meine Dateien)
        </button>
        <button
          type="button"
          onClick={() => go({ scope: "public", folder: "" })}
          className={cn("flex w-full items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-fg/6", loc.scope === "public" && !loc.folder && "bg-fg/10")}
        >
          <Network className="size-4" strokeWidth={1.5} /> Shared Network
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
          <Btn variant="ghost" aria-label="Zurück" disabled={!history.length} onClick={back} className="px-2">
            <ArrowLeft className="size-4" />
          </Btn>
          <Btn variant="ghost" aria-label="Nach oben" disabled={loc.scope === "pc"} onClick={up} className="px-2">
            <ArrowUp className="size-4" />
          </Btn>
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden rounded-md bg-bg/60 px-2 py-1 text-[12px] text-muted">
            <button type="button" className="hover:text-fg" onClick={() => go({ scope: "pc", folder: "" })}>
              Dieser PC
            </button>
            {loc.scope !== "pc" && (
              <>
                <ChevronRight className="size-3 shrink-0" />
                <button type="button" className="hover:text-fg" onClick={() => go({ scope: loc.scope, folder: "" })}>
                  {loc.scope === "private" ? "Privat" : "Shared Network"}
                </button>
              </>
            )}
            {crumbs.map((seg, i) => (
              <span key={`${seg}-${i}`} className="flex min-w-0 items-center gap-1">
                <ChevronRight className="size-3 shrink-0" />
                <button
                  type="button"
                  className="truncate hover:text-fg"
                  onClick={() => scope && go({ scope, folder: crumbs.slice(0, i + 1).join("/") })}
                >
                  {seg}
                </button>
              </span>
            ))}
          </div>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Suchen"
            className="h-7 w-32 rounded-md bg-bg/60 px-2 text-[12px] outline-none"
          />
        </div>

        {scope && (
          <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
            <Btn variant="ghost" onClick={() => setDialog("folder")}>
              <FolderPlus className="size-4" /> Neuer Ordner
            </Btn>
            <Btn variant="ghost" onClick={() => setDialog("text")}>
              <FileText className="size-4" /> Textdokument
            </Btn>
            <Btn variant="ghost" onClick={() => uploadRef.current?.click()}>
              <Upload className="size-4" /> Hochladen
            </Btn>
            <Btn variant="ghost" disabled={!selectedFile || selectedFile.isFolder} onClick={() => selectedFile && clipboard.set(selectedFile, true)}>
              Ausschneiden
            </Btn>
            <Btn variant="ghost" disabled={!selectedFile || selectedFile.isFolder} onClick={() => selectedFile && clipboard.set(selectedFile, false)}>
              Kopieren
            </Btn>
            <Btn variant="ghost" disabled={!clipboard.file} onClick={paste}>
              Einfügen
            </Btn>
            <Btn variant="ghost" disabled={!selectedFile} onClick={() => selectedFile && setDialog({ rename: selectedFile })}>
              Umbenennen
            </Btn>
            <Btn variant="ghost" disabled={!selectedFile} onClick={() => selectedFile && setDialog({ remove: selectedFile })}>
              Löschen
            </Btn>
            <div className="ml-auto flex items-center gap-1">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
                className="h-7 rounded-md bg-bg/60 px-1 text-[12px] outline-none"
                aria-label="Sortieren"
              >
                <option value="name">Name</option>
                <option value="date">Änderungsdatum</option>
                <option value="size">Größe</option>
              </select>
              <Btn variant="ghost" className="px-2" aria-label="Ansicht wechseln" onClick={() => setView(view === "grid" ? "list" : "grid")}>
                {view === "grid" ? <List className="size-4" /> : <LayoutGrid className="size-4" />}
              </Btn>
              <Btn variant="ghost" className="px-2" aria-label="Aktualisieren" onClick={() => void refresh()}>
                <RefreshCw className={cn("size-4", query.isFetching && "animate-spin")} />
              </Btn>
            </div>
          </div>
        )}

        <div
          className={cn("relative min-h-0 flex-1 overflow-auto p-3", dragging && "outline-2 -outline-offset-4 outline-dashed outline-accent")}
          onClick={() => setSelected(null)}
          onContextMenu={(e) => {
            if (!scope) return;
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, file: null });
          }}
          onDragOver={(e) => {
            if (!scope) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          {loc.scope === "pc" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { scope: "private" as const, label: "Privat (Meine Dateien)", sub: "Nur für dich sichtbar", Icon: HardDrive },
                { scope: "public" as const, label: "Shared Network", sub: "Geteilter Team-Speicher", Icon: Network },
              ].map(({ scope: s, label, sub, Icon }) => (
                <button
                  key={s}
                  type="button"
                  onDoubleClick={() => go({ scope: s, folder: "" })}
                  onClick={() => go({ scope: s, folder: "" })}
                  className="flex items-center gap-3 rounded-md bg-elevated/50 p-4 text-left hover:bg-fg/8"
                >
                  <Icon className="size-8 text-accent" strokeWidth={1.4} />
                  <span>
                    <span className="block text-[13px] font-medium">{label}</span>
                    <span className="block text-[12px] text-muted">{sub}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : query.isError ? (
            <Empty>FurrFS konnte keine Dateien laden: {errorMessage(query.error)}</Empty>
          ) : query.isLoading ? (
            <Empty>Lade Dateien…</Empty>
          ) : !files.length ? (
            <Empty>{filter ? "Keine Treffer." : "Dieser Ordner ist leer. Dateien hierher ziehen zum Hochladen."}</Empty>
          ) : view === "grid" ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-1">
              {files.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected(f.id);
                  }}
                  onDoubleClick={() => open(f)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelected(f.id);
                    setMenu({ x: e.clientX, y: e.clientY, file: f });
                  }}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-md px-1 py-2 text-center hover:bg-fg/6",
                    selected === f.id && "bg-accent/20",
                    clipboard.file?.id === f.id && clipboard.move && "opacity-50",
                  )}
                >
                  <FileGlyph file={f} className="size-9" />
                  <span className="line-clamp-2 break-all text-[12px] leading-snug">{f.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <table className="w-full text-left text-[12px]">
              <thead className="text-muted">
                <tr>
                  <th className="px-2 py-1 font-medium">Name</th>
                  <th className="px-2 py-1 font-medium">Änderungsdatum</th>
                  <th className="px-2 py-1 font-medium">Typ</th>
                  <th className="px-2 py-1 text-right font-medium">Größe</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr
                    key={f.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelected(f.id);
                    }}
                    onDoubleClick={() => open(f)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setSelected(f.id);
                      setMenu({ x: e.clientX, y: e.clientY, file: f });
                    }}
                    className={cn("cursor-default hover:bg-fg/6", selected === f.id && "bg-accent/20")}
                  >
                    <td className="flex items-center gap-2 px-2 py-1.5">
                      <FileGlyph file={f} className="size-4 shrink-0" />
                      <span className="truncate">{f.name}</span>
                    </td>
                    <td className="px-2 py-1.5 text-muted">{new Date(f.updatedAt).toLocaleString("de-DE")}</td>
                    <td className="px-2 py-1.5 text-muted">{f.isFolder ? "Dateiordner" : f.mimeType}</td>
                    <td className="px-2 py-1.5 text-right text-muted">{f.isFolder ? "" : formatSize(f.size)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-border px-3 py-1 text-[11px] text-subtle">
          <span>
            {scope ? `${files.length} Elemente` : "2 Speicherorte"}
            {selectedFile && !selectedFile.isFolder ? ` · ${selectedFile.name} (${formatSize(selectedFile.size)})` : ""}
          </span>
          <span>{query.isError ? "Offline" : "Live synchronisiert"}</span>
        </div>
      </div>

      <input
        ref={uploadRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (scope && e.target.files?.length) void uploadBrowserFiles(e.target.files, scope, loc.folder).then(refresh);
          e.target.value = "";
        }}
      />

      {menu && <PopupMenu x={menu.x} y={menu.y} items={menu.file ? itemMenu(menu.file) : folderMenu} onClose={() => setMenu(null)} />}

      {dialog === "folder" && scope && (
        <PromptDialog
          title="Ordnername"
          initial="Neuer Ordner"
          confirmLabel="Erstellen"
          onCancel={() => setDialog(null)}
          onSubmit={(name) => {
            setDialog(null);
            void run(() => createFolder({ data: { scope, folder: loc.folder, name } }), "Ordner konnte nicht erstellt werden");
          }}
        />
      )}
      {dialog === "text" && scope && (
        <PromptDialog
          title="Name des Textdokuments"
          initial="Neues Textdokument.txt"
          confirmLabel="Erstellen"
          onCancel={() => setDialog(null)}
          onSubmit={(name) => {
            setDialog(null);
            void run(async () => {
              const file = await saveTextFile({ data: { scope, folder: loc.folder, name, content: "" } });
              openFurrFile(file);
            }, "Textdokument konnte nicht erstellt werden");
          }}
        />
      )}
      {dialog && typeof dialog === "object" && "rename" in dialog && (
        <PromptDialog
          title="Neuer Name"
          initial={dialog.rename.name}
          confirmLabel="Umbenennen"
          onCancel={() => setDialog(null)}
          onSubmit={(name) => {
            const id = dialog.rename.id;
            setDialog(null);
            void run(() => renameEntry({ data: { id, name } }), "Umbenennen fehlgeschlagen");
          }}
        />
      )}
      {dialog && typeof dialog === "object" && "remove" in dialog && (
        <ConfirmDialog
          title={`„${dialog.remove.name}“ löschen?`}
          body={dialog.remove.isFolder ? "Der Ordner und sein gesamter Inhalt werden gelöscht." : "Die Datei wird dauerhaft gelöscht."}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            const id = dialog.remove.id;
            setDialog(null);
            setSelected(null);
            void run(() => deleteEntry({ data: id }), "Löschen fehlgeschlagen");
          }}
        />
      )}
    </div>
  );
}
