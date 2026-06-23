"use client";

import { create } from "zustand";

export type FurrWindowKind = "furrfs" | "terminal" | "settings" | "browser" | "evidence" | "presence" | "accounts" | "viewer";

export type WindowCoords = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FurrWindowState = WindowCoords & {
  id: string;
  kind: FurrWindowKind;
  title: string;
  isOpen: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  zIndex: number;
  prevCoords: WindowCoords | null;
  url?: string;
};

type CreateWindowInput = Partial<WindowCoords> & {
  id?: string;
  kind: FurrWindowKind;
  title: string;
  url?: string;
};

type ViewportBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
};

type WindowStore = {
  windows: Record<string, FurrWindowState>;
  nextZIndex: number;
  createWindow: (input: CreateWindowInput) => string;
  openWindow: (id: string) => void;
  closeWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  restoreWindow: (id: string) => void;
  toggleMaximize: (id: string) => void;
  focusWindow: (id: string) => void;
  moveWindow: (id: string, x: number, y: number) => void;
  resizeWindow: (id: string, coords: WindowCoords) => void;
  updateWindow: (id: string, patch: Partial<FurrWindowState>) => void;
};

export const TASKBAR_HEIGHT = 64;
export const WINDOW_MIN_WIDTH = 300;
export const WINDOW_MIN_HEIGHT = 200;

export function getWindowMinimumSize(kind: FurrWindowKind) {
  if (kind === "presence") return { minWidth: 900, minHeight: 560 };
  if (kind === "accounts") return { minWidth: 820, minHeight: 560 };
  if (kind === "furrfs") return { minWidth: 780, minHeight: 520 };
  if (kind === "evidence") return { minWidth: 760, minHeight: 560 };
  if (kind === "viewer") return { minWidth: 520, minHeight: 360 };
  if (kind === "terminal") return { minWidth: 640, minHeight: 400 };
  if (kind === "browser") return { minWidth: 760, minHeight: 500 };
  if (kind === "settings") return { minWidth: 420, minHeight: 420 };
  return { minWidth: WINDOW_MIN_WIDTH, minHeight: WINDOW_MIN_HEIGHT };
}

