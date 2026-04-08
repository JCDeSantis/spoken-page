"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
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
  onInlineFullscreenChange?: ((isActive: boolean) => void) | null;
  openToken?: number;
  variant?: "full" | "dock";
};

type TrackLoadRequest = {
  requestId: number;
  autoplay: boolean;
  time: number;
  track: AudioTrack;
};

type FullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

type FullscreenPanelElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type WakeLockSentinelLike = {
  released?: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: "release", listener: EventListener) => void;
  removeEventListener?: (type: "release", listener: EventListener) => void;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request?: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};

const AUTO_SYNC_INTERVAL_MS = 20000;
const AUTO_SYNC_MIN_PROGRESS_SECONDS = 5;
const STATUS_MESSAGE_DURATION_MS = 5000;
const FULLSCREEN_CONTROLS_IDLE_MS = 2500;
const TIME_DISPLAY_MODE_STORAGE_KEY = "spoken-page-time-display-mode";
const PLAYER_PREFERENCES_STORAGE_KEY = "spoken-page-player-preferences";
const PLAY_INTERRUPTED_PATTERNS = [
  "the play() request was interrupted",
  "interrupted by a call to pause()",
  "the fetching process for the media resource was aborted",
];

type SubtitleScale = "standard" | "large" | "x-large";
type SubtitleLineHeight = "tight" | "standard" | "relaxed";
type SubtitlePosition = "center" | "raised" | "lower-third";
type SubtitleContrast = "solid" | "soft" | "glow";
type FullscreenAutoHide = 1500 | 2500 | 4000 | 6000;

type PlayerPreferences = {
  playbackRate: number;
  volume: number;
  subtitleScale: SubtitleScale;
  subtitleLineHeight: SubtitleLineHeight;
  subtitlePosition: SubtitlePosition;
  subtitleContrast: SubtitleContrast;
  fullscreenAutoHideMs: FullscreenAutoHide;
};

const DEFAULT_PLAYER_PREFERENCES: PlayerPreferences = {
  playbackRate: 1,
  volume: 1,
  subtitleScale: "large",
  subtitleLineHeight: "standard",
  subtitlePosition: "center",
  subtitleContrast: "solid",
  fullscreenAutoHideMs: FULLSCREEN_CONTROLS_IDLE_MS,
};

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

function getChapterIndexAtTime(chapters: Chapter[] | undefined, time: number) {
  if (!chapters?.length) {
    return -1;
  }

  for (let index = 0; index < chapters.length; index += 1) {
    const chapter = chapters[index];

    if (time >= chapter.start && time < chapter.end) {
      return index;
    }
  }

  if (time >= chapters[chapters.length - 1].start) {
    return chapters.length - 1;
  }

  return 0;
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

function clampVolume(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_PLAYER_PREFERENCES.volume;
  }

  return Math.min(Math.max(value, 0), 1);
}

function normalizePlaybackRate(value: number) {
  return [0.8, 1, 1.15, 1.25, 1.4, 1.5, 1.75, 2].includes(value) ? value : 1;
}

function normalizeFullscreenAutoHide(value: number): FullscreenAutoHide {
  return ([1500, 2500, 4000, 6000] as const).includes(value as FullscreenAutoHide)
    ? (value as FullscreenAutoHide)
    : FULLSCREEN_CONTROLS_IDLE_MS;
}

function parseStoredPreferences(rawValue: string | null): PlayerPreferences {
  if (!rawValue) {
    return DEFAULT_PLAYER_PREFERENCES;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<PlayerPreferences>;

    return {
      playbackRate: normalizePlaybackRate(Number(parsed.playbackRate)),
      volume: clampVolume(Number(parsed.volume)),
      subtitleScale:
        parsed.subtitleScale === "standard" || parsed.subtitleScale === "large" || parsed.subtitleScale === "x-large"
          ? parsed.subtitleScale
          : DEFAULT_PLAYER_PREFERENCES.subtitleScale,
      subtitleLineHeight:
        parsed.subtitleLineHeight === "tight" ||
        parsed.subtitleLineHeight === "standard" ||
        parsed.subtitleLineHeight === "relaxed"
          ? parsed.subtitleLineHeight
          : DEFAULT_PLAYER_PREFERENCES.subtitleLineHeight,
      subtitlePosition:
        parsed.subtitlePosition === "center" ||
        parsed.subtitlePosition === "raised" ||
        parsed.subtitlePosition === "lower-third"
          ? parsed.subtitlePosition
          : DEFAULT_PLAYER_PREFERENCES.subtitlePosition,
      subtitleContrast:
        parsed.subtitleContrast === "solid" || parsed.subtitleContrast === "soft" || parsed.subtitleContrast === "glow"
          ? parsed.subtitleContrast
          : DEFAULT_PLAYER_PREFERENCES.subtitleContrast,
      fullscreenAutoHideMs: normalizeFullscreenAutoHide(Number(parsed.fullscreenAutoHideMs)),
    };
  } catch {
    return DEFAULT_PLAYER_PREFERENCES;
  }
}

