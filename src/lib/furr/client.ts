// Browser-side helpers and React Query hooks for FurrBox.
import { useQuery } from "@tanstack/react-query";
import { useLiveInterval } from "./live-interval";
import { getMe } from "./api/session";
import type { Me, Platform } from "./types";

export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "desktop";
  return /android|iphone|ipad|mobile/i.test(navigator.userAgent) ? "mobile" : "desktop";
}

export function fileToBase64(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Datei konnte nicht gelesen werden."));
    reader.readAsDataURL(file);
  });
}

export function base64ToBlob(base64: string, mimeType: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || "application/octet-stream" });
}

export function base64ToText(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function downloadBase64(base64: string, name: string, mimeType: string) {
  const url = URL.createObjectURL(base64ToBlob(base64, mimeType));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const ME_KEY = ["furr", "me"] as const;

/** The signed-in FurrBox profile (role + permissions). */
export function useMe(enabled = true) {
  const live = useLiveInterval(60_000, enabled);
  return useQuery<Me>({ queryKey: ME_KEY, queryFn: () => getMe(), enabled, staleTime: 30_000, refetchInterval: live });
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function timeAgo(isoDate: string | null) {
  if (!isoDate) return "Nie";
  const diff = Date.now() - new Date(isoDate).getTime();
  if (diff < 60_000) return "Gerade eben";
  if (diff < 3_600_000) return `vor ${Math.round(diff / 60_000)} Min.`;
  if (diff < 86_400_000) return `vor ${Math.round(diff / 3_600_000)} Std.`;
  return new Date(isoDate).toLocaleDateString("de-DE");
}
