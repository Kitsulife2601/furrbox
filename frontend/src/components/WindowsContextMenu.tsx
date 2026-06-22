"use client";

import { Clipboard, Copy, FileText, Info, MonitorCog, Palette, Scissors, Settings2, Trash2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type MenuKind = "desktop" | "file" | "folder" | "taskbar";

type MenuState = {
  open: boolean;
  x: number;
  y: number;
  kind: MenuKind;
  targetId?: string;
  targetName?: string;
};

type MenuItem = {
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  dividerBefore?: boolean;
  children?: MenuItem[];
  action: () => void;
};

const menuWidth = 260;
const menuMaxHeight = 340;

function findContextTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>("[data-furr-context]");
}

function clampMenuPosition(x: number, y: number) {
  return {
    x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - menuWidth - 8)),
    y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - menuMaxHeight - 8))
  };
}

function detectKind(target: HTMLElement | null): MenuKind {
  const type = target?.dataset.furrContext;
  if (type === "file" || type === "folder" || type === "taskbar") return type;
  return "desktop";
}

const initialMenu: MenuState = {
  open: false,
  x: 0,
  y: 0,
  kind: "desktop"
};

export function WindowsContextMenu() {
  const [menu, setMenu] = useState<MenuState>(initialMenu);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      const contextTarget = findContextTarget(event.target);
      const kind = detectKind(contextTarget);
      const coords = clampMenuPosition(event.clientX, event.clientY);

      setMenu({
        open: true,
        x: coords.x,
        y: coords.y,
        kind,
        targetId: contextTarget?.dataset.fileId,
        targetName: contextTarget?.dataset.fileName
      });
    };

    const close = () => setMenu((state) => ({ ...state, open: false }));

    window.addEventListener("contextmenu", onContextMenu, { capture: true });
    window.addEventListener("click", close);
    window.addEventListener("keydown", close);
    window.addEventListener("blur", close);

    return () => {
      window.removeEventListener("contextmenu", onContextMenu, { capture: true });
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", close);
      window.removeEventListener("blur", close);
    };
  }, []);

  const items = useMemo<MenuItem[]>(() => {
    if (menu.kind === "taskbar") {
      return [
        {
          label: "Task-Manager",
          icon: <Settings2 size={15} />,
          action: () => window.dispatchEvent(new CustomEvent("furrbox:open-task-manager"))
        }
      ];
    }

    if (menu.kind === "file" || menu.kind === "folder") {
      return [
        { label: "Öffnen", icon: <Undo2 size={15} />, action: () => window.dispatchEvent(new CustomEvent("furrfs:open", { detail: menu })) },
        { label: "Ausschneiden", icon: <Scissors size={15} />, dividerBefore: true, action: () => window.dispatchEvent(new CustomEvent("furrfs:cut", { detail: menu })) },
        { label: "Kopieren", icon: <Copy size={15} />, action: () => navigator.clipboard?.writeText(menu.targetName || "") },
        { label: "Löschen", icon: <Trash2 size={15} />, danger: true, dividerBefore: true, action: () => window.dispatchEvent(new CustomEvent("furrfs:delete", { detail: menu })) },
        { label: "Eigenschaften", icon: <Info size={15} />, dividerBefore: true, action: () => window.dispatchEvent(new CustomEvent("furrfs:properties", { detail: menu })) }
      ];
    }

    return [
      {
        label: "Neu",
        icon: <FileText size={15} />,
        children: [
          {
            label: "Textdokument",
            icon: <Clipboard size={15} />,
            action: () => window.dispatchEvent(new CustomEvent("desktop:new-text-document"))
          }
        ],
        action: () => undefined
      },
      { label: "Anzeigeeinstellungen", icon: <MonitorCog size={15} />, dividerBefore: true, action: () => window.dispatchEvent(new CustomEvent("desktop:display-settings")) },
      { label: "Hintergrund anpassen", icon: <Palette size={15} />, action: () => window.dispatchEvent(new CustomEvent("desktop:change-wallpaper")) }
    ];
  }, [menu]);

  if (!menu.open) return null;

  return (
    <div
      className="fixed z-[9999] w-[260px] origin-top-left animate-[window-in_120ms_ease-out] overflow-hidden rounded-xl border border-white/50 bg-white/80 p-1.5 text-[13px] text-slate-900 shadow-[0_18px_60px_rgba(15,23,42,0.25)] backdrop-blur-md dark:border-white/10 dark:bg-black/80 dark:text-slate-100"
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
    >
      {items.map((item) => (
        <div key={item.label} className={item.dividerBefore ? "mt-1 border-t border-gray-200/50 pt-1 dark:border-white/10" : ""}>
          <button
            className={`group flex h-9 w-full items-center gap-3 rounded-lg px-2 text-left transition-colors ${
              item.danger ? "text-red-600 hover:bg-red-50 dark:hover:bg-red-500/15" : "hover:bg-white/75 dark:hover:bg-white/10"
            }`}
            onClick={() => {
              item.action();
              setMenu((state) => ({ ...state, open: false }));
            }}
          >
            <span className="grid h-5 w-5 place-items-center text-slate-500 group-hover:text-slate-900 dark:text-slate-400 dark:group-hover:text-white">{item.icon}</span>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.children ? <span className="text-slate-400">›</span> : null}
          </button>

          {item.children ? (
            <div className="ml-7 border-l border-gray-200/50 pl-1 dark:border-white/10">
              {item.children.map((child) => (
                <button
                  key={child.label}
                  className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left transition-colors hover:bg-white/75 dark:hover:bg-white/10"
                  onClick={() => {
                    child.action();
                    setMenu((state) => ({ ...state, open: false }));
                  }}
                >
                  <span className="grid h-5 w-5 place-items-center text-slate-500 dark:text-slate-400">{child.icon}</span>
                  <span>{child.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
