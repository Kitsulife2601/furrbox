import type { CSSProperties } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AppId } from "@/lib/apps";
import { desktopAppIds, getApp } from "@/lib/apps";
import type { Scope } from "@/lib/furr/types";

export type Rect = { x: number; y: number; w: number; h: number };

export type WindowPayload = {
  fileId?: string;
  scope?: Scope;
  folder?: string;
  url?: string;
};

export type OsWindow = Rect & {
  id: string;
  appId: AppId;
  title: string;
  minimized: boolean;
  maximized: boolean;
  z: number;
  prev: Rect | null;
  payload?: WindowPayload;
};

export type WallpaperId = "bloom" | "dusk" | "mist" | "plain";
export type ThemeId = "dark" | "light";
export type IconCell = { c: number; r: number };
export type WallpaperFit = "fill" | "fit" | "stretch" | "center" | "tile";
export type WallpaperLayout = { fit: WallpaperFit; x: number; y: number; dim: number };
export const DEFAULT_WALLPAPER_LAYOUT: WallpaperLayout = { fit: "fill", x: 50, y: 50, dim: 0 };

const FIT_CSS: Record<WallpaperFit, { size: string; repeat: string }> = {
  fill: { size: "cover", repeat: "no-repeat" },
  fit: { size: "contain", repeat: "no-repeat" },
  stretch: { size: "100% 100%", repeat: "no-repeat" },
  center: { size: "auto", repeat: "no-repeat" },
  tile: { size: "auto", repeat: "repeat" },
};

/** Inline style for a custom wallpaper image (fit, focus point, darkening). */
export function wallpaperStyle(url: string, layout: WallpaperLayout): CSSProperties | undefined {
  if (!url) return undefined;
  const fit = FIT_CSS[layout.fit] ?? FIT_CSS.fill;
  const dim = Math.min(Math.max(layout.dim, 0), 90) / 100;
  return {
    backgroundColor: "#000",
    backgroundImage: `linear-gradient(rgba(0,0,0,${dim}), rgba(0,0,0,${dim})), url("${url}")`,
    backgroundSize: `100% 100%, ${fit.size}`,
    backgroundRepeat: `no-repeat, ${fit.repeat}`,
    backgroundPosition: `0 0, ${layout.x}% ${layout.y}%`,
  };
}

export const TASKBAR_HEIGHT = 48;

