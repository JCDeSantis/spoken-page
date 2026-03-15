"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioTrack,
  Chapter,
  LibraryFile,
  LibraryItemExpanded,
  PlaybackSession,
  SubtitleCue,
} from "@/lib/types";

type PlayerPanelProps = {
  item: LibraryItemExpanded | null;
  onItemRefresh: (itemId: string) => Promise<LibraryItemExpanded | null>;
  focusMode?: boolean;
  onHide?: (() => void) | null;
  openToken?: number;
  variant?: "full" | "dock";
};

type TrackLoadRequest = {
  requestId: number;
  autoplay: boolean;
  time: number;
  track: AudioTrack;
};

const AUTO_SYNC_INTERVAL_MS = 20000;
const AUTO_SYNC_MIN_PROGRESS_SECONDS = 5;
const PLAY_INTERRUPTED_PATTERNS = [
  "the play() request was interrupted",
  "interrupted by a call to pause()",
  "the fetching process for the media resource was aborted",
];

function normalizeExt(value: string | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/^\./, "");
}

function getLibraryFileLabel(file: LibraryFile) {
  return (
    file.metadata?.filename ??
    file.metadata?.relPath ??
    file.metadata?.path ??
    `Subtitle ${String(file.ino)}`
  );
}

function listSubtitleFiles(item: LibraryItemExpanded | null) {
  if (!item?.libraryFiles?.length) {
    return [];
  }

  return item.libraryFiles.filter((file) => {
    const extension = normalizeExt(file.metadata?.ext);
    const filename = getLibraryFileLabel(file).toLowerCase();
    return extension === "srt" || filename.endsWith(".srt");
  });
}

function getTrackSignature(track: AudioTrack) {
  return `${track.index}:${track.startOffset}:${track.duration}:${track.contentUrl}`;
}

function resolveTimelineDuration(item: LibraryItemExpanded | null, tracks: AudioTrack[]) {
  if (item?.media.duration && item.media.duration > 0) {
    return item.media.duration;
  }

  return tracks.reduce((longest, track) => Math.max(longest, track.startOffset + track.duration), 0);
}

function clampTime(time: number, duration: number) {
  if (!Number.isFinite(time)) {
    return 0;
  }

  if (duration <= 0) {
    return Math.max(0, time);
  }

  return Math.min(Math.max(0, time), duration);
}

function getTrackIndexAtTime(tracks: AudioTrack[], time: number) {
  if (!tracks.length) {
    return -1;
  }

  const clamped = Math.max(0, time);

  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index];
    const trackEnd = track.startOffset + track.duration;

    if (clamped >= track.startOffset && clamped < trackEnd) {
      return index;
    }
  }

  if (clamped >= tracks[tracks.length - 1].startOffset) {
    return tracks.length - 1;
  }

  return 0;
}

function getTrackAtTime(tracks: AudioTrack[], time: number) {
  const index = getTrackIndexAtTime(tracks, time);
  return index >= 0 ? tracks[index] ?? null : null;
}

function getChapterAtTime(chapters: Chapter[] | undefined, time: number) {
  if (!chapters?.length) {
    return null;
  }

  for (const chapter of chapters) {
    if (time >= chapter.start && time < chapter.end) {
      return chapter;
    }
  }

  if (time >= chapters[chapters.length - 1].start) {
    return chapters[chapters.length - 1];
  }

  return chapters[0];
}

function parseSrtTimestamp(value: string) {
  const [hours, minutes, secondsWithMs] = value.trim().replace(",", ".").split(":");

  if (!hours || !minutes || !secondsWithMs) {
    return 0;
  }

  const [seconds, milliseconds = "0"] = secondsWithMs.split(".");
  return (
    Number(hours) * 3600 +
    Number(minutes) * 60 +
    Number(seconds) +
    Number(milliseconds.padEnd(3, "0").slice(0, 3)) / 1000
  );
}

function parseSrt(content: string) {
  return content
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((block, index) => {
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      if (lines.length < 2) {
        return null;
      }

      const timingLineIndex = lines[0].includes("-->") ? 0 : 1;
      const timingLine = lines[timingLineIndex];

      if (!timingLine?.includes("-->")) {
        return null;
      }

      const [rawStart, rawEnd] = timingLine.split("-->").map((entry) => entry.trim());
      const text = lines
        .slice(timingLineIndex + 1)
        .join("\n")
        .replace(/<[^>]+>/g, "")
        .trim();

      if (!text) {
        return null;
      }

      const start = parseSrtTimestamp(rawStart);
      const end = parseSrtTimestamp(rawEnd);

      if (!(end > start)) {
        return null;
      }

      return {
        id: `cue-${index}-${start}`,
        start,
        end,
        text,
      } satisfies SubtitleCue;
    })
    .filter((cue): cue is SubtitleCue => Boolean(cue));
}

function getSubtitleCueAtTime(cues: SubtitleCue[], time: number) {
  for (const cue of cues) {
    if (time >= cue.start && time <= cue.end) {
      return cue;
    }
  }

  return null;
}

