"use client";

import { useCallback, useRef } from "react";
import { useWindowStore, type FurrWindowState } from "@/store/useWindowStore";

type DragStart = {
  pointerX: number;
  pointerY: number;
  windowX: number;
  windowY: number;
};

export function useWindowDrag(windowState: FurrWindowState) {
  const startRef = useRef<DragStart | null>(null);
  const frameRef = useRef<number | null>(null);
  const moveWindow = useWindowStore((state) => state.moveWindow);
  const focusWindow = useWindowStore((state) => state.focusWindow);

  return useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (event.button !== 0 || windowState.isMaximized) return;
      event.preventDefault();
      focusWindow(windowState.id);
      startRef.current = {
        pointerX: event.clientX,
        pointerY: event.clientY,
        windowX: windowState.x,
        windowY: windowState.y
      };

      const onMove = (moveEvent: MouseEvent) => {
        const start = startRef.current;
        if (!start) return;
        if (frameRef.current) cancelAnimationFrame(frameRef.current);
        frameRef.current = requestAnimationFrame(() => {
          moveWindow(windowState.id, start.windowX + moveEvent.clientX - start.pointerX, start.windowY + moveEvent.clientY - start.pointerY);
        });
      };

      const onUp = () => {
        startRef.current = null;
        if (frameRef.current) cancelAnimationFrame(frameRef.current);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove, { passive: true });
      window.addEventListener("mouseup", onUp, { once: true });
    },
    [focusWindow, moveWindow, windowState]
  );
}
