import type { LibraryItemExpanded, MediaProgress } from "./types";
import type { ProgressAction } from "./listening-status";

export const PROGRESS_EVENT = "spoken-page:progress";
export function publishProgress(itemId: string, progress: MediaProgress | null) {
  window.dispatchEvent(new CustomEvent(PROGRESS_EVENT, { detail: { itemId, progress } }));
}
export async function changeListeningProgress(itemId: string, action: ProgressAction) {
  const response = await fetch(`/api/me/progress/${encodeURIComponent(itemId)}/action`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }),
  });
  const payload = await response.json() as { item?: LibraryItemExpanded; error?: string };
  if (!response.ok || !payload.item) throw new Error(payload.error ?? "Unable to save listening progress.");
  publishProgress(itemId, payload.item.userMediaProgress ?? null);
  return payload.item;
}