function balanceSubtitleText(text: string) {
  const trimmed = text.trim();

  if (!trimmed || trimmed.includes("\n")) {
    return trimmed;
  }

  const words = trimmed.split(/\s+/).filter(Boolean);

  if (words.length < 7 || trimmed.length < 42) {
    return trimmed;
  }

  const totalCharacters = words.reduce((sum, word) => sum + word.length, 0);
  const target = totalCharacters / 2;
  let bestIndex = -1;
  let running = 0;
  let bestDifference = Number.POSITIVE_INFINITY;

  for (let index = 0; index < words.length - 1; index += 1) {
    running += words[index].length;
    const difference = Math.abs(target - running);

    if (difference < bestDifference) {
      bestDifference = difference;
      bestIndex = index;
    }

    running += 1;
  }

  if (bestIndex <= 0) {
    return trimmed;
  }

  const firstLine = words.slice(0, bestIndex + 1).join(" ");
  const secondLine = words.slice(bestIndex + 1).join(" ");

  return secondLine ? `${firstLine}\n${secondLine}` : trimmed;
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

function getChapterTitle(chapter: Chapter, index: number) {
  const trimmed = chapter.title.trim();
  return trimmed || `Chapter ${index + 1}`;
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
  onInlineFullscreenChange = null,
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
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const wakeLockReleaseListenerRef = useRef<EventListener | null>(null);
  const fullscreenFallbackStatusShownRef = useRef(false);
  const fullscreenControlsTimeoutRef = useRef<number | null>(null);

  const [session, setSession] = useState<PlaybackSession | null>(null);
  const [trackLoadRequest, setTrackLoadRequest] = useState<TrackLoadRequest | null>(null);
  const [currentTime, setCurrentTime] = useState(item?.userMediaProgress?.currentTime ?? 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(DEFAULT_PLAYER_PREFERENCES.playbackRate);
  const [volume, setVolume] = useState(DEFAULT_PLAYER_PREFERENCES.volume);
  const [timeDisplayMode, setTimeDisplayMode] = useState<"elapsed" | "remaining">("elapsed");
  const [busyAction, setBusyAction] = useState<"starting" | "syncing" | "refreshing" | null>(null);
  const [playerStatus, setPlayerStatus] = useState<string | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
  const [subtitleSourceLabel, setSubtitleSourceLabel] = useState("No subtitle file loaded");
  const [subtitleStatus, setSubtitleStatus] = useState<string | null>(null);
  const [subtitleError, setSubtitleError] = useState<string | null>(null);
  const [subtitleOffset, setSubtitleOffset] = useState(0);
  const [selectedServerSubtitleId, setSelectedServerSubtitleId] = useState("");
  const [hasPlaybackStarted, setHasPlaybackStarted] = useState(false);
  const [isBrowserFullscreen, setIsBrowserFullscreen] = useState(false);
  const [isInlineFullscreen, setIsInlineFullscreen] = useState(false);
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [isChapterListOpen, setIsChapterListOpen] = useState(false);
  const [isFullscreenControlsVisible, setIsFullscreenControlsVisible] = useState(true);
  const [isSubtitleDisplayOptionsOpen, setIsSubtitleDisplayOptionsOpen] = useState(false);
  const [subtitleScale, setSubtitleScale] = useState<SubtitleScale>(DEFAULT_PLAYER_PREFERENCES.subtitleScale);
  const [subtitleLineHeight, setSubtitleLineHeight] = useState<SubtitleLineHeight>(
    DEFAULT_PLAYER_PREFERENCES.subtitleLineHeight,
  );
  const [subtitlePosition, setSubtitlePosition] = useState<SubtitlePosition>(
    DEFAULT_PLAYER_PREFERENCES.subtitlePosition,
  );
  const [subtitleContrast, setSubtitleContrast] = useState<SubtitleContrast>(
    DEFAULT_PLAYER_PREFERENCES.subtitleContrast,
  );
  const [fullscreenAutoHideMs, setFullscreenAutoHideMs] = useState<FullscreenAutoHide>(
    DEFAULT_PLAYER_PREFERENCES.fullscreenAutoHideMs,
  );
  const [hasLoadedPreferences, setHasLoadedPreferences] = useState(false);

  const serverSubtitleFiles = useMemo(() => listSubtitleFiles(item), [item]);
  const chapters = item?.media.chapters ?? [];
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
  const activeSubtitleText = useMemo(
    () => balanceSubtitleText(activeSubtitle?.text ?? ""),
    [activeSubtitle?.text],
  );
  const activeChapterIndex = useMemo(
    () => getChapterIndexAtTime(chapters, currentTime),
    [chapters, currentTime],
  );
  const progressValue = totalDuration > 0 ? Math.min(currentTime / totalDuration, 1) : 0;
  const isDock = variant === "dock";
  const hasActiveSession = Boolean(session?.id);
  const hasLoadedSubtitles = subtitleCues.length > 0;
  const isFullscreen = isBrowserFullscreen || isInlineFullscreen;
  const shouldShowLyricsStage = !isDock || focusMode || isFullscreen || hasPlaybackStarted;
  const shouldShowLoadedSubtitlePrompt = hasLoadedSubtitles && !hasPlaybackStarted;
  const shouldKeepScreenAwake = isPlaying;
  const shouldShowFullscreenControls =
    !isFullscreen ||
    isFullscreenControlsVisible ||
    !isPlaying ||
    isChapterListOpen ||
    isSubtitleDisplayOptionsOpen;
  const chapterLabel = useMemo(() => formatChapterLabel(activeChapter?.title), [activeChapter?.title]);
  const hasPreviousChapter = activeChapterIndex > 0;
  const hasNextChapter = activeChapterIndex >= 0 && activeChapterIndex < chapters.length - 1;
  const subtitleStageStyle = useMemo(
    () =>
      ({
        "--subtitle-font-scale":
          subtitleScale === "standard" ? "1" : subtitleScale === "large" ? "1.18" : "1.34",
        "--subtitle-line-height":
          subtitleLineHeight === "tight" ? "1.18" : subtitleLineHeight === "standard" ? "1.28" : "1.42",
      }) as CSSProperties,
    [subtitleLineHeight, subtitleScale],
  );

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
    const savedMode = window.localStorage.getItem(TIME_DISPLAY_MODE_STORAGE_KEY);
    setTimeDisplayMode(savedMode === "remaining" ? "remaining" : "elapsed");
  }, []);

  useEffect(() => {
    const storedPreferences = parseStoredPreferences(
      window.localStorage.getItem(PLAYER_PREFERENCES_STORAGE_KEY),
    );

    setPlaybackRate(storedPreferences.playbackRate);
    setVolume(storedPreferences.volume);
    setSubtitleScale(storedPreferences.subtitleScale);
    setSubtitleLineHeight(storedPreferences.subtitleLineHeight);
    setSubtitlePosition(storedPreferences.subtitlePosition);
    setSubtitleContrast(storedPreferences.subtitleContrast);
    setFullscreenAutoHideMs(storedPreferences.fullscreenAutoHideMs);
    setHasLoadedPreferences(true);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(TIME_DISPLAY_MODE_STORAGE_KEY, timeDisplayMode);
  }, [timeDisplayMode]);

  useEffect(() => {
    if (!hasLoadedPreferences) {
      return;
    }

    window.localStorage.setItem(
      PLAYER_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        playbackRate,
        volume,
        subtitleScale,
        subtitleLineHeight,
        subtitlePosition,
        subtitleContrast,
        fullscreenAutoHideMs,
      } satisfies PlayerPreferences),
    );
  }, [
    fullscreenAutoHideMs,
    hasLoadedPreferences,
    playbackRate,
    subtitleContrast,
    subtitleLineHeight,
    subtitlePosition,
    subtitleScale,
    volume,
  ]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const fullscreenDocument = document as FullscreenDocument;
      const fullscreenElement = document.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement ?? null;
      setIsBrowserFullscreen(fullscreenElement === panelRef.current);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange as EventListener);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!isInlineFullscreen) {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
    };
  }, [isInlineFullscreen]);

  useEffect(() => {
    onInlineFullscreenChange?.(isInlineFullscreen);

    return () => {
      onInlineFullscreenChange?.(false);
    };
  }, [isInlineFullscreen, onInlineFullscreenChange]);

  useEffect(() => {
    setIsChapterListOpen(false);
  }, [item?.id]);

  useEffect(() => {
    setIsSubtitleDisplayOptionsOpen(false);
  }, [item?.id]);

  useEffect(() => {
    if (!chapters.length) {
      setIsChapterListOpen(false);
    }
  }, [chapters.length]);

  useEffect(() => {
    if (!playerStatus) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setPlayerStatus((current) => (current === playerStatus ? null : current));
    }, STATUS_MESSAGE_DURATION_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [playerStatus]);

  useEffect(() => {
    if (!subtitleStatus) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSubtitleStatus((current) => (current === subtitleStatus ? null : current));
    }, STATUS_MESSAGE_DURATION_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [subtitleStatus]);

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

  const clearFullscreenControlsTimer = useEventCallback(() => {
    if (fullscreenControlsTimeoutRef.current !== null) {
      window.clearTimeout(fullscreenControlsTimeoutRef.current);
      fullscreenControlsTimeoutRef.current = null;
    }
  });

  const hideFullscreenControls = useEventCallback(() => {
    if (!isFullscreen || !isPlaying || isChapterListOpen) {
      return;
    }

    clearFullscreenControlsTimer();
    setIsFullscreenControlsVisible(false);
  });

  const revealFullscreenControls = useEventCallback((keepVisible = false) => {
    if (!isFullscreen) {
      return;
    }

    setIsFullscreenControlsVisible(true);
    clearFullscreenControlsTimer();

    if (keepVisible || !isPlaying || isChapterListOpen) {
      return;
    }

    fullscreenControlsTimeoutRef.current = window.setTimeout(() => {
      setIsFullscreenControlsVisible(false);
      fullscreenControlsTimeoutRef.current = null;
    }, fullscreenAutoHideMs);
  });

  useEffect(() => {
    if (!isFullscreen) {
      setIsFullscreenControlsVisible(true);
      clearFullscreenControlsTimer();
      return;
    }

    revealFullscreenControls();

    return () => {
      clearFullscreenControlsTimer();
    };
  }, [clearFullscreenControlsTimer, isChapterListOpen, isFullscreen, isPlaying, revealFullscreenControls]);

  const exitFullscreenSafely = useEventCallback(async (target?: Element | null) => {
    const activeTarget = target ?? panelRef.current;
    const fullscreenDocument = document as FullscreenDocument;
    const fullscreenElement = document.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement ?? null;

    if (isInlineFullscreen && activeTarget === panelRef.current) {
      setIsInlineFullscreen(false);
      return;
    }

    if (
      !activeTarget ||
      fullscreenElement !== activeTarget ||
      document.visibilityState !== "visible" ||
      !document.hasFocus() ||
      (typeof document.exitFullscreen !== "function" &&
        typeof fullscreenDocument.webkitExitFullscreen !== "function")
    ) {
      return;
    }

    try {
      if (typeof document.exitFullscreen === "function") {
        await document.exitFullscreen();
        return;
      }

      if (typeof fullscreenDocument.webkitExitFullscreen === "function") {
        await fullscreenDocument.webkitExitFullscreen.call(document);
      }
    } catch {
      // Ignore browser timing issues if the document is no longer active.
    }
  });

  const clearWakeLockReference = useEventCallback(() => {
    const sentinel = wakeLockRef.current;
    const listener = wakeLockReleaseListenerRef.current;

    if (sentinel && listener && typeof sentinel.removeEventListener === "function") {
      sentinel.removeEventListener("release", listener);
    }

    wakeLockRef.current = null;
    wakeLockReleaseListenerRef.current = null;
  });

  const releaseWakeLock = useEventCallback(async () => {
    const sentinel = wakeLockRef.current;

    if (!sentinel) {
      return;
    }

    clearWakeLockReference();

    try {
      await sentinel.release();
    } catch {
      // Ignore wake lock teardown errors during tab switches and unload.
    }
  });

  const requestWakeLock = useEventCallback(async () => {
    if (typeof document === "undefined" || typeof navigator === "undefined") {
      return false;
    }

    if (document.visibilityState !== "visible") {
      return false;
    }

    const activeWakeLock = wakeLockRef.current;

    if (activeWakeLock && !activeWakeLock.released) {
      return true;
    }

    clearWakeLockReference();

    const wakeLockNavigator = navigator as NavigatorWithWakeLock;

    if (typeof wakeLockNavigator.wakeLock?.request !== "function") {
      return false;
    }

    try {
      const sentinel = await wakeLockNavigator.wakeLock.request("screen");
      const handleRelease: EventListener = () => {
        if (wakeLockRef.current === sentinel) {
          wakeLockRef.current = null;
          wakeLockReleaseListenerRef.current = null;
        }
      };

      sentinel.addEventListener?.("release", handleRelease);
      wakeLockRef.current = sentinel;
      wakeLockReleaseListenerRef.current = handleRelease;
      return true;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!shouldKeepScreenAwake) {
      void releaseWakeLock();
      return;
    }

    void requestWakeLock();
  }, [releaseWakeLock, requestWakeLock, shouldKeepScreenAwake]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        if (shouldKeepScreenAwake) {
          void requestWakeLock();
        }

        return;
      }

      void releaseWakeLock();
    };

    const handlePageHide = () => {
      void releaseWakeLock();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [releaseWakeLock, requestWakeLock, shouldKeepScreenAwake]);

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

      if (!targetItem || !targetSession?.id) {
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

    void exitFullscreenSafely(panelRef.current);

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
    fullscreenFallbackStatusShownRef.current = false;
    void releaseWakeLock();
    setIsOptionsOpen(false);
    setIsBrowserFullscreen(false);
    setIsInlineFullscreen(false);

    if (!item) {
      setSubtitleSourceLabel("No subtitle file loaded");
      setSubtitleStatus(null);
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
    setSubtitleStatus(null);
  }, [exitFullscreenSafely, item?.id, releaseWakeLock]);

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
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    audio.volume = volume;
  }, [volume]);

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
      void releaseWakeLock();
      void syncToAudiobookshelf("close", { silent: true, refreshItem: false });
    };
  }, [pauseListeningClock, releaseWakeLock, syncToAudiobookshelf]);

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

  function handleChapterJump(chapter: Chapter, index: number) {
    queueTrackLoad(chapter.start, Boolean(sessionRef.current) && isPlayingRef.current);
    setIsChapterListOpen(false);
    setPlayerStatus(`Jumped to ${getChapterTitle(chapter, index)}.`);
  }

  function handleChapterStep(direction: "previous" | "next") {
    if (!chapters.length || activeChapterIndex < 0) {
      return;
    }

    const nextIndex =
      direction === "previous"
        ? Math.max(activeChapterIndex - 1, 0)
        : Math.min(activeChapterIndex + 1, chapters.length - 1);

    if (nextIndex === activeChapterIndex) {
      return;
    }

    const targetChapter = chapters[nextIndex];

    if (!targetChapter) {
      return;
    }

    handleChapterJump(targetChapter, nextIndex);
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
    void requestWakeLock();
  }

  function handlePause() {
    setIsPlaying(false);
    pauseListeningClock();
    void releaseWakeLock();
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
    const panel = panelRef.current as FullscreenPanelElement | null;

    if (!panel) {
      return;
    }

    if (isFullscreen) {
      await exitFullscreenSafely(panel);
      return;
    }

    try {
      if (typeof panel.requestFullscreen === "function") {
        await panel.requestFullscreen({ navigationUI: "hide" });
        return;
      }

      if (typeof panel.webkitRequestFullscreen === "function") {
        await panel.webkitRequestFullscreen();
        return;
      }
    } catch {
      // Fall back to an in-page fullscreen layout for browsers like iPad Safari.
    }

    setIsInlineFullscreen(true);
    setIsOptionsOpen(false);

    if (!fullscreenFallbackStatusShownRef.current) {
      setPlayerStatus("Using the immersive tablet view for this browser.");
      fullscreenFallbackStatusShownRef.current = true;
    }
  }

  function handlePlaybackRateChange(nextValue: number) {
    setPlaybackRate(nextValue);
    revealFullscreenControls();
  }

  function handleVolumeChange(nextValue: number) {
    setVolume(nextValue);
    revealFullscreenControls();
  }

  function handleSubtitleScaleChange(nextValue: SubtitleScale) {
    setSubtitleScale(nextValue);
    revealFullscreenControls(true);
  }

  function handleSubtitleLineHeightChange(nextValue: SubtitleLineHeight) {
    setSubtitleLineHeight(nextValue);
    revealFullscreenControls(true);
  }

  function handleSubtitlePositionChange(nextValue: SubtitlePosition) {
    setSubtitlePosition(nextValue);
    revealFullscreenControls(true);
  }

  function handleSubtitleContrastChange(nextValue: SubtitleContrast) {
    setSubtitleContrast(nextValue);
    revealFullscreenControls(true);
  }

  function handleFullscreenAutoHideChange(nextValue: FullscreenAutoHide) {
    setFullscreenAutoHideMs(nextValue);
    revealFullscreenControls(true);
  }

  function toggleSubtitleDisplayOptions() {
    setIsSubtitleDisplayOptionsOpen((current) => !current);
    revealFullscreenControls(true);
  }

  function handleFullscreenStageTap(event: MouseEvent<HTMLDivElement>) {
    if (!isFullscreen) {
      return;
    }

    const target = event.target;

    if (!(target instanceof Element)) {
      return;
    }

    if (target.closest(".transport-shell-fullscreen")) {
      return;
    }

    if (shouldShowFullscreenControls && isPlaying && !isChapterListOpen) {
      hideFullscreenControls();
      return;
    }

    revealFullscreenControls();
  }

  useEffect(() => {
    if (!isFullscreen) {
      return;
    }

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.code !== "Space" || event.repeat) {
        return;
      }

      const target = event.target;

      if (target instanceof HTMLElement) {
        const tagName = target.tagName;

        if (
          target.isContentEditable ||
          tagName === "INPUT" ||
          tagName === "TEXTAREA" ||
          tagName === "SELECT"
        ) {
          return;
        }
      }

      event.preventDefault();
      revealFullscreenControls(true);
      void handlePrimaryTransport();
    };

    window.addEventListener("keydown", handleWindowKeyDown);

    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [isFullscreen, revealFullscreenControls]);

  function renderSubtitleTools() {
    return (
      <>
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

        <div className="subtitle-display-options-panel">{renderSubtitleDisplayOptions()}</div>
      </>
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

  function renderSubtitleStage() {
    return (
      <section className="subtitle-stage" style={isFullscreen ? subtitleStageStyle : undefined}>
        {!isDock && !isFullscreen ? <div className="subtitle-tools">{renderSubtitleTools()}</div> : null}

        {shouldShowLyricsStage ? (
          <article
            className={`subtitle-card subtitle-card-contrast-${subtitleContrast} ${
              isFullscreen ? `subtitle-card-position-${subtitlePosition}` : ""
            } ${
              hasLoadedSubtitles ? "" : "subtitle-card-empty"
            }`.trim()}
          >
            {hasLoadedSubtitles && !shouldShowLoadedSubtitlePrompt ? (
              <p className="subtitle-active">
                {activeSubtitleText || "\u00A0"}
              </p>
            ) : (
              renderSubtitlePrompt()
            )}
          </article>
        ) : (
          renderSubtitlePrompt()
        )}
      </section>
    );
  }

  function renderSubtitleDisplayOptions() {
    return (
      <section className="subtitle-display-options-grid" onClick={(event) => event.stopPropagation()}>
        <label className="field field-compact">
          <span>Subtitle size</span>
          <select
            onChange={(event) => handleSubtitleScaleChange(event.target.value as SubtitleScale)}
            value={subtitleScale}
          >
            <option value="standard">Standard</option>
            <option value="large">Large</option>
            <option value="x-large">Extra large</option>
          </select>
        </label>

        <label className="field field-compact">
          <span>Line height</span>
          <select
            onChange={(event) => handleSubtitleLineHeightChange(event.target.value as SubtitleLineHeight)}
            value={subtitleLineHeight}
          >
            <option value="tight">Tight</option>
            <option value="standard">Standard</option>
            <option value="relaxed">Relaxed</option>
          </select>
        </label>

        <label className="field field-compact">
          <span>Subtitle position</span>
          <select
            onChange={(event) => handleSubtitlePositionChange(event.target.value as SubtitlePosition)}
            value={subtitlePosition}
          >
            <option value="center">Center</option>
            <option value="raised">Raised</option>
            <option value="lower-third">Lower third</option>
          </select>
        </label>

        <label className="field field-compact">
          <span>Contrast</span>
          <select
            onChange={(event) => handleSubtitleContrastChange(event.target.value as SubtitleContrast)}
            value={subtitleContrast}
          >
            <option value="solid">Solid</option>
            <option value="soft">Soft</option>
            <option value="glow">Glow</option>
          </select>
        </label>

        <label className="field field-compact">
          <span>Hide controls</span>
          <select
            onChange={(event) =>
              handleFullscreenAutoHideChange(Number(event.target.value) as FullscreenAutoHide)
            }
            value={fullscreenAutoHideMs}
          >
            <option value={1500}>1.5s</option>
            <option value={2500}>2.5s</option>
            <option value={4000}>4s</option>
            <option value={6000}>6s</option>
          </select>
        </label>
      </section>
    );
  }

  function renderTransport() {
    const primaryLabel = !session ? "Start playback" : isPlaying ? "Pause playback" : "Resume playback";
    const fullscreenLabel = isFullscreen ? "Exit full screen" : "Enter full screen";
    const volumePercent = Math.round(volume * 100);
    const timeModeLabel = timeDisplayMode === "remaining" ? "Show elapsed time" : "Show remaining time";
    const timelineDisplay =
      timeDisplayMode === "remaining"
        ? `-${formatTime(Math.max(totalDuration - currentTime, 0))}`
        : formatTime(currentTime);

    return (
      <section
        className={`transport ${isFullscreen ? "transport-fullscreen" : ""}`.trim()}
        onBlur={(event) => {
          if (!isFullscreen) {
            return;
          }

          const nextFocused = event.relatedTarget;

          if (nextFocused instanceof Node && event.currentTarget.contains(nextFocused)) {
            return;
          }

          revealFullscreenControls();
        }}
        onFocus={() => {
          if (isFullscreen) {
            revealFullscreenControls(true);
          }
        }}
      >
        <div className="transport-topline">
          <div className="transport-timeline">
            <button
              aria-label={timeModeLabel}
              className="progress-pill progress-pill-button"
              onClick={() =>
                setTimeDisplayMode((current) => (current === "elapsed" ? "remaining" : "elapsed"))
              }
              title={timeModeLabel}
              type="button"
            >
              <span>{timelineDisplay}</span>
              <span>/</span>
              <span>{formatTime(totalDuration)}</span>
            </button>

            {chapterLabel ? (
              <button
                className={`chapter-pill chapter-pill-button ${
                  isChapterListOpen ? "chapter-pill-button-active" : ""
                }`.trim()}
                onClick={() => {
                  setIsChapterListOpen((current) => !current);
                  revealFullscreenControls(true);
                }}
                type="button"
              >
                {chapterLabel}
              </button>
            ) : null}
          </div>

          <div className="transport-settings">
            <label className="speed-control">
              <span>Speed</span>
              <select
                onChange={(event) => handlePlaybackRateChange(Number(event.target.value))}
                value={playbackRate}
              >
                {[0.8, 1, 1.15, 1.25, 1.4, 1.5, 1.75, 2].map((speed) => (
                  <option key={speed} value={speed}>
                    {speed}x
                  </option>
                ))}
              </select>
            </label>

            <label className="volume-control">
              <span>Volume</span>
              <input
                aria-label="Player volume"
                className="volume-slider"
                max={1}
                min={0}
                onChange={(event) => handleVolumeChange(Number(event.target.value))}
                step={0.01}
                style={{ "--volume-percent": `${volumePercent}%` } as CSSProperties}
                type="range"
                value={volume}
              />
              <output aria-live="off" className="volume-value">
                {volumePercent}%
              </output>
            </label>
          </div>
        </div>

        <input
          className="progress-slider"
          max={Math.max(totalDuration, 1)}
          min={0}
          onChange={(event) => {
            handleSeek(Number(event.target.value));
            revealFullscreenControls();
          }}
          step={0.1}
          type="range"
          value={Math.min(currentTime, Math.max(totalDuration, 1))}
        />

        <div className="transport-controls">
          <div className="transport-controls-main">
            <button
              aria-label="Previous chapter"
              className="icon-button transport-action-button transport-chapter-button"
              disabled={!hasPreviousChapter}
              onClick={() => {
                handleChapterStep("previous");
                revealFullscreenControls();
              }}
              title="Previous chapter"
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20">
                <path d="M6 4v12" />
                <path d="M14 5l-6 5 6 5" />
              </svg>
            </button>

            <button
              aria-label="Back 15 seconds"
              className="icon-button transport-action-button"
              onClick={() => {
                handleRelativeSeek(-15);
                revealFullscreenControls();
              }}
              title="Back 15 seconds"
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20">
                <path d="M11 5l-5 5 5 5" />
                <path d="M16 5l-5 5 5 5" />
              </svg>
            </button>

            <button
              aria-label={primaryLabel}
              className="icon-button transport-action-button"
              disabled={busyAction === "starting"}
              onClick={() => {
                void handlePrimaryTransport();
                revealFullscreenControls(true);
              }}
              title={busyAction === "starting" ? "Starting playback" : primaryLabel}
              type="button"
            >
              {isPlaying ? (
                <svg aria-hidden="true" viewBox="0 0 20 20">
                  <path d="M8 5v10" />
                  <path d="M12 5v10" />
                </svg>
              ) : (
                <svg aria-hidden="true" viewBox="0 0 20 20">
                  <path d="M7 5.5l7 4.5-7 4.5z" />
                </svg>
              )}
            </button>

            <button
              aria-label="Forward 30 seconds"
              className="icon-button transport-action-button"
              onClick={() => {
                handleRelativeSeek(30);
                revealFullscreenControls();
              }}
              title="Forward 30 seconds"
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20">
                <path d="M9 5l5 5-5 5" />
                <path d="M4 5l5 5-5 5" />
              </svg>
            </button>

            <button
              aria-label="Next chapter"
              className="icon-button transport-action-button transport-chapter-button"
              disabled={!hasNextChapter}
              onClick={() => {
                handleChapterStep("next");
                revealFullscreenControls();
              }}
              title="Next chapter"
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20">
                <path d="M14 4v12" />
                <path d="M6 5l6 5-6 5" />
              </svg>
            </button>
          </div>

          <div className="transport-controls-side">
            <button
              aria-expanded={isSubtitleDisplayOptionsOpen}
              aria-label="Subtitle display options"
              className={`icon-button transport-action-button fullscreen-button ${
                isSubtitleDisplayOptionsOpen ? "transport-action-button-active" : ""
              }`.trim()}
              onClick={() => toggleSubtitleDisplayOptions()}
              title="Subtitle display options"
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20">
                <path d="M4 6h12" />
                <path d="M4 10h12" />
                <path d="M4 14h8" />
                <circle cx="15.5" cy="14" r="1.5" />
              </svg>
            </button>

            <button
              aria-label="Pop out player"
              className="icon-button transport-action-button fullscreen-button"
              onClick={() => {
                revealFullscreenControls(true);
                openPopout();
              }}
              title="Pop out player"
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20">
                <path d="M11 4h5v5" />
                <path d="M10 10l6-6" />
                <path d="M8 4H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-3" />
              </svg>
            </button>

            <button
              aria-label={fullscreenLabel}
              className="icon-button transport-action-button fullscreen-button"
              onClick={() => {
                revealFullscreenControls(true);
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

        {isSubtitleDisplayOptionsOpen ? (
          <section className="transport-subpanel">
            {renderSubtitleDisplayOptions()}
          </section>
        ) : null}

        {isChapterListOpen && chapters.length ? (
          <section className="chapter-picker">
            <div className="chapter-list" role="list">
              {chapters.map((chapter, index) => {
                const isActiveChapter = index === activeChapterIndex;

                return (
                  <button
                    aria-current={isActiveChapter ? "true" : undefined}
                    className={`chapter-option ${isActiveChapter ? "chapter-option-active" : ""}`.trim()}
                    key={chapter.id ?? `${chapter.start}-${chapter.end}-${index}`}
                    onClick={() => {
                      handleChapterJump(chapter, index);
                      revealFullscreenControls();
                    }}
                    type="button"
                  >
                    <span className="chapter-option-title">{getChapterTitle(chapter, index)}</span>
                    <span className="chapter-option-meta">{formatTime(chapter.start)}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        <div className="transport-meta">
          <span>{item?.media.metadata.title ?? "Waiting for audiobook"}</span>
          <span>{Math.round(progressValue * 100)}% complete</span>
        </div>
      </section>
    );
  }

  function renderFooterMeta() {
    const shouldShowSubtitleMeta = shouldShowLyricsStage;
    const footerNotice = playerError ?? subtitleError ?? playerStatus ?? subtitleStatus;
    const footerNoticeIsError = Boolean(playerError || subtitleError);

    if (!shouldShowSubtitleMeta && !footerNotice && !(isDock && onHide)) {
      return null;
    }

    return (
      <section className="player-footer">
        <div className={`player-footer-row ${shouldShowSubtitleMeta ? "" : "player-footer-row-end"}`.trim()}>
          {shouldShowSubtitleMeta ? (
            <div className="player-footer-notice" aria-live="polite">
              {footerNotice ? (
                <p className={`status-message ${footerNoticeIsError ? "status-error" : ""}`.trim()}>
                  {footerNotice}
                </p>
              ) : (
                <p aria-hidden="true" className="status-message player-footer-placeholder">
                  .
                </p>
              )}
            </div>
          ) : null}

          {isDock && onHide ? (
            <button className="button button-secondary player-hide-button" onClick={onHide} type="button">
              Hide player
            </button>
          ) : null}
        </div>
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
          disabled={busyAction === "syncing" || !hasActiveSession}
          onClick={() => {
            void syncToAudiobookshelf("sync", { refreshItem: true });
          }}
          type="button"
        >
          Force sync to Audiobookshelf
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
      } ${isBrowserFullscreen ? "player-panel-fullscreen" : ""} ${
        isInlineFullscreen ? "player-panel-inline-fullscreen" : ""
      } ${
        shouldShowLyricsStage ? "player-panel-reading" : "player-panel-compact"
      } ${isFullscreen && !shouldShowFullscreenControls ? "player-panel-fullscreen-controls-hidden" : ""}`}
      onKeyDownCapture={() => {
        if (isFullscreen) {
          revealFullscreenControls(true);
        }
      }}
      onMouseMove={() => {
        if (isFullscreen) {
          revealFullscreenControls();
        }
      }}
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

      {isFullscreen ? (
        <div className="player-panel-fullscreen-stage" onClick={handleFullscreenStageTap}>
          {renderSubtitleStage()}

          <div
            aria-hidden={!shouldShowFullscreenControls}
            className={`transport-shell-fullscreen ${
              shouldShowFullscreenControls ? "transport-shell-visible" : "transport-shell-hidden"
            }`.trim()}
            onClick={(event) => event.stopPropagation()}
          >
            {renderTransport()}
          </div>
        </div>
      ) : (
        <>
          {renderSubtitleStage()}
          {renderTransport()}
        </>
      )}
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
