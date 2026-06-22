"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DesktopFolder = {
  id: string;
  name: string;
  x: number;
  y: number;
  createdAt: string;
};

type WallpaperStore = {
  wallpaperUrl: string;
  wallpaperMode: "default" | "image";
  wallpaperVersion: number;
  folders: DesktopFolder[];
  setWallpaperUrl: (url: string) => void;
  setWallpaperFile: (file: File) => Promise<void>;
  resetWallpaper: () => void;
  addFolder: (name?: string) => DesktopFolder;
};

function nextFolderPosition(index: number) {
  const column = Math.floor(index / 7);
  const row = index % 7;
  return {
    x: 28 + column * 86,
    y: 420 + row * 86
  };
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read image file."));
    reader.readAsDataURL(file);
  });
}

export const useWallpaperStore = create<WallpaperStore>()(
  persist(
    (set, get) => ({
      wallpaperUrl: "",
      wallpaperMode: "default",
      wallpaperVersion: 0,
      folders: [],
      setWallpaperUrl: (url) =>
        set((state) => ({
          wallpaperUrl: url.trim(),
          wallpaperMode: url.trim() ? "image" : "default",
          wallpaperVersion: state.wallpaperVersion + 1
        })),
      setWallpaperFile: async (file) => {
        const dataUrl = await readFileAsDataUrl(file);
        set((state) => ({
          wallpaperUrl: dataUrl,
          wallpaperMode: "image",
          wallpaperVersion: state.wallpaperVersion + 1
        }));
      },
      resetWallpaper: () =>
        set((state) => ({
          wallpaperUrl: "",
          wallpaperMode: "default",
          wallpaperVersion: state.wallpaperVersion + 1
        })),
      addFolder: (name) => {
        const folders = get().folders;
        const folderNumber = folders.length + 1;
        const position = nextFolderPosition(folders.length);
        const folder: DesktopFolder = {
          id: crypto.randomUUID(),
          name: name?.trim() || `Neuer Ordner ${folderNumber}`,
          x: position.x,
          y: position.y,
          createdAt: new Date().toISOString()
        };
        set({ folders: [...folders, folder] });
        return folder;
      }
    }),
    {
      name: "furrbox-wallpaper",
      partialize: (state) => ({
        wallpaperUrl: state.wallpaperUrl,
        wallpaperMode: state.wallpaperMode,
        wallpaperVersion: state.wallpaperVersion,
        folders: state.folders
      })
    }
  )
);
