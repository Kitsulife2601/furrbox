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
      className={clsx("absolute overflow-hidden rounded-[12px] border border-cyan-300/15 bg-slate-950/70 shadow-window ring-1 ring-purple-500/20 backdrop-blur-xl", className)}
      style={{
        transform: `translate3d(${windowState.x}px, ${windowState.y}px, 0)`,
        width: windowState.width,
        height: windowState.height,
        zIndex: windowState.zIndex
      }}
      onMouseDown={() => focusWindow(windowState.id)}
      data-furr-window-id={windowState.id}
    >
      <header className="flex h-11 select-none items-center justify-between border-b border-purple-500/20 bg-slate-900/55 shadow-[inset_0_-1px_0_rgba(0,240,255,0.08)]" onMouseDown={onDragStart} onDoubleClick={() => toggleMaximize(windowState.id)}>
        <div className="flex min-w-0 items-center gap-2 px-3">
          <span className="grid h-6 w-6 place-items-center rounded-md border border-cyan-300/25 bg-slate-950/80 text-[#00f0ff] shadow-[0_0_14px_rgba(0,240,255,0.22)]">{icon ?? <Square size={14} />}</span>
          <h2 className="truncate text-[13px] font-semibold text-slate-100 drop-shadow-[0_0_8px_rgba(139,92,246,0.6)]">{windowState.title}</h2>
          {titleBarContent}
        </div>

        <div className="flex h-full items-center" onMouseDown={(event) => event.stopPropagation()}>
          <button className="grid h-11 w-11 place-items-center text-slate-400 hover:bg-cyan-500/10 hover:text-[#00f0ff]" aria-label="Minimize" onClick={() => minimizeWindow(windowState.id)}>
            <Minus size={15} />
          </button>
          <button className="grid h-11 w-11 place-items-center text-slate-400 hover:bg-purple-500/15 hover:text-violet-200" aria-label={windowState.isMaximized ? "Restore" : "Maximize"} onClick={() => toggleMaximize(windowState.id)}>
            {windowState.isMaximized ? <Square size={13} /> : <Maximize2 size={14} />}
          </button>
          <button className="grid h-11 w-11 place-items-center text-slate-400 hover:bg-[#ff007f]/25 hover:text-pink-100" aria-label="Close" onClick={() => closeWindow(windowState.id)}>
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
