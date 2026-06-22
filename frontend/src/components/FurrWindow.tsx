"use client";

import clsx from "clsx";
import { Maximize2, Minus, Square, X } from "lucide-react";
import { memo } from "react";
import { useWindowDrag } from "@/hooks/useWindowDrag";
import { useWindowResize, type ResizeEdge } from "@/hooks/useWindowResize";
import { useWindowStore, type FurrWindowState } from "@/store/useWindowStore";

type FurrWindowProps = {
  windowState: FurrWindowState;
  children: React.ReactNode;
  icon?: React.ReactNode;
  titleBarContent?: React.ReactNode;
  className?: string;
};

const resizeHandles: { edge: ResizeEdge; className: string }[] = [
  { edge: "n", className: "left-3 right-3 top-0 h-1.5 cursor-n-resize" },
  { edge: "s", className: "bottom-0 left-3 right-3 h-1.5 cursor-s-resize" },
  { edge: "e", className: "bottom-3 right-0 top-3 w-1.5 cursor-e-resize" },
  { edge: "w", className: "bottom-3 left-0 top-3 w-1.5 cursor-w-resize" },
  { edge: "ne", className: "right-0 top-0 h-3 w-3 cursor-ne-resize" },
  { edge: "nw", className: "left-0 top-0 h-3 w-3 cursor-nw-resize" },
  { edge: "se", className: "bottom-0 right-0 h-3 w-3 cursor-se-resize" },
  { edge: "sw", className: "bottom-0 left-0 h-3 w-3 cursor-sw-resize" }
];

export const FurrWindow = memo(function FurrWindow({ windowState, children, icon, titleBarContent, className }: FurrWindowProps) {
  const focusWindow = useWindowStore((state) => state.focusWindow);
  const minimizeWindow = useWindowStore((state) => state.minimizeWindow);
  const toggleMaximize = useWindowStore((state) => state.toggleMaximize);
  const closeWindow = useWindowStore((state) => state.closeWindow);
  const onDragStart = useWindowDrag(windowState);
  const onResizeStart = useWindowResize(windowState);

  if (!windowState.isOpen || windowState.isMinimized) return null;

  return (
    <section
      className={clsx("glass-strong absolute overflow-hidden rounded-[12px] shadow-window ring-1 ring-white/30", className)}
      style={{
        transform: `translate3d(${windowState.x}px, ${windowState.y}px, 0)`,
        width: windowState.width,
        height: windowState.height,
        zIndex: windowState.zIndex
      }}
      onMouseDown={() => focusWindow(windowState.id)}
      data-furr-window-id={windowState.id}
    >
      <header className="flex h-11 select-none items-center justify-between border-b border-white/45 bg-white/38" onMouseDown={onDragStart} onDoubleClick={() => toggleMaximize(windowState.id)}>
        <div className="flex min-w-0 items-center gap-2 px-3">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-white/70 text-slate-700 shadow-sm">{icon ?? <Square size={14} />}</span>
          <h2 className="truncate text-[13px] font-semibold text-slate-800">{windowState.title}</h2>
          {titleBarContent}
        </div>

        <div className="flex h-full items-center" onMouseDown={(event) => event.stopPropagation()}>
          <button className="grid h-11 w-11 place-items-center text-slate-600 hover:bg-white/55" aria-label="Minimize" onClick={() => minimizeWindow(windowState.id)}>
            <Minus size={15} />
          </button>
          <button className="grid h-11 w-11 place-items-center text-slate-600 hover:bg-white/55" aria-label={windowState.isMaximized ? "Restore" : "Maximize"} onClick={() => toggleMaximize(windowState.id)}>
            {windowState.isMaximized ? <Square size={13} /> : <Maximize2 size={14} />}
          </button>
          <button className="grid h-11 w-11 place-items-center text-slate-600 hover:bg-red-500 hover:text-white" aria-label="Close" onClick={() => closeWindow(windowState.id)}>
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="h-[calc(100%-2.75rem)] min-h-0">{children}</div>

      {!windowState.isMaximized &&
        resizeHandles.map((handle) => <span key={handle.edge} className={clsx("absolute z-20", handle.className)} onMouseDown={onResizeStart(handle.edge)} />)}
    </section>
  );
});
