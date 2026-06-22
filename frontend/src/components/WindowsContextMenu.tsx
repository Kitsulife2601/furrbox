"use client";

import {
  AlignHorizontalJustifyCenter,
  ArrowDownAZ,
  ChevronRight,
  FileText,
  Folder,
  ImagePlus,
  Laptop,
  Link,
  MonitorCog,
  Palette,
  RotateCw,
  Settings2,
  SquareTerminal,
  Undo2,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallpaperStore } from "@/store/useWallpaperStore";

type MenuKind = "desktop" | "file" | "folder" | "taskbar";
type SubmenuKey = "view" | "sort" | "new" | null;

type MenuState = {
  open: boolean;
  x: number;
  y: number;
  kind: MenuKind;
  targetId?: string;
  targetName?: string;
};

type MenuItem = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  submenu?: Exclude<SubmenuKey, null>;
  dividerBefore?: boolean;
  action?: () => void;
};

const mainWidth = 330;
const submenuWidth = 230;
const menuPadding = 10;
const submenuDelayMs = 150;

const initialMenu: MenuState = {
  open: false,
  x: 0,
  y: 0,
  kind: "desktop"
};

function findContextTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>("[data-furr-context]");
}

function detectKind(target: HTMLElement | null): MenuKind {
  const type = target?.dataset.furrContext;
  if (type === "file" || type === "folder" || type === "taskbar") return type;
  return "desktop";
}

function clampPoint(x: number, y: number, width: number, height: number) {
  return {
    x: Math.min(Math.max(menuPadding, x), Math.max(menuPadding, window.innerWidth - width - menuPadding)),
    y: Math.min(Math.max(menuPadding, y), Math.max(menuPadding, window.innerHeight - height - menuPadding))
  };
}

function submenuPosition(menu: MenuState, rowTop: number, estimatedHeight: number) {
  const openLeft = menu.x + mainWidth + submenuWidth + menuPadding > window.innerWidth;
  return clampPoint(openLeft ? menu.x - submenuWidth - 8 : menu.x + mainWidth + 8, rowTop, submenuWidth, estimatedHeight);
}