export function viewport() {
  const width = typeof window === "undefined" ? 1440 : window.innerWidth;
  const height = typeof window === "undefined" ? 900 : window.innerHeight;
  return { width, height: Math.max(0, height - TASKBAR_HEIGHT) };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/** Keeps a window inside the desktop area and above its minimum size. */
export function constrain(rect: Rect, appId: AppId): Rect {
  const vp = viewport();
  const min = getApp(appId).minSize;
  const w = clamp(rect.w, Math.min(min.w, vp.width), vp.width);
  const h = clamp(rect.h, Math.min(min.h, vp.height), vp.height);
  return { w, h, x: clamp(rect.x, 0, Math.max(0, vp.width - w)), y: clamp(rect.y, 0, Math.max(0, vp.height - h)) };
}

type OpenOptions = { payload?: WindowPayload; title?: string };

type DesktopState = {
  locked: boolean;
  theme: ThemeId;
  wallpaper: WallpaperId;
  wallpaperUrl: string;
  wallpaperLayout: WallpaperLayout;
  accent: string;
  bootSound: boolean;
  windows: OsWindow[];
  zTop: number;
  focusedId: string | null;
  selectedIcon: string | null;
  iconCells: Record<string, IconCell>;
  /** Apps on the desktop, null = defaults (Dieser PC + FurrFS). */
  desktopApps: AppId[] | null;
  startOpen: boolean;
  searchOpen: boolean;
  chatOpen: boolean;
  tray: "none" | "quick" | "clock" | "info" | "staff";
  searchQuery: string;
  /** Window ids minimized by Show Desktop; null when not peeking. */
  desktopPeek: string[] | null;
  /** Live snap-assist preview while dragging a window. */
  snapPreview: Rect | "max" | null;
  volume: number;
  brightness: number;
  nightLight: boolean;
  lock: () => void;
  unlock: () => void;
  setTheme: (theme: ThemeId) => void;
  setWallpaper: (id: WallpaperId) => void;
  setWallpaperUrl: (url: string) => void;
  setWallpaperLayout: (patch: Partial<WallpaperLayout>) => void;
  setAccent: (hex: string) => void;
  setBootSound: (on: boolean) => void;
  setVolume: (n: number) => void;
  setBrightness: (n: number) => void;
  toggleNightLight: () => void;
  closeMenus: () => void;
  toggleStart: () => void;
  toggleSearch: () => void;
  toggleChat: (open?: boolean) => void;
  setTray: (tray: DesktopState["tray"]) => void;
  setSearchQuery: (q: string) => void;
  selectIcon: (id: string | null) => void;
  setIconCell: (id: string, cell: IconCell) => void;
  /** Clear saved icon positions so they fill the grid column-by-column. */
  arrangeIcons: () => void;
  setOnDesktop: (appId: AppId, on: boolean) => void;
  openApp: (appId: AppId, opts?: OpenOptions) => string;
  focusWindow: (id: string) => void;
  closeWindow: (id: string) => void;
  closeAll: () => void;
  minimizeWindow: (id: string) => void;
  toggleMaximize: (id: string) => void;
  moveWindow: (id: string, x: number, y: number) => void;
  resizeWindow: (id: string, rect: Rect) => void;
  snapWindow: (id: string, rect: Rect | "max") => void;
  setTitle: (id: string, title: string) => void;
  restoreOrOpen: (appId: AppId) => void;
  toggleShowDesktop: () => void;
  setSnapPreview: (preview: Rect | "max" | null) => void;
};

const menusClosed = { startOpen: false, searchOpen: false, tray: "none" as const };

export const useDesktop = create<DesktopState>()(
  persist(
    (set, get) => ({
      locked: true,
      theme: "dark",
      wallpaper: "bloom",
      wallpaperUrl: "",
      wallpaperLayout: DEFAULT_WALLPAPER_LAYOUT,
      accent: "#4CC2FF",
      bootSound: true,
      windows: [],
      zTop: 10,
      focusedId: null,
      selectedIcon: null,
      iconCells: {},
      desktopApps: null,
      startOpen: false,
      searchOpen: false,
      chatOpen: false,
      tray: "none",
      searchQuery: "",
      desktopPeek: null,
      snapPreview: null,
      volume: 62,
      brightness: 100,
      nightLight: false,
      lock: () => set({ locked: true, chatOpen: false, ...menusClosed }),
      unlock: () => set({ locked: false }),
      setTheme: (theme) => set({ theme }),
      setWallpaper: (wallpaper) => set({ wallpaper, wallpaperUrl: "" }),
      setWallpaperUrl: (wallpaperUrl) => set({ wallpaperUrl: wallpaperUrl.trim() }),
      setWallpaperLayout: (patch) => set({ wallpaperLayout: { ...get().wallpaperLayout, ...patch } }),
      setAccent: (accent) => set({ accent }),
      setBootSound: (bootSound) => set({ bootSound }),
      setVolume: (volume) => set({ volume }),
      setBrightness: (brightness) => set({ brightness }),
      toggleNightLight: () => set({ nightLight: !get().nightLight }),
      closeMenus: () => set({ ...menusClosed, searchQuery: "" }),
      toggleStart: () => set({ ...menusClosed, startOpen: !get().startOpen }),
      toggleSearch: () => set({ ...menusClosed, searchOpen: !get().searchOpen }),
      toggleChat: (open) => set({ ...menusClosed, chatOpen: open ?? !get().chatOpen }),
      setTray: (tray) => set({ ...menusClosed, tray: get().tray === tray ? "none" : tray }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      selectIcon: (selectedIcon) => set({ selectedIcon }),
      setIconCell: (id, cell) => set((st) => ({ iconCells: { ...st.iconCells, [id]: cell } })),
      arrangeIcons: () => set({ iconCells: {} }),
      setOnDesktop: (appId, on) =>
        set((st) => {
          const current = desktopAppIds(st.desktopApps).filter((id) => id !== appId);
          return { desktopApps: on ? [...current, appId] : current };
        }),
      openApp: (appId, opts) => {
        const app = getApp(appId);
        const existing = get().windows.find((w) =>
          app.multi ? w.appId === appId && opts?.payload?.fileId && w.payload?.fileId === opts.payload.fileId : w.appId === appId,
        );
        if (existing) {
          const z = get().zTop + 1;
          set({
            windows: get().windows.map((w) =>
              w.id === existing.id ? { ...w, minimized: false, z, payload: opts?.payload ?? w.payload } : w,
            ),
            zTop: z,
            focusedId: existing.id,
            desktopPeek: null,
            ...menusClosed,
          });
          return existing.id;
        }
        const z = get().zTop + 1;
        const offset = 28 + (get().windows.length % 6) * 26;
        const id = crypto.randomUUID();
        const vp = viewport();
        const small = vp.width < 640;
        const rect = constrain({ x: offset + 60, y: offset, w: app.defaultSize.w, h: app.defaultSize.h }, appId);
        const win: OsWindow = {
          id,
          appId,
          title: opts?.title ?? app.name,
          ...rect,
          minimized: false,
          maximized: small,
          prev: null,
          z,
          payload: opts?.payload,
        };
        set({ windows: [...get().windows, win], zTop: z, focusedId: id, desktopPeek: null, ...menusClosed });
        return id;
      },
      focusWindow: (id) => {
        if (get().focusedId === id && get().windows.find((w) => w.id === id)?.z === get().zTop) return;
        const z = get().zTop + 1;
        set({
          windows: get().windows.map((w) => (w.id === id ? { ...w, z } : w)),
          zTop: z,
          focusedId: id,
          ...menusClosed,
        });
      },
      closeWindow: (id) => {
        const next = get().windows.filter((w) => w.id !== id);
        const top = [...next].filter((w) => !w.minimized).sort((a, b) => b.z - a.z)[0];
        set({ windows: next, focusedId: top?.id ?? null });
      },
      closeAll: () => set({ windows: [], focusedId: null }),
      minimizeWindow: (id) => {
        const next = get().windows.map((w) => (w.id === id ? { ...w, minimized: true } : w));
        const visible = next.filter((w) => !w.minimized).sort((a, b) => b.z - a.z)[0];
        set({ windows: next, focusedId: visible?.id ?? null });
      },
      toggleMaximize: (id) => {
        set({
          windows: get().windows.map((w) => {
            if (w.id !== id) return w;
            if (w.maximized) {
              return { ...w, ...(w.prev ? constrain(w.prev, w.appId) : {}), maximized: false, prev: null, minimized: false };
            }
            return { ...w, maximized: true, minimized: false, prev: { x: w.x, y: w.y, w: w.w, h: w.h } };
          }),
        });
        get().focusWindow(id);
      },
      moveWindow: (id, x, y) => {
        set({
          windows: get().windows.map((w) =>
            w.id === id && !w.maximized ? { ...w, ...constrain({ x, y, w: w.w, h: w.h }, w.appId) } : w,
          ),
        });
      },
      resizeWindow: (id, rect) => {
        set({
          windows: get().windows.map((w) => (w.id === id && !w.maximized ? { ...w, ...constrain(rect, w.appId) } : w)),
        });
      },
      snapWindow: (id, rect) => {
        if (rect === "max") {
          const win = get().windows.find((w) => w.id === id);
          if (win && !win.maximized) get().toggleMaximize(id);
          return;
        }
        set({
          windows: get().windows.map((w) =>
            w.id === id ? { ...w, prev: w.prev ?? { x: w.x, y: w.y, w: w.w, h: w.h }, ...constrain(rect, w.appId) } : w,
          ),
        });
      },
      setTitle: (id, title) => set({ windows: get().windows.map((w) => (w.id === id ? { ...w, title } : w)) }),
      restoreOrOpen: (appId) => {
        get().openApp(appId);
      },
      toggleShowDesktop: () => {
        const { windows, desktopPeek } = get();
        if (desktopPeek) {
          const next = windows.map((w) => (desktopPeek.includes(w.id) ? { ...w, minimized: false } : w));
          const top = [...next].filter((w) => !w.minimized).sort((a, b) => b.z - a.z)[0];
          set({ windows: next, desktopPeek: null, focusedId: top?.id ?? null, ...menusClosed, chatOpen: false });
          return;
        }
        const visible = windows.filter((w) => !w.minimized).map((w) => w.id);
        if (!visible.length) return;
        set({
          windows: windows.map((w) => (visible.includes(w.id) ? { ...w, minimized: true } : w)),
          desktopPeek: visible,
          focusedId: null,
          ...menusClosed,
          chatOpen: false,
          snapPreview: null,
        });
      },
      setSnapPreview: (snapPreview) => {
        const cur = get().snapPreview;
        if (cur === snapPreview) return;
        if (cur && snapPreview && cur !== "max" && snapPreview !== "max" && cur.x === snapPreview.x && cur.y === snapPreview.y && cur.w === snapPreview.w && cur.h === snapPreview.h) {
          return;
        }
        set({ snapPreview });
      },
    }),
    {
      name: "furrbox-desktop",
      partialize: (s) => ({
        theme: s.theme,
        wallpaper: s.wallpaper,
        wallpaperUrl: s.wallpaperUrl,
        wallpaperLayout: s.wallpaperLayout,
        iconCells: s.iconCells,
        desktopApps: s.desktopApps,
        accent: s.accent,
        bootSound: s.bootSound,
        volume: s.volume,
        brightness: s.brightness,
        nightLight: s.nightLight,
      }),
    },
  ),
);
