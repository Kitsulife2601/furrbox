// Desktop icon grid: icons snap to cells and can be dragged anywhere with the mouse.
// Positions are remembered per icon id (apps and FurrFS desktop files alike).
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useDesktop, type IconCell } from "@/store/desktop";

export type DesktopIconItem = {
  id: string;
  label: string;
  icon: ReactNode;
  onOpen: () => void;
  onContextMenu?: (e: MouseEvent) => void;
};

const CELL_W = 84;
const CELL_H = 96;
const PAD = 12;
const DRAG_THRESHOLD = 5;

const key = (c: IconCell) => `${c.c}:${c.r}`;

/** Long words get a soft hyphen so labels wrap as "Moderations-log" instead of mid-letter. */
function softBreak(label: string) {
  return label.replace(/(\S{11})(?=\S{3,})/g, "$1­");
}

/** Saved cells first; icons without a (valid, free) cell fill the first free cells column by column. */
function layout(items: DesktopIconItem[], saved: Record<string, IconCell>, cols: number, rows: number) {
  const taken = new Set<string>();
  const result = new Map<string, IconCell>();
  for (const item of items) {
    const cell = saved[item.id];
    if (cell && cell.c < cols && cell.r < rows && !taken.has(key(cell))) {
      taken.add(key(cell));
      result.set(item.id, cell);
    }
  }
  let next = 0;
  for (const item of items) {
    if (result.has(item.id)) continue;
    let cell: IconCell;
    do {
      cell = { c: Math.floor(next / rows), r: next % rows };
      next += 1;
    } while (taken.has(key(cell)) && next < cols * rows * 4);
    taken.add(key(cell));
    result.set(item.id, cell);
  }
  return result;
}

export function DesktopIcons({ items }: { items: DesktopIconItem[] }) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1280, h: 720 });
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const start = useRef<{ id: string; px: number; py: number; ox: number; oy: number; moved: boolean } | null>(null);
  const saved = useDesktop((s) => s.iconCells);
  const setIconCell = useDesktop((s) => s.setIconCell);
  const selectedIcon = useDesktop((s) => s.selectedIcon);
  const selectIcon = useDesktop((s) => s.selectIcon);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const cols = Math.max(1, Math.floor((size.w - PAD) / CELL_W));
  const rows = Math.max(1, Math.floor((size.h - PAD) / CELL_H));
  const cells = layout(items, saved ?? {}, cols, rows);

  function drop(id: string, x: number, y: number) {
    const target = {
      c: Math.min(cols - 1, Math.max(0, Math.round((x - PAD) / CELL_W))),
      r: Math.min(rows - 1, Math.max(0, Math.round((y - PAD) / CELL_H))),
    };
    const occupant = items.find((i) => i.id !== id && key(cells.get(i.id)!) === key(target));
    const from = cells.get(id);
    // Dropping onto another icon swaps the two.
    if (occupant && from) setIconCell(occupant.id, from);
    setIconCell(id, target);
  }

  return (
    <div ref={areaRef} className="absolute inset-x-0 top-0 bottom-12 z-10">
      {items.map((item) => {
        const cell = cells.get(item.id)!;
        const dragging = drag?.id === item.id;
        const left = dragging ? drag.x : PAD + cell.c * CELL_W;
        const top = dragging ? drag.y : PAD + cell.r * CELL_H;
        return (
          <button
            key={item.id}
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              start.current = { id: item.id, px: e.clientX, py: e.clientY, ox: left, oy: top, moved: false };
              selectIcon(item.id);
            }}
            onPointerMove={(e) => {
              const s = start.current;
              if (!s || s.id !== item.id) return;
              const dx = e.clientX - s.px;
              const dy = e.clientY - s.py;
              if (!s.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
              s.moved = true;
              setDrag({ id: item.id, x: s.ox + dx, y: s.oy + dy });
            }}
            onPointerUp={() => {
              const s = start.current;
              start.current = null;
              if (s?.moved && drag) drop(item.id, drag.x, drag.y);
              setDrag(null);
            }}
            onPointerCancel={() => {
              start.current = null;
              setDrag(null);
            }}
            onDoubleClick={item.onOpen}
            onContextMenu={item.onContextMenu}
            className={cn(
              "absolute flex w-[76px] touch-none select-none flex-col items-center gap-1 rounded-sm px-1 py-2 text-center",
              selectedIcon === item.id && "bg-accent/25",
              dragging ? "z-20 cursor-grabbing opacity-80" : "transition-[left,top] duration-150",
            )}
            style={{ left, top }}
          >
            {item.icon}
            <span lang="de" className="desk-label line-clamp-2 hyphens-auto break-words text-[11px] leading-tight">{softBreak(item.label)}</span>
          </button>
        );
      })}
    </div>
  );
}
