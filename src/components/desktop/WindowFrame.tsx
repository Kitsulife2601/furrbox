import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getApp } from "@/lib/apps";
import { useDesktop, viewport, type OsWindow, type Rect } from "@/store/desktop";
import { AppViews } from "./AppViews";

const SNAP_MARGIN = 18;
type Edge = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";
const EDGES: { edge: Edge; className: string }[] = [
  { edge: "n", className: "inset-x-2 top-0 h-1.5 cursor-ns-resize" },
  { edge: "s", className: "inset-x-2 bottom-0 h-1.5 cursor-ns-resize" },
  { edge: "w", className: "inset-y-2 left-0 w-1.5 cursor-ew-resize" },
  { edge: "e", className: "inset-y-2 right-0 w-1.5 cursor-ew-resize" },
  { edge: "nw", className: "left-0 top-0 size-3 cursor-nwse-resize" },
  { edge: "se", className: "bottom-0 right-0 size-3 cursor-nwse-resize" },
  { edge: "ne", className: "right-0 top-0 size-3 cursor-nesw-resize" },
  { edge: "sw", className: "bottom-0 left-0 size-3 cursor-nesw-resize" },
];

/** Aero-snap targets: edges = halves, corners = quarters, top = maximize. */
function snapTarget(px: number, py: number): Rect | "max" | null {
  const vp = viewport();
  const halfW = Math.round(vp.width / 2);
  const halfH = Math.round(vp.height / 2);
  const left = px <= SNAP_MARGIN;
  const right = px >= vp.width - SNAP_MARGIN;
  const top = py <= SNAP_MARGIN;
  const bottom = py >= vp.height - SNAP_MARGIN;
  if (top && left) return { x: 0, y: 0, w: halfW, h: halfH };
  if (top && right) return { x: halfW, y: 0, w: vp.width - halfW, h: halfH };
  if (bottom && left) return { x: 0, y: halfH, w: halfW, h: vp.height - halfH };
  if (bottom && right) return { x: halfW, y: halfH, w: vp.width - halfW, h: vp.height - halfH };
  if (top) return "max";
  if (left) return { x: 0, y: 0, w: halfW, h: vp.height };
  if (right) return { x: halfW, y: 0, w: vp.width - halfW, h: vp.height };
  return null;
}

export function WindowFrame({ win }: { win: OsWindow }) {
  const focusWindow = useDesktop((s) => s.focusWindow);
  const closeWindow = useDesktop((s) => s.closeWindow);
  const minimizeWindow = useDesktop((s) => s.minimizeWindow);
  const toggleMaximize = useDesktop((s) => s.toggleMaximize);
  const moveWindow = useDesktop((s) => s.moveWindow);
  const resizeWindow = useDesktop((s) => s.resizeWindow);
  const snapWindow = useDesktop((s) => s.snapWindow);
  const focused = useDesktop((s) => s.focusedId === win.id);
  const app = getApp(win.appId);
  const Icon = app.icon;
  const drag = useRef<{ ox: number; oy: number; sx: number; sy: number; last: { x: number; y: number } } | null>(null);
  const resize = useRef<{ edge: Edge; ox: number; oy: number; start: Rect } | null>(null);

  if (win.minimized) return null;

  const style = win.maximized
    ? { left: 0, top: 0, width: "100%", height: "calc(100% - 3rem)" }
    : { left: win.x, top: win.y, width: win.w, height: win.h };

  function startResize(edge: Edge) {
    return (e: ReactPointerEvent<HTMLDivElement>) => {
      if (win.maximized) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      resize.current = { edge, ox: e.clientX, oy: e.clientY, start: { x: win.x, y: win.y, w: win.w, h: win.h } };
    };
  }

  function onResizeMove(e: ReactPointerEvent<HTMLDivElement>) {
    const r = resize.current;
    if (!r) return;
    const dx = e.clientX - r.ox;
    const dy = e.clientY - r.oy;
    const min = app.minSize;
    let { x, y, w, h } = r.start;
    if (r.edge.includes("e")) w = r.start.w + dx;
    if (r.edge.includes("s")) h = r.start.h + dy;
    if (r.edge.includes("w")) {
      w = Math.max(min.w, r.start.w - dx);
      x = r.start.x + r.start.w - w;
    }
    if (r.edge.includes("n")) {
      h = Math.max(min.h, r.start.h - dy);
      y = r.start.y + r.start.h - h;
    }
    resizeWindow(win.id, { x, y, w, h });
  }

  return (
    <section
      role="dialog"
      aria-label={win.title}
      onPointerDown={() => focusWindow(win.id)}
      className={cn(
        "absolute flex flex-col overflow-hidden bg-surface text-fg win-shadow",
        win.maximized ? "rounded-none" : "rounded-lg",
        focused ? "opacity-100" : "opacity-95",
      )}
      style={{ ...style, zIndex: win.z }}
    >
      <header
        className="flex h-10 shrink-0 touch-none select-none items-center bg-elevated/70"
        onDoubleClick={() => toggleMaximize(win.id)}
        onPointerDown={(e) => {
          if (win.maximized || e.button !== 0) return;
          if ((e.target as HTMLElement).closest("[data-caption]")) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { ox: e.clientX, oy: e.clientY, sx: win.x, sy: win.y, last: { x: e.clientX, y: e.clientY } };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          d.last = { x: e.clientX, y: e.clientY };
          moveWindow(win.id, d.sx + e.clientX - d.ox, d.sy + e.clientY - d.oy);
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (!d) return;
          const moved = Math.abs(d.last.x - d.ox) + Math.abs(d.last.y - d.oy) > 4;
          const target = moved ? snapTarget(d.last.x, d.last.y) : null;
          if (target) snapWindow(win.id, target);
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 pl-3">
          <Icon className="size-4 shrink-0 text-accent" strokeWidth={1.75} />
          <span className="truncate text-[13px] font-medium">{win.title}</span>
        </div>
        <div className="flex h-full" data-caption>
          <button type="button" aria-label="Minimieren" className="grid h-full w-11 place-items-center hover:bg-fg/8" onClick={() => minimizeWindow(win.id)}>
            <Minus className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={win.maximized ? "Wiederherstellen" : "Maximieren"}
            className="grid h-full w-11 place-items-center hover:bg-fg/8"
            onClick={() => toggleMaximize(win.id)}
          >
            {win.maximized ? <Copy className="size-3.5" /> : <Square className="size-3" />}
          </button>
          <button
            type="button"
            aria-label="Schließen"
            className="grid h-full w-12 place-items-center hover:bg-danger hover:text-white"
            onClick={() => closeWindow(win.id)}
          >
            <X className="size-4" />
          </button>
        </div>
      </header>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <AppViews appId={win.appId} windowId={win.id} payload={win.payload} />
      </div>
      {!win.maximized &&
        EDGES.map(({ edge, className }) => (
          <div
            key={edge}
            className={cn("absolute z-10 touch-none", className)}
            onPointerDown={startResize(edge)}
            onPointerMove={onResizeMove}
            onPointerUp={() => {
              resize.current = null;
            }}
          />
        ))}
    </section>
  );
}
