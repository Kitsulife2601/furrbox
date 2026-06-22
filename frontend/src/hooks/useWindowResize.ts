"use client";

import { useCallback, useRef } from "react";
import { useWindowStore, WINDOW_MIN_HEIGHT, WINDOW_MIN_WIDTH, type FurrWindowState, type WindowCoords } from "@/store/useWindowStore";

export type ResizeEdge = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";

type ResizeStart = {
  pointerX: number;
  pointerY: number;
  coords: WindowCoords;
};

function calculateResize(edge: ResizeEdge, start: ResizeStart, pointerX: number, pointerY: number): WindowCoords {
  const deltaX = pointerX - start.pointerX;
  const deltaY = pointerY - start.pointerY;
  const original = start.coords;

  let x = original.x;
  let y = original.y;
  let width = original.width;
  let height = original.height;

  if (edge.includes("e")) {
    width = Math.max(WINDOW_MIN_WIDTH, original.width + deltaX);
  }

  if (edge.includes("s")) {
    height = Math.max(WINDOW_MIN_HEIGHT, original.height + deltaY);
  }

  if (edge.includes("w")) {
    const requestedWidth = original.width - deltaX;
    width = Math.max(WINDOW_MIN_WIDTH, requestedWidth);
    x = original.x + original.width - width;
  }

  if (edge.includes("n")) {
    const requestedHeight = original.height - deltaY;
    height = Math.max(WINDOW_MIN_HEIGHT, requestedHeight);
    y = original.y + original.height - height;
  }

  return { x, y, width, height };
}

export function useWindowResize(windowState: FurrWindowState) {
  const startRef = useRef<ResizeStart | null>(null);
  const frameRef = useRef<number | null>(null);
  const resizeWindow = useWindowStore((state) => state.resizeWindow);
  const focusWindow = useWindowStore((state) => state.focusWindow);

  return useCallback(
    (edge: ResizeEdge) => (event: React.MouseEvent<HTMLElement>) => {
      if (event.button !== 0 || windowState.isMaximized) return;
      event.preventDefault();
      event.stopPropagation();

      focusWindow(windowState.id);
      startRef.current = {
        pointerX: event.clientX,
        pointerY: event.clientY,
        coords: {
          x: windowState.x,
          y: windowState.y,
          width: windowState.width,
          height: windowState.height
        }
      };

      const onMove = (moveEvent: MouseEvent) => {
        const start = startRef.current;
        if (!start) return;
        const next = calculateResize(edge, start, moveEvent.clientX, moveEvent.clientY);

        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
        frameRef.current = requestAnimationFrame(() => {
          resizeWindow(windowState.id, next);
          frameRef.current = null;
        });
      };

      const onUp = () => {
        startRef.current = null;
        if (frameRef.current !== null) {
          cancelAnimationFrame(frameRef.current);
          frameRef.current = null;
        }
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove, { passive: true });
      window.addEventListener("mouseup", onUp, { once: true });
    },
    [focusWindow, resizeWindow, windowState]
  );
}
