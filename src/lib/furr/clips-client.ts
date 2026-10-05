// Desktop-only FurrBox clip bridge. Safe no-op when window.furrbox is absent (web/Vercel).
import { saveEvidenceCase } from "@/lib/furr/api/evidence";
import { uploadFile } from "@/lib/furr/api/files";
import { fileToBase64 } from "@/lib/furr/client";
import { BOT_FILE_THRESHOLD, EVIDENCE_ROOT } from "@/lib/furr/paths";
import { checkClip, uploadToBot } from "@/lib/furr/botfile-client";

export type ClipsConfig = {
  enabled: boolean;
  mode: "instanz" | "nurTrigger";
  source: "vrchat" | "screen";
  bufferSeconds: number;
  preSeconds: number;
  postSeconds: number;
  quality: "low" | "medium" | "high";
  keepCount: number;
  maxTotalMb: number;
  keepOnFailedVote: boolean;
  voteTimeoutSeconds: number;
};

export type ClipInfo = {
  id: string;
  name: string;
  path?: string;
  size: number;
  createdAt: string;
  reason?: string | null;
  source?: string | null;
  meta?: { target?: string | null; initiator?: string | null; voteId?: string; at?: string; result?: string | null } | null;
  mimeType?: string;
  sha256?: string | null;
  caseId?: string | null;
  durationEstimateSec?: number | null;
};

export type ClipsStatus = {
  enabled: boolean;
  mode: string;
  active: boolean;
  inInstance: boolean;
  bufferSeconds: number;
  preSeconds: number;
  postSeconds: number;
  source: string;
  quality: string;
  keepOnFailedVote: boolean;
  segmentCount: number;
  bufferedMs: number;
  clipsDir: string;
  hotkey: string;
  markHotkey?: string;
  markInAt?: number | null;
  pendingVotes?: number;
  instance?: { worldName: string | null; location: string | null; playerCount: number };
};

export type RequestClipInput = {
  source?: "desktop" | "vr" | "bot" | "hotkey" | "votekick" | "mark" | string;
  reason?: string;
  preSeconds?: number;
  postSeconds?: number;
  meta?: Record<string, unknown>;
  waitPostRoll?: boolean;
};

type ClipsApi = {
  status: () => Promise<ClipsStatus | null>;
  config: () => Promise<ClipsConfig | null>;
  setConfig: (patch: Partial<ClipsConfig>) => Promise<ClipsConfig | null>;
  list: () => Promise<ClipInfo[]>;
  save: (input?: RequestClipInput) => Promise<{ ok: true; value: ClipInfo } | { ok: false; error: string }>;
  request: (input?: RequestClipInput) => Promise<{ ok: true; value: ClipInfo } | { ok: false; error: string }>;
  attachToCase: (input: {
    clipId: string;
    caseId: string | "new";
    phase?: "prepare" | "complete";
    auditId?: string | null;
    casePath?: string | null;
  }) => Promise<{ ok: true; value: unknown } | { ok: false; error: string }>;
  markIn: () => Promise<{ ok: true; value: unknown } | { ok: false; error: string }>;
  markOut: (meta?: Record<string, unknown>) => Promise<{ ok: true; value: ClipInfo } | { ok: false; error: string }>;
  delete: (id: string) => Promise<{ ok: boolean; error?: string }>;
  read: (id: string) => Promise<{ ok: true; value: { id: string; name: string; mimeType: string; size: number; base64: string; sha256?: string | null } } | { ok: false; error: string }>;
  openFolder: () => Promise<string | null>;
  onSaved: (callback: (info: ClipInfo) => void) => () => void;
};

function api(): ClipsApi | null {
  if (typeof window === "undefined") return null;
  const f = (window as { furrbox?: { clips?: ClipsApi } }).furrbox;
  return f?.clips ?? null;
}

export function hasDesktopClips() {
  return Boolean(api());
}

export async function clipsStatus() {
  return (await api()?.status()) ?? null;
}

export async function clipsConfig() {
  return (await api()?.config()) ?? null;
}

export async function clipsSetConfig(patch: Partial<ClipsConfig>) {
  return (await api()?.setConfig(patch)) ?? null;
}

export async function clipsList() {
  return (await api()?.list()) ?? [];
}

export async function requestClip(input?: RequestClipInput) {
  const bridge = api();
  if (!bridge) return { ok: false as const, error: "Clips sind nur in der Desktop-App verfügbar." };
  if (bridge.request) return bridge.request(input);
  return bridge.save(input);
}

export async function clipsSave(input?: RequestClipInput) {
  return requestClip(input);
}

export async function clipsDelete(id: string) {
  const bridge = api();
  if (!bridge) return { ok: false, error: "Nicht verfügbar." };
  return bridge.delete(id);
}

export async function clipsRead(id: string) {
  const bridge = api();
  if (!bridge) return { ok: false as const, error: "Nicht verfügbar." };
  return bridge.read(id);
}

export async function clipsOpenFolder() {
  return (await api()?.openFolder()) ?? null;
}

