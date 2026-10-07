// Windows with unsaved text. An app marks its window while there is something to lose; the window
// frame asks before closing such a window.
import { useEffect } from "react";

const dirty = new Set<string>();

export function hasUnsaved(windowId: string) {
  return dirty.has(windowId);
}

/** Marks this window as "has unsaved changes" while `isDirty` is true. */
export function useUnsaved(windowId: string | undefined, isDirty: boolean) {
  useEffect(() => {
    if (!windowId) return;
    if (isDirty) dirty.add(windowId);
    else dirty.delete(windowId);
    return () => {
      dirty.delete(windowId);
    };
  }, [windowId, isDirty]);
}
