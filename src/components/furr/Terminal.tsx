// FurrTerminal: platform-neutral shell (Linux + Windows command names) operating on FurrFS.
// Replaces the node-pty host shell, which cannot run in a serverless deployment.
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createFolder, deleteEntry, listFiles, readFileByPath, renameEntry, saveTextFile } from "@/lib/furr/api/files";
import { listPresence } from "@/lib/furr/api/presence";
import { errorMessage, useMe } from "@/lib/furr/client";
import { formatSize, normalizePath } from "@/lib/furr/paths";
import type { FurrFile, Scope } from "@/lib/furr/types";
import { useDesktop } from "@/store/desktop";
import { openFurrFile } from "./FurrFS";

type Cwd = { scope: Scope; folder: string };

const ALIASES: Record<string, string> = {
  dir: "ls",
  cls: "clear",
  type: "cat",
  md: "mkdir",
  del: "rm",
  erase: "rm",
  rd: "rmdir",
  ren: "mv",
  rename: "mv",
  move: "mv",
  start: "open",
  who: "users",
  ver: "uname",
  new: "touch",
  echo: "echo",
};

const HELP = [
  "FurrShell – Befehle (Linux- und Windows-Namen funktionieren):",
  "  ls | dir [pfad]        Ordnerinhalt anzeigen",
  "  cd <pfad>              Ordner wechseln (~ = Privat, /public = Shared Network, ..)",
  "  pwd                    aktuellen Pfad anzeigen",
  "  cat | type <datei>     Textdatei ausgeben",
  "  touch | new <datei>    leeres Textdokument anlegen",
  "  echo <text> > datei    in Datei schreiben (>> hängt an)",
  "  mkdir | md <ordner>    Ordner anlegen",
  "  mv | ren <alt> <neu>   umbenennen",
  "  rm | del <name>        Datei/Ordner löschen",
  "  open | start <datei>   im FurrFS Viewer öffnen",
  "  whoami, users | who, date, uname | ver, history, clear | cls, exit",
];

function display(cwd: Cwd) {
  const root = cwd.scope === "private" ? "~" : "/public";
  return cwd.folder ? `${root}/${cwd.folder}` : root;
}

function resolve(cwd: Cwd, input: string): Cwd {
  const raw = input.trim().replace(/\\/g, "/");
  if (!raw || raw === "~") return { scope: "private", folder: "" };
  if (raw.startsWith("~/")) return { scope: "private", folder: normalizePath(raw.slice(2)) };
  if (raw === "/public" || raw.startsWith("/public/")) return { scope: "public", folder: normalizePath(raw.slice(7)) };
  if (raw === "/" || /^[a-z]:\/?$/i.test(raw)) return { scope: "private", folder: "" };
  if (raw.startsWith("/")) return { scope: "private", folder: normalizePath(raw) };
  return { scope: cwd.scope, folder: normalizePath(`${cwd.folder}/${raw}`) };
}

function split(path: string) {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? { folder: "", name: path } : { folder: path.slice(0, idx), name: path.slice(idx + 1) };
}