export async function clipsMarkIn() {
  const bridge = api();
  if (!bridge?.markIn) return { ok: false as const, error: "Nicht verfügbar." };
  return bridge.markIn();
}

export async function clipsMarkOut(meta?: Record<string, unknown>) {
  const bridge = api();
  if (!bridge?.markOut) return { ok: false as const, error: "Nicht verfügbar." };
  return bridge.markOut(meta);
}

export function onClipSaved(callback: (info: ClipInfo) => void) {
  return api()?.onSaved(callback) ?? (() => undefined);
}

export function clipToFile(clip: { name: string; mimeType: string; base64: string }) {
  const bin = atob(clip.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], clip.name, { type: clip.mimeType || "video/webm" });
}

export async function loadClipFile(clipId: string) {
  const res = await clipsRead(clipId);
  if (!res.ok) throw new Error(res.error);
  return clipToFile(res.value);
}

/**
 * Attaches a local desktop clip to Evidence.
 * caseId === "new" → creates a VRChat evidence case via saveEvidenceCase.
 * Otherwise uploads into Dokumente/Moderation_Beweise/VRChat/<caseId>.
 * Then writes caseId (+ auditId if any) back into the clip sidecar (no auto-upload without this call).
 */
export async function attachClipToCase(
  clipId: string,
  caseId: string | "new",
  opts?: {
    targetDisplayName?: string | null;
    notes?: string;
    violationCategory?: string;
  },
) {
  const bridge = api();
  if (!bridge?.attachToCase) throw new Error("Clips-Attach nur in der Desktop-App.");

  const prep = await bridge.attachToCase({ clipId, caseId, phase: "prepare" });
  if (!prep.ok) throw new Error(prep.error);
  const value = prep.value as {
    clip: { id: string; name: string; mimeType: string; size: number; base64: string; sha256?: string | null };
    incident?: { vrchat?: { vote?: { target?: string } }; clip?: { sha256?: string } };
  };
  const file = clipToFile(value.clip);
  const problem = await checkClip(file);
  if (problem) throw new Error(problem);

  const sha = value.clip.sha256 || value.incident?.clip?.sha256 || null;
  const target =
    opts?.targetDisplayName ||
    value.incident?.vrchat?.vote?.target ||
    "Unbekannt";
  const notesBase = opts?.notes?.trim() || `Desktop-Beweisclip: ${file.name}`;
  const notes = sha ? `${notesBase}\r\nSHA-256: ${sha}` : notesBase;

  let resolvedCaseId: string;
  let casePath: string;
  let auditId: string | null = null;

  if (caseId === "new") {
    const small = file.size <= BOT_FILE_THRESHOLD;
    const res = await saveEvidenceCase({
      data: {
        platform: "VRChat",
        targetPrimary: target,
        targetDiscordId: "",
        targetDisplayName: target,
        targetSecondary: "",
        messageId: "",
        messageProof: null,
        violationCategory: opts?.violationCategory || "Other",
        notes,
        files: small ? [{ name: file.name, mimeType: file.type || "video/webm", base64: await fileToBase64(file) }] : [],
        bigFiles: small ? [] : [{ name: file.name, mimeType: file.type || "video/webm", size: file.size }],
      },
    });
    resolvedCaseId = res.caseId;
    casePath = res.casePath;
    if (res.uploads?.length) {
      await uploadToBot(file, res.uploads[0].fileId, () => undefined);
    }
  } else {
    resolvedCaseId = caseId;
    casePath = `${EVIDENCE_ROOT}/VRChat/${caseId}`;
    if (file.size <= BOT_FILE_THRESHOLD) {
      await uploadFile({
        data: {
          scope: "public",
          folder: casePath,
          name: file.name,
          mimeType: file.type || "video/webm",
          base64: await fileToBase64(file),
        },
      });
    } else {
      // Large file into existing case: create a new case wrapper notes pointing at clip is safer;
      // fall back to new case if bot upload to arbitrary folder is complex.
      const res = await saveEvidenceCase({
        data: {
          platform: "VRChat",
          targetPrimary: target,
          targetDiscordId: "",
          targetDisplayName: target,
          targetSecondary: `Angehängt an Fall ${caseId}`,
          messageId: "",
          messageProof: null,
          violationCategory: opts?.violationCategory || "Other",
          notes: `${notes}\r\nBezug-Fall: ${caseId}`,
          files: [],
          bigFiles: [{ name: file.name, mimeType: file.type || "video/webm", size: file.size }],
        },
      });
      resolvedCaseId = res.caseId;
      casePath = res.casePath;
      if (res.uploads?.length) await uploadToBot(file, res.uploads[0].fileId, () => undefined);
    }
  }

  const done = await bridge.attachToCase({
    clipId,
    caseId: resolvedCaseId,
    phase: "complete",
    casePath,
    auditId,
  });
  if (!done.ok) throw new Error(done.error);
  return { caseId: resolvedCaseId, casePath, sha256: sha };
}
