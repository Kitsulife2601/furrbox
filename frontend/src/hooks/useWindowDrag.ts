"use client";

import { useCallback, useRef } from "react";
import { getViewportBounds, useWindowStore, type FurrWindowState, type WindowCoords } from "@/store/useWindowStore";

type DragStart = {
  pointerX: number;
  pointerY: number;
  windowX: number;
  windowY: number;
};

const SNAP_MARGIN = 18;

function getSnapCoords(pointerX: number, pointerY: number): WindowCoords | "maximize" | null {
  const bounds = getViewportBounds();
  const nearLeft = pointerX <= SNAP_MARGIN;
  const nearRight = pointerX >= bounds.width - SNAP_MARGIN;
  const nearTop = pointerY <= SNAP_MARGIN;
  const nearBottom = pointerY >= bounds.height - SNAP_MARGIN;
  const halfWidth = Math.round(bounds.width / 2);
  const halfHeight = Math.round(bounds.height / 2);

  if (nearTop && nearLeft) return { x: 0, y: 0, width: halfWidth, height: halfHeight };
  if (nearTop && nearRight) return { x: halfWidth, y: 0, width: bounds.width - halfWidth, height: halfHeight };
  if (nearBottom && nearLeft) return { x: 0, y: halfHeight, width: halfWidth, height: bounds.height - halfHeight };
  if (nearBottom && nearRight) return { x: halfWidth, y: halfHeight, width: bounds.width - halfWidth, height: bounds.height - halfHeight };
  if (nearTop) return "maximize";
  if (nearLeft) return { x: 0, y: 0, width: halfWidth, height: bounds.height };
  if (nearRight) return { x: halfWidth, y: 0, width: bounds.width - halfWidth, height: bounds.height };
  return null;
}

export function useWindowDrag(windowState: FurrWindowState) {
  const startRef = useRef<DragStart | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const frameRef = useRef<number | null>(null);
  const moveWindow = useWindowStore((state) => state.moveWindow);
  const resizeWindow = useWindowStore((state) => state.resizeWindow);
  const toggleMaximize = useWindowStore((state) => state.toggleMaximize);
  const focusWindow = useWindowStore((state) => state.focusWindow);

  return useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (event.button !== 0 || windowState.isMaximized) return;
      event.preventDefault();
      focusWindow(windowState.id);
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      startRef.current = {
        pointerX: event.clientX,
        pointerY: event.clientY,
        windowX: windowState.x,
        windowY: windowState.y
      };

      const onMove = (moveEvent: MouseEvent) => {
        const start = startRef.current;
        if (!start) return;
        lastPointerRef.current = { x: moveEvent.clientX, y: moveEvent.clientY };
        if (frameRef.current) cancelAnimationFrame(frameRef.current);
        frameRef.current = requestAnimationFrame(() => {
          moveWindow(windowState.id, start.windowX + moveEvent.clientX - start.pointerX, start.windowY + moveEvent.clientY - start.pointerY);
        });
      };

      const onUp = () => {
        const pointer = lastPointerRef.current;
        if (pointer) {
          const snap = getSnapCoords(pointer.x, pointer.y);
          if (snap === "maximize") toggleMaximize(windowState.id);
          else if (snap) resizeWindow(windowState.id, snap);
        }
        startRef.current = null;
        lastPointerRef.current = null;
        if (frameRef.current) cancelAnimationFrame(frameRef.current);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove, { passive: true });
      window.addEventListener("mouseup", onUp, { once: true });
    },
    [focusWindow, moveWindow, resizeWindow, toggleMaximize, windowState]
  );
}
