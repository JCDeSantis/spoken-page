// Phase 0 contracts only. Offline storage, downloads and delivery are deferred until approval.
import type { AudioTrack, Chapter, MediaProgress } from "../types";

export type DownloadManifest = {
  version: 1;
  profileScope: string;
  libraryId: string;
  itemId: string;
  revision: string;
  state: "queued" | "downloading" | "verifying" | "downloaded" | "paused" | "interrupted" | "failed" | "needs-repair" | "removing";
  tracks: (AudioTrack & { expectedBytes: number; validator?: string })[];
  chapters: Chapter[];
  subtitle?: { sourceId: string; offset: number; localKey: string };
};

export type PendingPlaybackOperation = {
  version: 1;
  operationId: string;
  profileScope: string;
  itemId: string;
  localSessionId: string;
  sequence: number;
  baseServerProgress: MediaProgress | null;
  progress: MediaProgress;
  listeningSeconds: number;
  state: "pending" | "sending" | "uncertain" | "acknowledged" | "conflict";
};