function formatTime(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds)) {
    return "0:00";
  }

  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatChapterLabel(title: string | undefined) {
  if (!title) {
    return null;
  }

  const match = title.match(/(\d+)/);

  if (!match) {
    return title.trim() || null;
  }

  return `Chapter ${Number(match[1])}`;
}

function useEventCallback<Args extends unknown[], ReturnValue>(
  callback: (...args: Args) => ReturnValue,
) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const stableCallbackRef = useRef((...args: Args) => callbackRef.current(...args));
  return stableCallbackRef.current;
}

export function PlayerPanel({
  item,
  onItemRefresh,
  focusMode = false,
  onHide = null,
  openToken = 0,
  variant = "full",
}: PlayerPanelProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const subtitleUploadRef = useRef<HTMLInputElement | null>(null);
  const itemRef = useRef<LibraryItemExpanded | null>(item);
  const previousItemRef = useRef<LibraryItemExpanded | null>(null);
  const sessionRef = useRef<PlaybackSession | null>(null);
  const currentTimeRef = useRef(0);
  const totalDurationRef = useRef(0);
  const tracksRef = useRef<AudioTrack[]>([]);
  const isPlayingRef = useRef(false);
  const playbackRateRef = useRef(1);
  const loadedTrackSignatureRef = useRef("");
  const pendingLocalTimeRef = useRef(0);
  const pendingAutoplayRef = useRef(false);
  const listenedSecondsRef = useRef(0);
  const listenWindowStartRef = useRef<number | null>(null);
  const trackRequestIdRef = useRef(0);
  const lastSyncedTimeRef = useRef(0);
  const lastAutoRefreshTokenRef = useRef(0);

  const [session, setSession] = useState<PlaybackSession | null>(null);
  const [trackLoadRequest, setTrackLoadRequest] = useState<TrackLoadRequest | null>(null);
  const [currentTime, setCurrentTime] = useState(item?.userMediaProgress?.currentTime ?? 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [busyAction, setBusyAction] = useState<"starting" | "syncing" | "refreshing" | null>(null);
  const [playerStatus, setPlayerStatus] = useState<string | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
  const [subtitleSourceLabel, setSubtitleSourceLabel] = useState("No subtitle file loaded");
  const [subtitleStatus, setSubtitleStatus] = useState("Choose a subtitle file to begin.");
  const [subtitleError, setSubtitleError] = useState<string | null>(null);
  const [subtitleOffset, setSubtitleOffset] = useState(0);
  const [selectedServerSubtitleId, setSelectedServerSubtitleId] = useState("");
  const [hasPlaybackStarted, setHasPlaybackStarted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);

  const serverSubtitleFiles = useMemo(() => listSubtitleFiles(item), [item]);
  const tracks = useMemo(
    () => (session?.audioTracks?.length ? session.audioTracks : item?.media.tracks ?? []),
    [item, session],
  );
  const totalDuration = useMemo(() => resolveTimelineDuration(item, tracks), [item, tracks]);
  const activeTrack = useMemo(() => getTrackAtTime(tracks, currentTime), [tracks, currentTime]);
  const activeChapter = useMemo(
    () => getChapterAtTime(item?.media.chapters, currentTime),
    [item?.media.chapters, currentTime],
  );
  const activeSubtitle = useMemo(
    () => getSubtitleCueAtTime(subtitleCues, currentTime + subtitleOffset),
    [currentTime, subtitleCues, subtitleOffset],
  );
  const progressValue = totalDuration > 0 ? Math.min(currentTime / totalDuration, 1) : 0;
  const isDock = variant === "dock";
  const hasLoadedSubtitles = subtitleCues.length > 0;
  const shouldShowLyricsStage = !isDock || focusMode || isFullscreen || hasPlaybackStarted;
  const chapterLabel = useMemo(() => formatChapterLabel(activeChapter?.title), [activeChapter?.title]);

  useEffect(() => {
    itemRef.current = item;
  }, [item]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    totalDurationRef.current = totalDuration;
  }, [totalDuration]);

  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    playbackRateRef.current = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === panelRef.current);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const pauseListeningClock = useEventCallback(() => {
    if (listenWindowStartRef.current !== null) {
      listenedSecondsRef.current += (performance.now() - listenWindowStartRef.current) / 1000;
      listenWindowStartRef.current = null;
    }
  });

  const resumeListeningClock = useEventCallback(() => {
    if (listenWindowStartRef.current === null) {
      listenWindowStartRef.current = performance.now();
    }
  });

  const snapshotListeningSeconds = useEventCallback(() => {
    let seconds = listenedSecondsRef.current;

    if (listenWindowStartRef.current !== null) {
      seconds += (performance.now() - listenWindowStartRef.current) / 1000;
    }

    return Math.max(0, seconds);
  });

  const resetListeningClock = useEventCallback(() => {
    listenedSecondsRef.current = 0;
    listenWindowStartRef.current = isPlayingRef.current ? performance.now() : null;
  });

  const clearAudio = useEventCallback(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    pendingAutoplayRef.current = false;
    pendingLocalTimeRef.current = 0;
    loadedTrackSignatureRef.current = "";
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  });

  const updatePlayhead = useEventCallback((time: number) => {
    const clamped = clampTime(time, totalDurationRef.current);
    currentTimeRef.current = clamped;
    setCurrentTime(clamped);
  });

  const safePlay = useEventCallback(async (audio: HTMLAudioElement) => {
    try {
      await audio.play();
      setPlayerError(null);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to begin playback.";
      const normalized = message.toLowerCase();
      const isInterrupted = PLAY_INTERRUPTED_PATTERNS.some((pattern) => normalized.includes(pattern));

      if (!isInterrupted) {
        setPlayerError(message);
      }

      return false;
    }
  });

  const queueTrackLoad = useEventCallback(
    (time: number, autoplay: boolean, providedTracks?: AudioTrack[]) => {
      const trackList = providedTracks?.length ? providedTracks : tracksRef.current;
      const resolvedDuration = resolveTimelineDuration(itemRef.current, trackList) || totalDurationRef.current;
      const nextTime = clampTime(time, resolvedDuration);

      updatePlayhead(nextTime);

      if (!trackList.length) {
        setPlayerError("This Audiobookshelf item does not expose playable audio tracks.");
        setIsPlaying(false);
        pauseListeningClock();
        return;
      }

      const nextTrack = getTrackAtTime(trackList, nextTime);

      if (!nextTrack) {
        return;
      }

      const signature = getTrackSignature(nextTrack);
      const desiredLocalTime = clampTime(
        nextTime - nextTrack.startOffset,
        Math.max(nextTrack.duration - 0.05, 0),
      );
      const audio = audioRef.current;

      pendingAutoplayRef.current = autoplay;
      pendingLocalTimeRef.current = desiredLocalTime;

      if (audio && audio.src && loadedTrackSignatureRef.current === signature) {
        if (Math.abs(audio.currentTime - desiredLocalTime) > 0.25) {
          audio.currentTime = desiredLocalTime;
        }

        audio.playbackRate = playbackRateRef.current;

        if (autoplay) {
          void safePlay(audio);
        } else {
          audio.pause();
          setIsPlaying(false);
          pauseListeningClock();
        }

        return;
      }

      trackRequestIdRef.current += 1;
      setTrackLoadRequest({
        requestId: trackRequestIdRef.current,
        autoplay,
        time: nextTime,
        track: nextTrack,
      });
    },
  );

  const syncToAudiobookshelf = useEventCallback(
    async (
      mode: "sync" | "close",
      options?: {
        refreshItem?: boolean;
        silent?: boolean;
        targetItem?: LibraryItemExpanded | null;
        targetSession?: PlaybackSession | null;
      },
    ) => {
      const targetItem = options?.targetItem ?? itemRef.current;
      const targetSession = options?.targetSession ?? sessionRef.current;

      if (!targetItem) {
        return false;
      }

      const duration = Math.max(
        resolveTimelineDuration(
          targetItem,
          targetSession?.audioTracks?.length ? targetSession.audioTracks : targetItem.media.tracks ?? [],
        ),
        1,
      );
      const now = Date.now();
      const nextTime = clampTime(currentTimeRef.current, duration);
      const timeListened = snapshotListeningSeconds();
      const isFinished = nextTime >= Math.max(duration - 5, duration * 0.995);

      if (!options?.silent) {
        setBusyAction("syncing");
        setPlayerError(null);
        setPlayerStatus(mode === "close" ? "Saving progress..." : "Syncing to Audiobookshelf...");
      }

      try {
        if (targetSession) {
          const sessionResponse = await fetch(`/api/session/${targetSession.id}/${mode}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              currentTime: nextTime,
              timeListened,
              duration,
            }),
          });
          const sessionPayload = (await sessionResponse.json()) as {
            ok?: boolean;
            error?: string;
            session?: PlaybackSession | null;
          };

          if (!sessionResponse.ok) {
            throw new Error(sessionPayload.error ?? "Unable to sync the Audiobookshelf session.");
          }

          if (sessionPayload.session?.id) {
            setSession(sessionPayload.session);
            sessionRef.current = sessionPayload.session;
          }
        }

        const progressResponse = await fetch(`/api/me/progress/${targetItem.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            duration,
            progress: duration > 0 ? nextTime / duration : 0,
            currentTime: nextTime,
            isFinished,
            finishedAt: isFinished ? now : null,
            startedAt: targetItem.userMediaProgress?.startedAt ?? targetSession?.startedAt ?? now,
          }),
        });
        const progressPayload = (await progressResponse.json()) as { ok?: boolean; error?: string };

        if (!progressResponse.ok) {
          throw new Error(progressPayload.error ?? "Unable to save playback progress.");
        }

        resetListeningClock();
        lastSyncedTimeRef.current = nextTime;

        if (mode === "close") {
          setSession(null);
          sessionRef.current = null;
        }

        if (options?.refreshItem) {
          await onItemRefresh(targetItem.id);
        }

        if (!options?.silent) {
          setPlayerStatus(
            mode === "close"
              ? "Playback progress saved to Audiobookshelf."
              : "Synced with Audiobookshelf.",
          );
        }

        return true;
      } catch (error) {
        if (!options?.silent) {
          setPlayerError(error instanceof Error ? error.message : "Unable to sync playback progress.");
        }
        return false;
      } finally {
        if (!options?.silent) {
          setBusyAction(null);
        }
      }
    },
  );

  const startPlayback = useEventCallback(async (restartSession = false) => {
    const activeItem = itemRef.current;

    if (!activeItem) {
      return;
    }

    setBusyAction("starting");
    setPlayerError(null);
    setPlayerStatus(restartSession ? "Restarting synced playback..." : "Starting synced playback...");

    try {
      if (restartSession && sessionRef.current) {
        await syncToAudiobookshelf("close", {
          silent: true,
          targetItem: activeItem,
          targetSession: sessionRef.current,
        });
      }

      const response = await fetch(`/api/items/${activeItem.id}/play`, {
        method: "POST",
      });
      const payload = (await response.json()) as PlaybackSession | { error?: string };

      if (!response.ok || !("id" in payload)) {
        throw new Error(
          "error" in payload
            ? payload.error ?? "Unable to start synced playback."
            : "Unable to start synced playback.",
        );
      }

      setSession(payload);
      sessionRef.current = payload;
      setHasPlaybackStarted(true);
      setPlayerStatus("Playback session started.");
      resetListeningClock();

      const preferredStartTime = currentTimeRef.current > 0 ? currentTimeRef.current : payload.currentTime;
      queueTrackLoad(preferredStartTime, true, payload.audioTracks);
    } catch (error) {
      setPlayerError(error instanceof Error ? error.message : "Unable to start synced playback.");
    } finally {
      setBusyAction(null);
    }
  });

  const pullLatestServerProgress = useEventCallback(
    async (options?: { silent?: boolean }) => {
      const activeItem = itemRef.current;

      if (!activeItem) {
        return;
      }

      if (!options?.silent) {
        setBusyAction("refreshing");
        setPlayerError(null);
        setPlayerStatus("Pulling latest server progress...");
      }

      try {
        const refreshedItem = await onItemRefresh(activeItem.id);

        if (!refreshedItem) {
          throw new Error("Unable to refresh this Audiobookshelf book.");
        }

        itemRef.current = refreshedItem;
        const refreshedTime = refreshedItem.userMediaProgress?.currentTime ?? 0;
        const nextTracks =
          sessionRef.current?.audioTracks?.length
            ? sessionRef.current.audioTracks
            : refreshedItem.media.tracks ?? [];
        const shouldQueue = Boolean(sessionRef.current) || Boolean(audioRef.current?.src);
        lastSyncedTimeRef.current = refreshedTime;

        if (shouldQueue && nextTracks.length) {
          queueTrackLoad(refreshedTime, isPlayingRef.current, nextTracks);
        } else {
          updatePlayhead(refreshedTime);
        }

        if (!options?.silent) {
          setPlayerStatus("Loaded the latest Audiobookshelf progress.");
        }
      } catch (error) {
        if (!options?.silent) {
          setPlayerError(error instanceof Error ? error.message : "Unable to refresh the current book.");
        }
      } finally {
        if (!options?.silent) {
          setBusyAction(null);
        }
      }
    },
  );

  const loadServerSubtitle = useEventCallback(async (file: LibraryFile) => {
    const activeItem = itemRef.current;

    if (!activeItem) {
      return;
    }

    setSubtitleError(null);
    setSubtitleStatus("Loading subtitle file...");
    setSelectedServerSubtitleId(String(file.ino));

    try {
      const response = await fetch(`/api/items/${activeItem.id}/files/${encodeURIComponent(String(file.ino))}`);
      const body = await response.text();

      if (!response.ok) {
        throw new Error(body || "Unable to load the selected subtitle file.");
      }

      const parsedCues = parseSrt(body);

      if (!parsedCues.length) {
        throw new Error("That subtitle file did not contain any readable SRT cues.");
      }

      setSubtitleCues(parsedCues);
      setSubtitleSourceLabel(getLibraryFileLabel(file));
      setSubtitleStatus(`Loaded ${getLibraryFileLabel(file)} from Audiobookshelf.`);
    } catch (error) {
      setSubtitleCues([]);
      setSubtitleError(error instanceof Error ? error.message : "Unable to load the selected subtitle file.");
      setSubtitleStatus("Choose a different subtitle file to keep going.");
    }
  });

  useEffect(() => {
    const previousItem = previousItemRef.current;

    if (document.fullscreenElement === panelRef.current) {
      void document.exitFullscreen();
    }

    if (previousItem?.id && previousItem.id !== item?.id) {
      void syncToAudiobookshelf("close", {
        silent: true,
        refreshItem: false,
        targetItem: previousItem,
        targetSession: sessionRef.current,
      });
    }

    clearAudio();
    pauseListeningClock();
    previousItemRef.current = item;
    itemRef.current = item;
    sessionRef.current = null;
    setSession(null);
    setTrackLoadRequest(null);
    setIsPlaying(false);
    setBusyAction(null);
    setPlayerError(null);
    setPlayerStatus(null);
    setPlaybackRate(1);
    listenedSecondsRef.current = 0;
    listenWindowStartRef.current = null;

    const initialTime = item?.userMediaProgress?.currentTime ?? 0;
    currentTimeRef.current = initialTime;
    lastSyncedTimeRef.current = initialTime;
    setCurrentTime(initialTime);

    setSubtitleCues([]);
    setSubtitleError(null);
    setSubtitleOffset(0);
    setSelectedServerSubtitleId("");
    setHasPlaybackStarted(false);
    setIsOptionsOpen(false);
    setIsFullscreen(false);

    if (!item) {
      setSubtitleSourceLabel("No subtitle file loaded");
      setSubtitleStatus("Choose a book to start reading along.");
      return;
    }

    const firstSubtitleFile = serverSubtitleFiles[0];

    if (firstSubtitleFile) {
      setSubtitleSourceLabel(getLibraryFileLabel(firstSubtitleFile));
      setSubtitleStatus("Loading subtitle file...");
      void loadServerSubtitle(firstSubtitleFile);
      return;
    }

    setSubtitleSourceLabel("No subtitle file loaded");
    setSubtitleStatus("Choose an .srt file or attach one from Audiobookshelf.");
  }, [item?.id]);

  useEffect(() => {
    if (!item || sessionRef.current || audioRef.current?.src) {
      return;
    }

    const nextTime = item.userMediaProgress?.currentTime ?? 0;
    currentTimeRef.current = nextTime;
    lastSyncedTimeRef.current = nextTime;
    setCurrentTime(nextTime);
  }, [item, item?.userMediaProgress?.currentTime]);

  useEffect(() => {
    if (!item?.id || openToken <= 0) {
      return;
    }

    if (lastAutoRefreshTokenRef.current === openToken) {
      return;
    }

    lastAutoRefreshTokenRef.current = openToken;
    void pullLatestServerProgress({ silent: true });
  }, [item?.id, openToken, pullLatestServerProgress]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio || !trackLoadRequest) {
      return;
    }

    const track = trackLoadRequest.track;
    const signature = getTrackSignature(track);
    const streamUrl = `/api/stream?path=${encodeURIComponent(track.contentUrl)}`;
    const localTime = clampTime(
      trackLoadRequest.time - track.startOffset,
      Math.max(track.duration - 0.05, 0),
    );

    pendingAutoplayRef.current = trackLoadRequest.autoplay;
    pendingLocalTimeRef.current = localTime;

    if (loadedTrackSignatureRef.current === signature && audio.src) {
      if (Math.abs(audio.currentTime - localTime) > 0.25) {
        audio.currentTime = localTime;
      }

      audio.playbackRate = playbackRateRef.current;

      if (trackLoadRequest.autoplay) {
        void safePlay(audio);
      } else {
        audio.pause();
        setIsPlaying(false);
        pauseListeningClock();
      }

      return;
    }

    audio.pause();
    loadedTrackSignatureRef.current = signature;
    audio.src = streamUrl;
    audio.load();
  }, [pauseListeningClock, safePlay, trackLoadRequest]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    audio.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    if (!session?.id) {
      return;
    }

    const interval = window.setInterval(() => {
      if (!isPlayingRef.current) {
        return;
      }

      if (Math.abs(currentTimeRef.current - lastSyncedTimeRef.current) < AUTO_SYNC_MIN_PROGRESS_SECONDS) {
        return;
      }

      void syncToAudiobookshelf("sync", { silent: true });
    }, AUTO_SYNC_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [session?.id, syncToAudiobookshelf]);

  useEffect(() => {
    return () => {
      pauseListeningClock();
      void syncToAudiobookshelf("close", { silent: true, refreshItem: false });
    };
  }, [pauseListeningClock, syncToAudiobookshelf]);

  async function handleManualSubtitleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setSubtitleError(null);
    setSubtitleStatus("Loading subtitle file...");
    setSelectedServerSubtitleId("");

    try {
      const body = await file.text();
      const parsedCues = parseSrt(body);

      if (!parsedCues.length) {
        throw new Error("That subtitle file did not contain any readable SRT cues.");
      }

      setSubtitleCues(parsedCues);
      setSubtitleSourceLabel(file.name);
      setSubtitleStatus(`Loaded ${file.name} from this device.`);
    } catch (error) {
      setSubtitleCues([]);
      setSubtitleError(error instanceof Error ? error.message : "Unable to read that subtitle file.");
      setSubtitleStatus("Choose a different subtitle file to keep going.");
    }

    event.currentTarget.value = "";
  }

  async function handlePrimaryTransport() {
    if (!item) {
      return;
    }

    if (!session) {
      await startPlayback(false);
      return;
    }

    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    if (isPlayingRef.current) {
      audio.pause();
      setIsPlaying(false);
      pauseListeningClock();
      setPlayerStatus("Playback paused.");
      return;
    }

    setHasPlaybackStarted(true);

    if (!audio.src) {
      queueTrackLoad(currentTimeRef.current, true);
      return;
    }

    audio.playbackRate = playbackRateRef.current;
    const didPlay = await safePlay(audio);

    if (didPlay) {
      setPlayerStatus("Playback resumed.");
    }
  }

  function handleSeek(nextTime: number) {
    queueTrackLoad(nextTime, Boolean(sessionRef.current) && isPlayingRef.current);
  }

  function handleRelativeSeek(delta: number) {
    queueTrackLoad(currentTimeRef.current + delta, Boolean(sessionRef.current) && isPlayingRef.current);
  }

  function handleLoadedMetadata() {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    const desiredTime = clampTime(
      pendingLocalTimeRef.current,
      Math.max(audio.duration - 0.05, 0),
    );

    if (Math.abs(audio.currentTime - desiredTime) > 0.2) {
      audio.currentTime = desiredTime;
    }

    audio.playbackRate = playbackRateRef.current;

    if (pendingAutoplayRef.current) {
      void safePlay(audio);
    }
  }

  function handleTimeUpdate() {
    const audio = audioRef.current;
    const track = activeTrack ?? getTrackAtTime(tracksRef.current, currentTimeRef.current);

    if (!audio || !track) {
      return;
    }

    updatePlayhead(track.startOffset + audio.currentTime);
  }

  function handlePlay() {
    setIsPlaying(true);
    resumeListeningClock();
  }

  function handlePause() {
    setIsPlaying(false);
    pauseListeningClock();
  }

  function handleEnded() {
    const trackList = tracksRef.current;
    const trackIndex = getTrackIndexAtTime(trackList, currentTimeRef.current);

    if (trackIndex >= 0 && trackIndex < trackList.length - 1) {
      queueTrackLoad(trackList[trackIndex + 1].startOffset, true, trackList);
      return;
    }

    updatePlayhead(totalDurationRef.current);
    setIsPlaying(false);
    pauseListeningClock();
    void syncToAudiobookshelf("sync", { silent: true });
  }

  function openPopout() {
    if (!item) {
      return;
    }

    window.open(
      `/player/${item.id}`,
      `spoken-page-${item.id}`,
      "popup=yes,width=1120,height=880,resizable=yes,scrollbars=yes",
    );
  }

  async function toggleFullscreen() {
    const panel = panelRef.current;

    if (!panel) {
      return;
    }

    if (document.fullscreenElement === panel) {
      await document.exitFullscreen();
      return;
    }

    await panel.requestFullscreen();
  }

  function renderSubtitleTools() {
    return (
      <div className="subtitle-tools-grid">
        <label className="field">
          <span>Audiobookshelf subtitles</span>
          <select
            disabled={!serverSubtitleFiles.length}
            onChange={(event) => {
              const nextFile = serverSubtitleFiles.find(
                (entry) => String(entry.ino) === event.target.value,
              );

              if (nextFile) {
                void loadServerSubtitle(nextFile);
              }
            }}
            value={selectedServerSubtitleId}
          >
            {serverSubtitleFiles.length ? null : <option value="">No attached subtitle files</option>}
            {serverSubtitleFiles.map((file) => (
              <option key={String(file.ino)} value={String(file.ino)}>
                {getLibraryFileLabel(file)}
              </option>
            ))}
          </select>
        </label>

        <label className="field field-file">
          <span>Upload .srt file</span>
          <input accept=".srt" onChange={handleManualSubtitleUpload} ref={subtitleUploadRef} type="file" />
        </label>

        <label className="field">
          <span>Subtitle offset</span>
          <input
            max={8}
            min={-8}
            onChange={(event) => setSubtitleOffset(Number(event.target.value))}
            step={0.1}
            type="range"
            value={subtitleOffset}
          />
          <small>
            {subtitleOffset >= 0 ? "+" : ""}
            {subtitleOffset.toFixed(1)} seconds
          </small>
        </label>
      </div>
    );
  }

  function renderMetaGrid() {
    return (
      <dl className="meta-grid">
        <div>
          <dt>Author</dt>
          <dd>{item?.media.metadata.authorName ?? "Unknown author"}</dd>
        </div>
        <div>
          <dt>Narrator</dt>
          <dd>{item?.media.metadata.narratorName ?? "Unknown narrator"}</dd>
        </div>
        <div>
          <dt>Subtitle source</dt>
          <dd>{subtitleSourceLabel}</dd>
        </div>
        <div>
          <dt>Track</dt>
          <dd>{activeTrack?.title ?? "Waiting for playback"}</dd>
        </div>
      </dl>
    );
  }

  function renderSubtitlePrompt() {
    const promptTitle = hasLoadedSubtitles
      ? "Press start to bring subtitles into view."
      : "Pick a subtitle file to turn on read-along mode.";
    const promptBody = isFullscreen && !hasLoadedSubtitles
      ? "No subtitle file is loaded yet. Exit full screen to choose an Audiobookshelf subtitle or upload your own .srt file."
      : hasLoadedSubtitles
        ? "Your subtitle file is ready. Start playback and the active line will appear here."
        : serverSubtitleFiles.length
          ? "We found subtitle files in Audiobookshelf, but none are loaded yet. Open subtitle options to choose one."
          : "No subtitle file is loaded yet. Open subtitle options to pick an Audiobookshelf subtitle or upload your own .srt file.";

    return (
      <article className="subtitle-prompt-card">
        <div>
          <p className="subtitle-prompt-title">{promptTitle}</p>
          <p className="subtitle-prompt-copy">{promptBody}</p>
        </div>

        {!isFullscreen ? (
          <div className="subtitle-prompt-actions">
            <button
              className="button button-secondary"
              onClick={() => setIsOptionsOpen(true)}
              type="button"
            >
              Subtitle options
            </button>

            {!serverSubtitleFiles.length ? (
              <button
                className="button button-secondary"
                onClick={() => subtitleUploadRef.current?.click()}
                type="button"
              >
                Upload .srt
              </button>
            ) : null}
          </div>
        ) : null}
      </article>
    );
  }

  function renderTransport() {
    const primaryLabel = !session ? "Start" : isPlaying ? "Pause" : "Play";
    const fullscreenLabel = isFullscreen ? "Exit full screen" : "Enter full screen";

    return (
      <section className="transport">
        <div className="transport-topline">
          <div className="transport-timeline">
            <div className="progress-pill">
              <span>{formatTime(currentTime)}</span>
              <span>/</span>
              <span>{formatTime(totalDuration)}</span>
            </div>

            {chapterLabel ? <span className="chapter-pill">{chapterLabel}</span> : null}
          </div>

          <label className="speed-control">
            <span>Speed</span>
            <select
              onChange={(event) => setPlaybackRate(Number(event.target.value))}
              value={playbackRate}
            >
              {[0.8, 1, 1.15, 1.25, 1.4, 1.5, 1.75, 2].map((speed) => (
                <option key={speed} value={speed}>
                  {speed}x
                </option>
              ))}
            </select>
          </label>
        </div>

        <input
          className="progress-slider"
          max={Math.max(totalDuration, 1)}
          min={0}
          onChange={(event) => handleSeek(Number(event.target.value))}
          step={0.1}
          type="range"
          value={Math.min(currentTime, Math.max(totalDuration, 1))}
        />

        <div className="transport-controls">
          <div className="transport-controls-main">
            <button className="button button-secondary" onClick={() => handleRelativeSeek(-15)} type="button">
              Back 15s
            </button>

            <button
              className="button button-primary"
              disabled={busyAction === "starting"}
              onClick={() => {
                void handlePrimaryTransport();
              }}
              type="button"
            >
              {busyAction === "starting" ? "Starting..." : primaryLabel}
            </button>

            <button className="button button-secondary" onClick={() => handleRelativeSeek(30)} type="button">
              Forward 30s
            </button>
          </div>

          <div className="transport-controls-side">
            <button
              aria-label={fullscreenLabel}
              className="icon-button fullscreen-button"
              onClick={() => {
                void toggleFullscreen();
              }}
              title={fullscreenLabel}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20">
                <path d="M3 8V3h5" />
                <path d="M12 3h5v5" />
                <path d="M17 12v5h-5" />
                <path d="M8 17H3v-5" />
              </svg>
            </button>
          </div>
        </div>

        <div className="transport-meta">
          <span>{item?.media.metadata.title ?? "Waiting for audiobook"}</span>
          <span>{Math.round(progressValue * 100)}% complete</span>
        </div>
      </section>
    );
  }

  function renderFooterMeta() {
    const shouldShowSubtitleMeta = shouldShowLyricsStage;

    if (!shouldShowSubtitleMeta && !playerStatus && !playerError && !(isDock && onHide)) {
      return null;
    }

    return (
      <section className="player-footer">
        <div className={`player-footer-row ${shouldShowSubtitleMeta ? "" : "player-footer-row-end"}`.trim()}>
          {shouldShowSubtitleMeta ? (
            <div className="player-footer-copy">
              <div className="subtitle-header">
                <span>Read-along subtitles</span>
                <span>{subtitleSourceLabel}</span>
              </div>
              <p className="subtitle-status">{subtitleStatus}</p>
            </div>
          ) : null}

          {isDock && onHide ? (
            <button className="button button-secondary player-hide-button" onClick={onHide} type="button">
              Hide player
            </button>
          ) : null}
        </div>

        {subtitleError ? <p className="status-message status-error">{subtitleError}</p> : null}
        {playerStatus ? <p className="status-message">{playerStatus}</p> : null}
        {playerError ? <p className="status-message status-error">{playerError}</p> : null}
      </section>
    );
  }

  function renderActionButtons() {
    return (
      <div className="player-actions">
        <button
          className="button button-secondary"
          disabled={busyAction === "starting"}
          onClick={() => {
            void startPlayback(true);
          }}
          type="button"
        >
          Restart synced playback
        </button>

        <button
          className="button button-secondary"
          disabled={busyAction === "refreshing"}
          onClick={() => {
            void pullLatestServerProgress();
          }}
          type="button"
        >
          Pull latest server progress
        </button>

        <button
          className="button button-secondary"
          disabled={busyAction === "syncing"}
          onClick={() => {
            void syncToAudiobookshelf("sync", { refreshItem: true });
          }}
          type="button"
        >
          Force sync to Audiobookshelf
        </button>

        <button className="button button-secondary" onClick={openPopout} type="button">
          Pop out player
        </button>
      </div>
    );
  }

  if (!item) {
    return (
      <section className="empty-player">
        <p className="status-message">Choose an audiobook to start synced playback and subtitles.</p>
      </section>
    );
  }

  return (
    <section
      ref={panelRef}
      className={`player-panel ${isDock ? "player-panel-dock" : "player-panel-full"} ${
        focusMode ? "player-panel-focus" : ""
      } ${isFullscreen ? "player-panel-fullscreen" : ""} ${
        shouldShowLyricsStage ? "player-panel-reading" : "player-panel-compact"
      }`}
    >
      <audio
        onEnded={handleEnded}
        onLoadedMetadata={handleLoadedMetadata}
        onPause={handlePause}
        onPlay={handlePlay}
        onTimeUpdate={handleTimeUpdate}
        preload="metadata"
        ref={audioRef}
      />

      {!isFullscreen && focusMode ? (
        <header className="focus-mode-header">
          <div className="book-summary">
            <img alt="" className="book-cover-large" src={`/api/items/${item.id}/cover`} />

            <div className="book-summary-meta">
              <div>
                <p className="eyebrow">Focused Player</p>
                <h2>{item.media.metadata.title}</h2>
                <p className="panel-description">
                  {item.media.metadata.authorName ?? "Unknown author"}
                  {item.media.metadata.narratorName ? ` / ${item.media.metadata.narratorName}` : ""}
                </p>
              </div>

              <div className="focus-mode-meta">
                <span>{formatTime(currentTime)} in play</span>
                <span>{formatTime(totalDuration)} total</span>
                <span>{subtitleSourceLabel}</span>
              </div>

              {renderMetaGrid()}
            </div>
          </div>
        </header>
      ) : null}

      {!isDock && !focusMode && !isFullscreen ? (
        <header className="book-summary">
          <img alt="" className="book-cover-large" src={`/api/items/${item.id}/cover`} />

          <div className="book-summary-meta">
            <div>
              <p className="eyebrow">Synced Player</p>
              <h2>{item.media.metadata.title}</h2>
              <p className="panel-description">
                {item.media.metadata.authorName ?? "Unknown author"}
                {item.media.metadata.narratorName ? ` / ${item.media.metadata.narratorName}` : ""}
              </p>
            </div>

            {renderMetaGrid()}
          </div>
        </header>
      ) : null}

      <section className="subtitle-stage">
        {!isDock && !isFullscreen ? <div className="subtitle-tools">{renderSubtitleTools()}</div> : null}

        {shouldShowLyricsStage ? (
          <>
            <article className={`subtitle-card ${hasLoadedSubtitles ? "" : "subtitle-card-empty"}`}>
              {hasLoadedSubtitles ? (
                <p className="subtitle-active">
                  {activeSubtitle?.text ?? "Subtitles will appear here once playback reaches a cue."}
                </p>
              ) : (
                renderSubtitlePrompt()
              )}
            </article>
          </>
        ) : (
          renderSubtitlePrompt()
        )}
      </section>

      {renderTransport()}
      {!isFullscreen ? renderFooterMeta() : null}

      {isDock && !isFullscreen ? (
        <details
          className="player-options-drawer"
          onToggle={(event) => setIsOptionsOpen(event.currentTarget.open)}
          open={isOptionsOpen}
        >
          <summary>Player options</summary>

          <div className="player-options-body">
            <p className="player-options-meta">
              Subtitle source, force sync, and pop out controls live here when the dock is collapsed.
            </p>
            {renderSubtitleTools()}
            {renderMetaGrid()}
            {renderActionButtons()}
          </div>
        </details>
      ) : !isFullscreen ? (
        renderActionButtons()
      ) : null}
    </section>
  );
}