function NeonShell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-[15px] bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500 p-px shadow-neon-menu ${className}`}>
      <div className="rounded-[14px] border border-white/10 bg-slate-950/80 p-1.5 text-slate-100 backdrop-blur-xl">{children}</div>
    </div>
  );
}

function Divider() {
  return <div className="my-1 h-px bg-gradient-to-r from-transparent via-cyan-400/30 to-transparent" />;
}

function WallpaperSelector({ onClose }: { onClose: () => void }) {
  const { wallpaperUrl, setWallpaperUrl, setWallpaperFile, resetWallpaper } = useWallpaperStore();
  const [url, setUrl] = useState(wallpaperUrl);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      await setWallpaperFile(file);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed left-1/2 top-1/2 z-[10020] w-[420px] -translate-x-1/2 -translate-y-1/2 animate-neon-pop">
      <NeonShell>
        <div className="flex items-center justify-between px-3 py-2">
          <div>
            <h2 className="text-[15px] font-semibold text-white">Hintergrund anpassen</h2>
            <p className="text-[12px] text-cyan-100/70">Bild-URL einfügen oder lokale Datei hochladen.</p>
          </div>
          <button className="grid h-8 w-8 place-items-center rounded-lg text-slate-300 hover:bg-pink-500/20 hover:text-white" onClick={onClose} aria-label="Schließen">
            <X size={16} />
          </button>
        </div>
        <div className="grid gap-3 p-3">
          <input
            className="h-10 rounded-xl border border-cyan-400/25 bg-black/35 px-3 text-[13px] text-white outline-none placeholder:text-slate-500 focus:border-cyan-300 focus:shadow-[0_0_18px_rgba(34,211,238,0.18)]"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/wallpaper.jpg"
          />
          <div className="flex gap-2">
            <button className="h-10 flex-1 rounded-xl bg-cyan-500/20 px-3 text-[13px] font-semibold text-cyan-100 ring-1 ring-cyan-300/30 hover:bg-cyan-500/30" onClick={() => setWallpaperUrl(url)}>
              URL anwenden
            </button>
            <button className="h-10 rounded-xl bg-slate-800/80 px-3 text-[13px] font-semibold text-slate-100 ring-1 ring-white/10 hover:bg-slate-700" onClick={resetWallpaper}>
              Zurücksetzen
            </button>
          </div>
          <label className="flex h-20 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-purple-300/35 bg-purple-500/10 text-[13px] font-semibold text-purple-100 hover:bg-purple-500/20">
            <ImagePlus size={18} />
            {busy ? "Lade Bild..." : "Bilddatei hochladen"}
            <input className="hidden" type="file" accept="image/*" onChange={(event) => handleFile(event.target.files?.[0])} />
          </label>
        </div>
      </NeonShell>
    </div>
  );
}

export function WindowsContextMenu() {
  const addFolder = useWallpaperStore((state) => state.addFolder);
  const [menu, setMenu] = useState<MenuState>(initialMenu);
  const [submenu, setSubmenu] = useState<SubmenuKey>(null);
  const [submenuTop, setSubmenuTop] = useState(0);
  const [wallpaperOpen, setWallpaperOpen] = useState(false);
  const submenuTimer = useRef<number | null>(null);

  const clearSubmenuTimer = useCallback(() => {
    if (submenuTimer.current !== null) {
      window.clearTimeout(submenuTimer.current);
      submenuTimer.current = null;
    }
  }, []);

  const scheduleSubmenu = useCallback(
    (nextSubmenu: SubmenuKey, rowTop: number) => {
      clearSubmenuTimer();
      submenuTimer.current = window.setTimeout(() => {
        setSubmenu(nextSubmenu);
        setSubmenuTop(rowTop);
      }, submenuDelayMs);
    },
    [clearSubmenuTimer]
  );

  const scheduleSubmenuClose = useCallback(() => {
    clearSubmenuTimer();
    submenuTimer.current = window.setTimeout(() => setSubmenu(null), submenuDelayMs);
  }, [clearSubmenuTimer]);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      const contextTarget = findContextTarget(event.target);
      const kind = detectKind(contextTarget);
      const coords = clampPoint(event.clientX, event.clientY, mainWidth, 430);
      setMenu({
        open: true,
        x: coords.x,
        y: coords.y,
        kind,
        targetId: contextTarget?.dataset.fileId,
        targetName: contextTarget?.dataset.fileName
      });
      setSubmenu(null);
    };

    const close = () => {
      setMenu((state) => ({ ...state, open: false }));
      setSubmenu(null);
    };

    window.addEventListener("contextmenu", onContextMenu, { capture: true });
    window.addEventListener("click", close);
    window.addEventListener("keydown", close);
    window.addEventListener("blur", close);

    return () => {
      clearSubmenuTimer();
      window.removeEventListener("contextmenu", onContextMenu, { capture: true });
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", close);
      window.removeEventListener("blur", close);
    };
  }, [clearSubmenuTimer]);

  const items = useMemo<MenuItem[]>(() => {
    if (menu.kind === "taskbar") {
      return [{ id: "task-manager", label: "Task-Manager", icon: <Settings2 size={16} />, action: () => window.dispatchEvent(new CustomEvent("furrbox:open-task-manager")) }];
    }

    if (menu.kind === "file" || menu.kind === "folder") {
      return [
        { id: "open", label: "Öffnen", icon: <Folder size={16} />, action: () => window.dispatchEvent(new CustomEvent("furrfs:open", { detail: menu })) },
        { id: "cut", label: "Ausschneiden", icon: <Undo2 size={16} />, dividerBefore: true, action: () => window.dispatchEvent(new CustomEvent("furrfs:cut", { detail: menu })) },
        { id: "copy", label: "Kopieren", icon: <FileText size={16} />, action: () => navigator.clipboard?.writeText(menu.targetName || "") },
        { id: "delete", label: "Löschen", icon: <X size={16} />, dividerBefore: true, action: () => window.dispatchEvent(new CustomEvent("furrfs:delete", { detail: menu })) },
        { id: "props", label: "Eigenschaften", icon: <MonitorCog size={16} />, dividerBefore: true, action: () => window.dispatchEvent(new CustomEvent("furrfs:properties", { detail: menu })) }
      ];
    }

    return [
      { id: "view", label: "Ansicht", icon: <AlignHorizontalJustifyCenter size={16} />, submenu: "view" },
      { id: "sort", label: "Sortieren nach", icon: <ArrowDownAZ size={16} />, submenu: "sort" },
      { id: "refresh", label: "Aktualisieren", icon: <RotateCw size={16} />, action: () => window.dispatchEvent(new CustomEvent("desktop:refresh")) },
      { id: "undo-new", label: "Neu rückgängig machen", shortcut: "Strg+Z", icon: <Undo2 size={16} />, dividerBefore: true, action: () => window.dispatchEvent(new CustomEvent("desktop:undo-new")) },
      { id: "new", label: "Neu", icon: <FileText size={16} />, submenu: "new" },
      { id: "display", label: "Anzeigeeinstellungen", icon: <Laptop size={16} />, dividerBefore: true, action: () => window.dispatchEvent(new CustomEvent("desktop:display-settings")) },
      { id: "customize", label: "Anpassen", icon: <Palette size={16} />, action: () => setWallpaperOpen(true) },
      { id: "edition", label: "FurrBox Software: Adrenalin Edition", icon: <Settings2 size={16} />, dividerBefore: true, action: () => window.dispatchEvent(new CustomEvent("furrbox:about")) },
      { id: "terminal", label: "In Terminal öffnen", icon: <SquareTerminal size={16} />, action: () => window.dispatchEvent(new CustomEvent("furrbox:open-terminal")) },
      { id: "more", label: "Weitere Optionen anzeigen", icon: <ChevronRight size={16} />, dividerBefore: true, action: () => window.dispatchEvent(new CustomEvent("desktop:more-options")) }
    ];
  }, [menu]);

  const submenuItems = useMemo<MenuItem[]>(() => {
    if (submenu === "new") {
      return [
        { id: "folder", label: "Ordner", icon: <Folder size={16} />, action: () => addFolder() },
        { id: "text", label: "Textdokument", icon: <FileText size={16} />, action: () => window.dispatchEvent(new CustomEvent("desktop:new-text-document")) },
        { id: "shortcut", label: "Verknüpfung", icon: <Link size={16} />, action: () => window.dispatchEvent(new CustomEvent("desktop:new-shortcut")) }
      ];
    }

    if (submenu === "view") {
      return [
        { id: "large", label: "Große Symbole", action: () => window.dispatchEvent(new CustomEvent("desktop:view-large")) },
        { id: "medium", label: "Mittelgroße Symbole", action: () => window.dispatchEvent(new CustomEvent("desktop:view-medium")) },
        { id: "small", label: "Kleine Symbole", action: () => window.dispatchEvent(new CustomEvent("desktop:view-small")) }
      ];
    }

    if (submenu === "sort") {
      return [
        { id: "name", label: "Name", action: () => window.dispatchEvent(new CustomEvent("desktop:sort-name")) },
        { id: "date", label: "Änderungsdatum", action: () => window.dispatchEvent(new CustomEvent("desktop:sort-date")) },
        { id: "type", label: "Typ", action: () => window.dispatchEvent(new CustomEvent("desktop:sort-type")) }
      ];
    }

    return [];
  }, [addFolder, submenu]);

  if (!menu.open) {
    return wallpaperOpen ? <WallpaperSelector onClose={() => setWallpaperOpen(false)} /> : null;
  }

  const submenuCoords = submenu ? submenuPosition(menu, submenuTop, Math.max(140, submenuItems.length * 40 + 18)) : null;

  return (
    <>
      <div
        className="fixed z-[9999] w-[330px] animate-neon-menu origin-top-left"
        style={{ left: menu.x, top: menu.y }}
        onClick={(event) => event.stopPropagation()}
        onMouseEnter={clearSubmenuTimer}
        onMouseLeave={scheduleSubmenuClose}
      >
        <NeonShell>
          {items.map((item) => (
            <div key={item.id} className={item.dividerBefore ? "mt-1 border-t border-cyan-400/15 pt-1" : ""}>
              <button
                className="group flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-[13px] text-slate-100 transition hover:bg-purple-500/20 hover:shadow-[inset_0_0_18px_rgba(168,85,247,0.16)]"
                onMouseEnter={(event) => item.submenu && scheduleSubmenu(item.submenu, event.currentTarget.getBoundingClientRect().top)}
                onClick={() => {
                  if (item.submenu) return;
                  item.action?.();
                  setMenu((state) => ({ ...state, open: false }));
                }}
              >
                <span className="grid h-6 w-6 place-items-center text-cyan-200 drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]">{item.icon}</span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.shortcut ? <span className="text-[12px] text-slate-400">{item.shortcut}</span> : null}
                {item.submenu ? <ChevronRight size={15} className="text-pink-200 drop-shadow-[0_0_8px_rgba(244,114,182,0.9)]" /> : null}
              </button>
            </div>
          ))}
        </NeonShell>
      </div>

      {submenu && submenuCoords ? (
        <div
          className="fixed z-[10000] w-[230px] animate-neon-submenu"
          style={{ left: submenuCoords.x, top: submenuCoords.y }}
          onClick={(event) => event.stopPropagation()}
          onMouseEnter={clearSubmenuTimer}
          onMouseLeave={scheduleSubmenuClose}
        >
          <NeonShell>
            {submenuItems.map((item) => (
              <button
                key={item.id}
                className="group flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-[13px] text-slate-100 transition hover:bg-cyan-500/20 hover:shadow-[inset_0_0_18px_rgba(34,211,238,0.16)]"
                onClick={() => {
                  item.action?.();
                  setMenu((state) => ({ ...state, open: false }));
                  setSubmenu(null);
                }}
              >
                <span className="grid h-6 w-6 place-items-center text-purple-200 drop-shadow-[0_0_8px_rgba(168,85,247,0.9)]">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </NeonShell>
        </div>
      ) : null}

      {wallpaperOpen ? <WallpaperSelector onClose={() => setWallpaperOpen(false)} /> : null}
    </>
  );
}
