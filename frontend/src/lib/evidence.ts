"use client";

import { API_URL } from "@/lib/config";
import type { FurrFile } from "@/store/furrbox-store";

export type EvidencePayload = {
  platform: "Discord" | "VRChat";
  targetPrimary: string;
  targetSecondary: string;
  violationCategory: string;
  notes: string;
  files: File[];
};

export type EvidenceResponse = {
  caseId: string;
  casePath: string;
  files: FurrFile[];
};

export async function saveEvidenceCase(token: string, payload: EvidencePayload): Promise<EvidenceResponse> {
  const form = new FormData();
  form.append("platform", payload.platform);
  form.append("targetPrimary", payload.targetPrimary);
  form.append("targetSecondary", payload.targetSecondary);
  form.append("violationCategory", payload.violationCategory);
  form.append("notes", payload.notes);
  for (const file of payload.files) form.append("evidence", file);

  const response = await fetch(`${API_URL}/api/evidence`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Failed to save evidence case.");
  return data as EvidenceResponse;
}
