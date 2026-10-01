// Virtual path helpers shared by FurrFS, the shell and the server.

export const EVIDENCE_ROOT = "Dokumente/Moderation_Beweise";
export const DISCORD_LOGS = `${EVIDENCE_ROOT}/Discord_Logs`;
export const VRCHAT_LOGS = `${EVIDENCE_ROOT}/VRChat_Logs`;
export const AUDIT_LOG_NAME = "Audit_Log.txt";

export const PRIVATE_DEFAULT_FOLDERS = ["Desktop", "Dokumente", "Downloads", "Bilder"];

export function sanitizeName(name: string) {
  return name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 160);
}

export function sanitizeSegment(segment: string) {
  return sanitizeName(segment.replace(/\s+/g, "_")) || "unknown";
}

/** "a//b/../c" -> "a/c"; never escapes the root. */
export function normalizePath(input: string) {
  const out: string[] = [];
  for (const raw of input.replace(/\\/g, "/").split("/")) {
    const part = raw.trim();
    if (!part || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(sanitizeName(part) || "_");
  }
  return out.join("/");
}

export function joinPath(folder: string, name: string) {
  return folder ? `${folder}/${name}` : name;
}

export function splitPath(path: string) {
  const norm = normalizePath(path);
  const idx = norm.lastIndexOf("/");
  return idx === -1 ? { folder: "", name: norm } : { folder: norm.slice(0, idx), name: norm.slice(idx + 1) };
}

export function isTextLike(file: { name: string; mimeType: string }) {
  return (
    file.mimeType.startsWith("text/") ||
    /\.(txt|md|json|log|csv|js|ts|css|html)$/i.test(file.name)
  );
}

export function isImage(file: { name: string; mimeType: string }) {
  return file.mimeType.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name);
}

export function formatSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