export function getViewportBounds(): ViewportBounds {
  const width = typeof window === "undefined" ? 1440 : window.innerWidth;
  const height = typeof window === "undefined" ? 900 : window.innerHeight;
  return {
    minX: 0,
    minY: 0,
    maxX: width,
    maxY: Math.max(0, height - TASKBAR_HEIGHT),
    width,
    height: Math.max(0, height - TASKBAR_HEIGHT)
  };
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function constrainWindow(coords: WindowCoords, minimum = { minWidth: WINDOW_MIN_WIDTH, minHeight: WINDOW_MIN_HEIGHT }): WindowCoords {
  const bounds = getViewportBounds();
  const width = clamp(coords.width, minimum.minWidth, bounds.width);
  const height = clamp(coords.height, minimum.minHeight, bounds.height);
  const x = clamp(coords.x, bounds.minX, Math.max(bounds.minX, bounds.maxX - width));
  const y = clamp(coords.y, bounds.minY, Math.max(bounds.minY, bounds.maxY - height));
  return { x, y, width, height };
}

const initialWindows: Record<string, FurrWindowState> = {
  furrfs: {
    id: "furrfs",
    kind: "furrfs",
    title: "FurrFS",
    isOpen: true,
    isMinimized: false,
    isMaximized: false,
    x: 100,
    y: 72,
    width: 900,
    height: 648,
    zIndex: 10,
    prevCoords: null
  },
  terminal: {
    id: "terminal",
    kind: "terminal",
    title: "FurrTerminal",
    isOpen: false,
    isMinimized: false,
    isMaximized: false,
    x: 740,
    y: 392,
    width: 600,
    height: 390,
    zIndex: 11,
    prevCoords: null
  },
  settings: {
    id: "settings",
    kind: "settings",
    title: "FurrSettings",
    isOpen: false,
    isMinimized: false,
    isMaximized: false,
    x: 930,
    y: 92,
    width: 440,
    height: 460,
    zIndex: 12,
    prevCoords: null
  },
  evidence: {
    id: "evidence",
    kind: "evidence",
    title: "FurrEvidence",
    isOpen: false,
    isMinimized: false,
    isMaximized: false,
    x: 220,
    y: 96,
    width: 860,
    height: 660,
    zIndex: 13,
    prevCoords: null
  },
  presence: {
    id: "presence",
    kind: "presence",
    title: "FurrPresence",
    isOpen: false,
    isMinimized: false,
    isMaximized: false,
    x: 180,
    y: 88,
    width: 1040,
    height: 690,
    zIndex: 14,
    prevCoords: null
  },
  accounts: {
    id: "accounts",
    kind: "accounts",
    title: "FurrAccountManager",
    isOpen: false,
    isMinimized: false,
    isMaximized: false,
    x: 210,
    y: 96,
    width: 920,
    height: 650,
    zIndex: 15,
    prevCoords: null
  }
};

export const useWindowStore = create<WindowStore>((set, get) => ({
  windows: initialWindows,
  nextZIndex: 20,

  createWindow: (input) => {
    const id = input.id ?? `${input.kind}-${crypto.randomUUID()}`;
    const zIndex = get().nextZIndex + 1;
    const coords = constrainWindow({
      x: input.x ?? 160,
      y: input.y ?? 92,
      width: input.width ?? 860,
      height: input.height ?? 620
    }, getWindowMinimumSize(input.kind));

    set((state) => ({
      nextZIndex: zIndex,
      windows: {
        ...state.windows,
        [id]: {
          id,
          kind: input.kind,
          title: input.title,
          isOpen: true,
          isMinimized: false,
          isMaximized: false,
          zIndex,
          prevCoords: null,
          url: input.url,
          ...coords
        }
      }
    }));

    return id;
  },

  openWindow: (id) => {
    const win = get().windows[id];
    if (!win) return;
    get().focusWindow(id);
    set((state) => ({
      windows: {
        ...state.windows,
        [id]: { ...win, isOpen: true, isMinimized: false }
      }
    }));
  },

  closeWindow: (id) =>
    set((state) => {
      const win = state.windows[id];
      if (!win) return state;
      return {
        windows: {
          ...state.windows,
          [id]: { ...win, isOpen: false, isMinimized: false }
        }
      };
    }),

  minimizeWindow: (id) =>
    set((state) => {
      const win = state.windows[id];
      if (!win) return state;
      return {
        windows: {
          ...state.windows,
          [id]: { ...win, isMinimized: true }
        }
      };
    }),

  restoreWindow: (id) => {
    const win = get().windows[id];
    if (!win) return;
    get().focusWindow(id);
    set((state) => ({
      windows: {
        ...state.windows,
        [id]: { ...win, isOpen: true, isMinimized: false }
      }
    }));
  },

  toggleMaximize: (id) => {
    const target = get().windows[id];
    if (!target) return;
    get().focusWindow(id);
    set((state) => {
      const win = state.windows[id];
      if (!win) return state;
      if (win.isMaximized && win.prevCoords) {
        return {
          windows: {
            ...state.windows,
            [id]: { ...win, ...constrainWindow(win.prevCoords, getWindowMinimumSize(win.kind)), isMaximized: false, prevCoords: null }
          }
        };
      }

      const bounds = getViewportBounds();
      return {
        windows: {
          ...state.windows,
          [id]: {
            ...win,
            x: 0,
            y: 0,
            width: bounds.width,
            height: bounds.height,
            isMaximized: true,
            prevCoords: { x: win.x, y: win.y, width: win.width, height: win.height }
          }
        }
      };
    });
  },

  focusWindow: (id) => {
    const win = get().windows[id];
    if (!win) return;
    const zIndex = get().nextZIndex + 1;
    set((state) => ({
      nextZIndex: zIndex,
      windows: {
        ...state.windows,
        [id]: { ...win, zIndex }
      }
    }));
  },

  moveWindow: (id, x, y) =>
    set((state) => {
      const win = state.windows[id];
      if (!win || win.isMaximized) return state;
      return {
        windows: {
          ...state.windows,
          [id]: { ...win, ...constrainWindow({ x, y, width: win.width, height: win.height }, getWindowMinimumSize(win.kind)) }
        }
      };
    }),

  resizeWindow: (id, coords) =>
    set((state) => {
      const win = state.windows[id];
      if (!win || win.isMaximized) return state;
      return {
        windows: {
          ...state.windows,
          [id]: { ...win, ...constrainWindow(coords, getWindowMinimumSize(win.kind)) }
        }
      };
    }),

  updateWindow: (id, patch) =>
    set((state) => {
      const win = state.windows[id];
      if (!win) return state;
      return {
        windows: {
          ...state.windows,
          [id]: { ...win, ...patch }
        }
      };
    })
}));