function tokenize(line: string) {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

export function Terminal({ windowId }: { windowId: string }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const closeWindow = useDesktop((s) => s.closeWindow);
  const [cwd, setCwd] = useState<Cwd>({ scope: "private", folder: "" });
  const [lines, setLines] = useState<string[]>(["FurrBox FurrShell ready. Tippe \"help\" für alle Befehle.", ""]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  const user = me.data?.username ?? "furr";
  const prompt = `${user}@furrbox:${display(cwd)}$`;

  async function find(target: Cwd): Promise<FurrFile | null> {
    const { folder, name } = split(target.folder);
    const files = await listFiles({ data: { scope: target.scope, folder } });
    return files.find((f) => f.name.toLowerCase() === name.toLowerCase()) ?? null;
  }

  async function exec(line: string): Promise<string[]> {
    const redirect = line.match(/^(.*?)\s*(>>?)\s*(\S+)\s*$/);
    const [rawCmd, ...args] = tokenize(redirect && /^echo\b/i.test(line) ? redirect[1] : line);
    const cmd = ALIASES[rawCmd.toLowerCase()] ?? rawCmd.toLowerCase();
    const out: string[] = [];
    const changed = () => void queryClient.invalidateQueries({ queryKey: ["furr", "files"] });

    switch (cmd) {
      case "help":
        return HELP;
      case "clear":
        setLines([]);
        return [];
      case "pwd":
        return [display(cwd)];
      case "whoami":
        return [me.data ? `${me.data.username} (${me.data.roleLabel})` : user];
      case "date":
        return [new Date().toLocaleString("de-DE")];
      case "uname":
        return ["FurrBox FurrShell 2.0 (web)"];
      case "history":
        return history.map((h, i) => `${String(i + 1).padStart(4)}  ${h}`);
      case "exit":
        closeWindow(windowId);
        return [];
      case "ls": {
        const target = args[0] ? resolve(cwd, args[0]) : cwd;
        const files = await listFiles({ data: { scope: target.scope, folder: target.folder } });
        if (!files.length) return ["(leer)"];
        return files.map((f) =>
          f.isFolder
            ? `  <DIR>          ${f.name}/`
            : `  ${formatSize(f.size).padStart(10)}     ${f.name}`,
        );
      }
      case "cd": {
        const target = resolve(cwd, args[0] ?? "~");
        if (target.folder) {
          const entry = await find(target);
          if (!entry || !entry.isFolder) return [`cd: ${args[0]}: Ordner nicht gefunden`];
          target.folder = entry.path;
        }
        setCwd(target);
        return [];
      }
      case "cat": {
        if (!args[0]) return ["cat: Dateiname fehlt"];
        const target = resolve(cwd, args[0]);
        const res = await readFileByPath({ data: { scope: target.scope, path: target.folder } });
        if (!res || res.file.isFolder) return [`cat: ${args[0]}: Datei nicht gefunden`];
        return res.text.split(/\r?\n/);
      }
      case "touch": {
        if (!args[0]) return ["touch: Dateiname fehlt"];
        const target = resolve(cwd, args[0]);
        const { folder, name } = split(target.folder);
        const existing = await readFileByPath({ data: { scope: target.scope, path: target.folder } });
        if (!existing) await saveTextFile({ data: { scope: target.scope, folder, name, content: "" } });
        changed();
        return [];
      }
      case "echo": {
        const text = args.join(" ");
        if (!redirect || !/^echo\b/i.test(line)) return [text];
        const target = resolve(cwd, redirect[3]);
        const { folder, name } = split(target.folder);
        let content = `${text}\n`;
        if (redirect[2] === ">>") {
          const existing = await readFileByPath({ data: { scope: target.scope, path: target.folder } });
          content = (existing?.text ?? "") + content;
        }
        await saveTextFile({ data: { scope: target.scope, folder, name, content } });
        changed();
        return [];
      }
      case "mkdir": {
        if (!args[0]) return ["mkdir: Ordnername fehlt"];
        const target = resolve(cwd, args[0]);
        const { folder, name } = split(target.folder);
        await createFolder({ data: { scope: target.scope, folder, name } });
        changed();
        return [];
      }
      case "mv": {
        if (args.length < 2) return ["mv: Nutzung: mv <alt> <neu>"];
        const entry = await find(resolve(cwd, args[0]));
        if (!entry) return [`mv: ${args[0]}: nicht gefunden`];
        await renameEntry({ data: { id: entry.id, name: args[1] } });
        changed();
        return [];
      }
      case "rm":
      case "rmdir": {
        const names = args.filter((a) => !a.startsWith("-") && !a.startsWith("/s") && !a.startsWith("/q"));
        if (!names.length) return [`${rawCmd}: Name fehlt`];
        for (const n of names) {
          const entry = await find(resolve(cwd, n));
          if (!entry) out.push(`${rawCmd}: ${n}: nicht gefunden`);
          else await deleteEntry({ data: entry.id });
        }
        changed();
        return out;
      }
      case "open": {
        if (!args[0]) return ["open: Dateiname fehlt"];
        const entry = await find(resolve(cwd, args[0]));
        if (!entry || entry.isFolder) return [`open: ${args[0]}: Datei nicht gefunden`];
        openFurrFile(entry);
        return [`Öffne ${entry.name}…`];
      }
      case "users": {
        const users = await listPresence({ data: "global" });
        return users
          .filter((u) => u.hasAccount)
          .map((u) => `  ${u.isAppOnline ? "●" : "○"} ${u.displayName.padEnd(22)} ${u.roleLabel.padEnd(18)} ${u.isAppOnline ? (u.platform ?? "") : "offline"}`);
      }
      default:
        return [`Befehl nicht gefunden: ${rawCmd}. Tippe "help".`];
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const line = input.trim();
    setInput("");
    setHistIdx(-1);
    setLines((l) => [...l, `${prompt} ${line}`]);
    if (!line) return;
    setHistory((h) => [...h, line].slice(-200));
    setBusy(true);
    try {
      const out = await exec(line);
      if (out.length) setLines((l) => [...l, ...out].slice(-800));
    } catch (error) {
      setLines((l) => [...l, `Fehler: ${errorMessage(error)}`]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowUp" && history.length) {
      e.preventDefault();
      const idx = histIdx === -1 ? history.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(idx);
      setInput(history[idx]);
    } else if (e.key === "ArrowDown" && histIdx !== -1) {
      e.preventDefault();
      const idx = histIdx + 1;
      if (idx >= history.length) {
        setHistIdx(-1);
        setInput("");
      } else {
        setHistIdx(idx);
        setInput(history[idx]);
      }
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      setLines([]);
    }
  }

  return (
    <div className="flex h-full flex-col bg-[#0d0f12] p-3 font-mono text-[13px] text-[#d7e0ea]" onClick={() => inputRef.current?.focus()}>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words leading-relaxed">
        {lines.join("\n")}
      </div>
      <form onSubmit={submit} className="mt-1 flex gap-2">
        <span className="shrink-0 text-accent">{prompt}</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          disabled={busy}
          className="min-w-0 flex-1 bg-transparent outline-none"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          aria-label="Terminalbefehl"
        />
      </form>
    </div>
  );
}
