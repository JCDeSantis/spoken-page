import type { MediaProgress } from "./types";

export type ListeningState = "unknown" | "unstarted" | "in-progress" | "finished";
export type ProgressAction = "complete" | "unfinished" | "restart";
export type ProgressSnapshot = {
  version: 1;
  source: "server" | "local";
  acknowledged: MediaProgress | null;
  pending?: MediaProgress;
};

export const LISTENING_LABELS: Record<ListeningState, string> = {
  unknown: "Loading status", unstarted: "Not started", "in-progress": "In progress", finished: "Completed",
};

// undefined means not loaded; null means the server confirms no progress record.
export function listeningState(progress: MediaProgress | null | undefined): ListeningState {
  if (progress === undefined) return "unknown";
  if (progress?.isFinished) return "finished";
  if (progress && (progress.currentTime > 0 || progress.progress > 0 || (progress.startedAt ?? 0) > 0)) return "in-progress";
  return "unstarted";
}

export function playbackFinished(time: number, duration: number, advanced: boolean, alreadyFinished = false) {
  return alreadyFinished || (advanced && duration > 0 && time >= Math.max(duration - 5, duration * 0.995));
}

export function progressForAction(action: ProgressAction, previous: MediaProgress | null | undefined, duration: number, now = Date.now()): MediaProgress {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("The book's duration is not available yet.");
  const currentTime = action === "restart" ? 0 : Math.min(duration, Math.max(0, previous?.currentTime ?? 0));
  return {
    ...previous, duration, currentTime,
    progress: action === "complete" ? 1 : currentTime / duration,
    isFinished: action === "complete",
    startedAt: action === "restart" ? 0 : previous?.startedAt || now,
    finishedAt: action === "complete" ? now : null,
    lastUpdate: now,
  };
}
