// Pending "Als Beweis anlegen" hand-off from a saved clip to Evidence CaseForm.
export type ClipEvidenceDraft = {
  clipId: string;
  clipName: string;
  targetDisplayName?: string | null;
  notes?: string;
  reason?: string | null;
};

let draft: ClipEvidenceDraft | null = null;

export function setClipEvidenceDraft(next: ClipEvidenceDraft | null) {
  draft = next;
}

export function takeClipEvidenceDraft() {
  const cur = draft;
  draft = null;
  return cur;
}

export function peekClipEvidenceDraft() {
  return draft;
}
