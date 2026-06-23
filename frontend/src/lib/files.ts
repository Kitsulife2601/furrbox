"use client";

import { API_URL } from "@/lib/config";
import type { FurrFile } from "@/store/furrbox-store";

export async function listFiles(token: string, scope?: "private" | "public"): Promise<FurrFile[]> {
  const query = scope ? `?scope=${scope}` : "";
  const response = await fetch(`${API_URL}/api/files${query}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Failed to list files." }));
    throw new Error(body.error || `Failed to list files (${response.status}).`);
  }
  const data = (await response.json()) as { files: FurrFile[] };
  return data.files;
}

export async function uploadFile(file: File, token: string, scope: "private" | "public", onProgress: (value: number) => void, virtualPath?: string): Promise<FurrFile> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("scope", scope);
  if (virtualPath) formData.append("virtualPath", virtualPath);

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `${API_URL}/api/files`);
    request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        const data = JSON.parse(request.responseText) as { file: FurrFile };
        resolve(data.file);
        return;
      }
      reject(new Error(request.responseText || "Upload failed."));
    };
    request.onerror = () => reject(new Error("Upload failed."));
    request.send(formData);
  });
}

export async function createFolder(token: string, scope: "private" | "public", virtualPath: string, name: string): Promise<FurrFile> {
  const response = await fetch(`${API_URL}/api/files/folder`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ scope, virtualPath, name })
  });
  const data = (await response.json().catch(() => ({}))) as { folder?: FurrFile; error?: string };
  if (!response.ok || !data.folder) throw new Error(data.error || "Ordner konnte nicht erstellt werden.");
  return data.folder;
}

export async function createTextDocument(token: string, scope: "private" | "public", virtualPath: string, name: string, content = ""): Promise<FurrFile> {
  const response = await fetch(`${API_URL}/api/files/text`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ scope, virtualPath, name, content })
  });
  const data = (await response.json().catch(() => ({}))) as { file?: FurrFile; error?: string };
  if (!response.ok || !data.file) throw new Error(data.error || "Textdokument konnte nicht erstellt werden.");
  return data.file;
}

export async function updateTextDocument(file: FurrFile, token: string, content: string): Promise<FurrFile> {
  const response = await fetch(`${API_URL}/api/files/${file.id}/text`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ content })
  });
  const data = (await response.json().catch(() => ({}))) as { file?: FurrFile; error?: string };
  if (!response.ok || !data.file) throw new Error(data.error || "Textdokument konnte nicht gespeichert werden.");
  return data.file;
}

export async function deleteFile(id: string, token: string) {
  const response = await fetch(`${API_URL}/api/files/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok && response.status !== 204) throw new Error("Failed to delete file.");
}

export async function deleteFolder(token: string, scope: "private" | "public", virtualPath: string) {
  const response = await fetch(`${API_URL}/api/files/folder`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ scope, virtualPath })
  });
  if (!response.ok && response.status !== 204) {
    const body = await response.json().catch(() => ({ error: "Ordner konnte nicht geloescht werden." }));
    throw new Error(body.error || "Ordner konnte nicht geloescht werden.");
  }
}

export async function readFileBlobUrl(file: FurrFile, token: string) {
  const response = await fetch(`${API_URL}${file.url}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error("Failed to read file.");
  return URL.createObjectURL(await response.blob());
}

export async function readFileText(file: FurrFile, token: string) {
  const response = await fetch(`${API_URL}${file.url}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error("Failed to read text file.");
  return response.text();
}

export async function downloadFile(file: FurrFile, token: string) {
  const response = await fetch(`${API_URL}${file.url}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error("Failed to download file.");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.originalName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
