// Simple Windows-style Alt+Tab: cycle open windows while Alt is held.
import { useEffect, useMemo, useState } from "react";
import { APPS } from "@/lib/apps";
import { cn } from "@/lib/utils";
import { useDesktop } from "@/store/desktop";

export function AltTabSwitcher() {
  const windows = useDesktop((s) => s.windows);
  const focusWindow = useDesktop((s) => s.focusWindow);
  const restoreWindow = useDesktop((s) => s.restoreWindow);
  const closeMenus = useDesktop((s) => s.closeMenus);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  const list = useMemo(
    () => [...windows].sort((a, b) => b.z - a.z),
    [windows],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.key === "Tab" && e.altKey)) return;
      if (!list.length) return;
      e.preventDefault();
      closeMenus();
      setOpen((was) => {
        if (!was) {
          setIndex(list.length > 1 ? 1 : 0);
          return true;
        }
        setIndex((i) => (e.shiftKey ? (i - 1 + list.length) % list.length : (i + 1) % list.length));
        return true;
      });
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== "Alt") return;
      setOpen((was) => {
        if (!was) return false;
        const win = list[index];
        if (win) {
          if (win.minimized) restoreWindow(win.id);
          else focusWindow(win.id);
        }
        return false;
      });
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [list, index, focusWindow, restoreWindow, closeMenus]);

  if (!open || !list.length) return null;

  return (
    <div className="furr-alttab pointer-events-none fixed inset-0 z-[95] grid place-items-center bg-bg/35 backdrop-blur-[2px]">
      <div className="mica pointer-events-auto flex max-w-[min(920px,calc(100%-2rem))] flex-wrap justify-center gap-3 rounded-2xl p-4 win-shadow">
        {list.map((w, i) => {
          const Icon = APPS.find((a) => a.id === w.appId)?.icon;
          const active = i === index;
          return (
            <button
              key={w.id}
              type="button"
              data-active={active ? "true" : "false"}
              className={cn(
                "furr-alttab-card flex w-[140px] flex-col items-center gap-2 rounded-xl bg-elevated/70 px-3 py-3 text-center",
                active && "bg-accent/20",
              )}
              onClick={() => {
                if (w.minimized) restoreWindow(w.id);
                else focusWindow(w.id);
                setOpen(false);
              }}
            >
              {Icon ? <Icon className="size-8 text-accent" strokeWidth={1.5} /> : <span className="size-8" />}
              <span className="line-clamp-2 text-[12px] font-medium">{w.title}</span>
              {w.minimized && <span className="text-[10px] text-muted">minimiert</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
