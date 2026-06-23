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
  removeFolder: (id: string) => void;
};

function nextFolderPosition(index: number) {
  const column = Math.floor(index / 8);
  const row = index % 8;
  return {
    x: 124 + column * 92,
    y: 32 + row * 88
  };
}

function nextFreeFolderPosition(folders: DesktopFolder[]) {
  const occupied = new Set(folders.map((folder) => `${Math.round(folder.x / 4) * 4}:${Math.round(folder.y / 4) * 4}`));
  for (let index = 0; index < 96; index += 1) {
    const position = nextFolderPosition(index);
    const key = `${Math.round(position.x / 4) * 4}:${Math.round(position.y / 4) * 4}`;
    if (!occupied.has(key)) return position;
  }
  return nextFolderPosition(folders.length);
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
        const position = nextFreeFolderPosition(folders);
        const folder: DesktopFolder = {
          id: crypto.randomUUID(),
          name: name?.trim() || `Neuer Ordner ${folderNumber}`,
          x: position.x,
          y: position.y,
          createdAt: new Date().toISOString()
        };
        set({ folders: [...folders, folder] });
        return folder;
      },
      removeFolder: (id) => set((state) => ({ folders: state.folders.filter((folder) => folder.id !== id) }))
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
