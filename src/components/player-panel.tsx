"use client";

import { ChangeEvent, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import {
  AudioTrack,
  Chapter,
  LibraryFile,
  LibraryItemExpanded,
  PlaybackSession,
  SubtitleCue,
} from "@/lib/types";
import { playbackFinished } from "@/lib/listening-status";
import { progressSaveFailure, progressRetryDelay } from "@/lib/progress-save-feedback";
import { publishProgress } from "@/lib/progress-client";
import { PlayerIcon } from "@/components/player-icon";
import { parseSubtitle } from "@/lib/srt";
import { chapterMarkers, normalizePlayerAppearance, previousSubtitle, SeekUndoHistory, SUBTITLE_FONTS, useDarkSubtitleText, type PlayerAppearance } from "@/lib/player-display";
import { formatSleepTimer, useSleepTimer, type SleepTimerSelection } from "@/components/use-sleep-timer";

type PlayerPanelProps = {
  item: LibraryItemExpanded | null;
  onItemRefresh: (itemId: string) => Promise<LibraryItemExpanded | null>;
  focusMode?: boolean;
  onHide?: (() => void) | null;
  onInlineFullscreenChange?: ((isActive: boolean) => void) | null;
  openToken?: number;
  preferenceScope?: string;
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
const BOOK_SUBTITLE_PREFERENCES_STORAGE_KEY = "spoken-page-book-subtitle-preferences";
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

type PlayerPreferences = PlayerAppearance & {
  playbackRate: number;
  volume: number;
  subtitleScale: SubtitleScale;
  subtitleLineHeight: SubtitleLineHeight;
  subtitlePosition: SubtitlePosition;
  subtitleContrast: SubtitleContrast;
  fullscreenAutoHideMs: FullscreenAutoHide;
};

type BookSubtitlePreference = { offset: number; serverFileId: string };

function scopedPlayerStorageKey(base: string, scope: string) {
  return `${base}:${encodeURIComponent(scope)}`;
}

function readBookSubtitlePreference(bookId: string, scope: string): BookSubtitlePreference {
  try {
    const all = JSON.parse(window.localStorage.getItem(scopedPlayerStorageKey(BOOK_SUBTITLE_PREFERENCES_STORAGE_KEY, scope)) ?? "{}") as Record<
      string,
      Partial<BookSubtitlePreference>
    >;
    const value = all[bookId];
    return {
      offset: Number.isFinite(Number(value?.offset)) ? Math.min(8, Math.max(-8, Number(value?.offset))) : 0,
      serverFileId: typeof value?.serverFileId === "string" ? value.serverFileId : "",
    };
  } catch {
    return { offset: 0, serverFileId: "" };
  }
}

function writeBookSubtitlePreference(bookId: string, value: BookSubtitlePreference, scope: string) {
  try {
    const storageKey = scopedPlayerStorageKey(BOOK_SUBTITLE_PREFERENCES_STORAGE_KEY, scope);
    const all = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}") as Record<
      string,
      BookSubtitlePreference
    >;
    all[bookId] = value;
    window.localStorage.setItem(storageKey, JSON.stringify(all));
  } catch {
    // Storage can be unavailable in private browsing; playback should continue.
  }
}

function readAllBookSubtitlePreferences(scope: string) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(scopedPlayerStorageKey(BOOK_SUBTITLE_PREFERENCES_STORAGE_KEY, scope)) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, BookSubtitlePreference>)
      : {};
  } catch {
    return {};
  }
}

const DEFAULT_PLAYER_PREFERENCES: PlayerPreferences = {
  ...normalizePlayerAppearance(),
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
    return extension === "srt" || extension === "vtt" || filename.endsWith(".srt") || filename.endsWith(".vtt");
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
      ...normalizePlayerAppearance(parsed),
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
  preferenceScope = "anonymous",
  variant = "full",
}: PlayerPanelProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const subtitleUploadRef = useRef<HTMLInputElement | null>(null);
  const subtitleCardRef = useRef<HTMLElement | null>(null);
  const subtitleLinesRef = useRef<HTMLDivElement | null>(null);
  const transportRef = useRef<HTMLElement | null>(null);
  const itemRef = useRef<LibraryItemExpanded | null>(item);
  const previousItemRef = useRef<LibraryItemExpanded | null>(null);
  const sessionRef = useRef<PlaybackSession | null>(null);
  const currentTimeRef = useRef(0);
  const completionReachedRef = useRef(false);
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
  const checkpointSequenceRef = useRef(0);
  const checkpointQueueRef = useRef<Promise<void>>(Promise.resolve());
  const failedCheckpointRef = useRef<{ itemId: string; sessionId: string; mode: "sync" | "close" } | null>(null);
  const saveFailuresRef = useRef(0);
  const lastSyncedTimeRef = useRef(0);
  const lastAutoRefreshTokenRef = useRef(0);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const wakeLockReleaseListenerRef = useRef<EventListener | null>(null);
  const fullscreenFallbackStatusShownRef = useRef(false);
  const fullscreenControlsTimeoutRef = useRef<number | null>(null);
  const playerPreferencesDirtyRef = useRef(false);
  const subtitlePreferencesDirtyRef = useRef(false);
  const seekHistoryRef = useRef(new SeekUndoHistory());
  const chapterDialogRef = useRef<HTMLDialogElement | null>(null);

  const [session, setSession] = useState<PlaybackSession | null>(null);
  const [trackLoadRequest, setTrackLoadRequest] = useState<TrackLoadRequest | null>(null);
  const [currentTime, setCurrentTime] = useState(item?.userMediaProgress?.currentTime ?? 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(DEFAULT_PLAYER_PREFERENCES.playbackRate);
  const [volume, setVolume] = useState(DEFAULT_PLAYER_PREFERENCES.volume);
  const [timeDisplayMode, setTimeDisplayMode] = useState<"total" | "remaining">("remaining");
  const [undoTime, setUndoTime] = useState<number | null>(null);
  const [chapterPage, setChapterPage] = useState(0);
  const [appearance, setAppearance] = useState<PlayerAppearance>(() => normalizePlayerAppearance());
  const [busyAction, setBusyAction] = useState<"starting" | "syncing" | "refreshing" | null>(null);
  const [playerStatus, setPlayerStatus] = useState<string | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [progressSaveNotice, setProgressSaveNotice] = useState<{ state: "saving" | "saved" | "failed"; message: string; retryable: boolean } | null>(null);
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
  const [subtitleSourceLabel, setSubtitleSourceLabel] = useState("No subtitle file loaded");
  const [subtitleStatus, setSubtitleStatus] = useState<string | null>(null);
  const [subtitleError, setSubtitleError] = useState<string | null>(null);
  const [subtitleOffset, setSubtitleOffset] = useState(0);
  const [selectedServerSubtitleId, setSelectedServerSubtitleId] = useState("");
  const [subtitlePreferenceItemId, setSubtitlePreferenceItemId] = useState<string | null>(null);
  const [hasPlaybackStarted, setHasPlaybackStarted] = useState(false);
  const [isBrowserFullscreen, setIsBrowserFullscreen] = useState(false);
  const [isInlineFullscreen, setIsInlineFullscreen] = useState(false);
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [isChapterListOpen, setIsChapterListOpen] = useState(false);
  const [isFullscreenControlsVisible, setIsFullscreenControlsVisible] = useState(true);
  const [isShortcutHelpOpen, setIsShortcutHelpOpen] = useState(false);
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
  const [subtitlePreferencesRevision, setSubtitlePreferencesRevision] = useState(0);
  const [hasLoadedSubtitlePreferences, setHasLoadedSubtitlePreferences] = useState(false);

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
  const sleepTimer = useSleepTimer(item?.id, currentTime, activeChapter?.end, () => {
    audioRef.current?.pause();
    setIsPlaying(false);
    setPlayerStatus("Sleep timer finished. Playback paused.");
  });
  const activeSubtitle = useMemo(
    () => getSubtitleCueAtTime(subtitleCues, currentTime + subtitleOffset),
    [currentTime, subtitleCues, subtitleOffset],
  );
  const activeSubtitleText = useMemo(
    () => activeSubtitle?.text.trim() ?? "",
    [activeSubtitle?.text],
  );
  const previousSubtitleCue = useMemo(() => previousSubtitle(subtitleCues, currentTime + subtitleOffset, activeSubtitle), [subtitleCues, currentTime, subtitleOffset, activeSubtitle]);
  const timelineMarkers = useMemo(() => chapterMarkers(chapters, totalDuration), [chapters, totalDuration]);
  const activeChapterIndex = useMemo(
    () => getChapterIndexAtTime(chapters, currentTime),
    [chapters, currentTime],
  );
  const progressValue = totalDuration > 0 ? Math.min(currentTime / totalDuration, 1) : 0;
  const isDock = variant === "dock";
  const hasActiveSession = Boolean(session?.id);
  const hasLoadedSubtitles = subtitleCues.length > 0;
  const isFullscreen = isBrowserFullscreen || isInlineFullscreen;
  const shouldShowLyricsStage = true;
  const shouldShowLoadedSubtitlePrompt = hasLoadedSubtitles && !hasPlaybackStarted;
  const shouldKeepScreenAwake = isPlaying;
  const shouldShowFullscreenControls =
    !isFullscreen ||
    isFullscreenControlsVisible ||
    !isPlaying ||
    isChapterListOpen ||
    isOptionsOpen || isShortcutHelpOpen;
  const subtitleStageStyle = useMemo(
    () =>
      ({
        "--subtitle-font-scale":
          subtitleScale === "standard" ? "1" : subtitleScale === "large" ? "1.18" : "1.34",
        "--subtitle-line-height":
          subtitleLineHeight === "tight" ? "1.18" : subtitleLineHeight === "standard" ? "1.28" : "1.42",
        "--subtitle-font-family": SUBTITLE_FONTS[appearance.subtitleFont],
        "--subtitle-size": `${appearance.subtitleSize}px`,
        "--subtitle-dock-size": `${Math.round(appearance.subtitleSize * 18 / 34)}px`,
        "--subtitle-align": appearance.subtitleAlignment,
        "--subtitle-vertical": appearance.subtitleVerticalAlignment === "top" ? "flex-start" : appearance.subtitleVerticalAlignment === "bottom" ? "flex-end" : "center",
      }) as CSSProperties,
    [subtitleLineHeight, subtitleScale, appearance],
  );

  useLayoutEffect(() => {
    const card = subtitleCardRef.current;
    const lines = subtitleLinesRef.current;
    const transport = transportRef.current;
    if (!card || !isFullscreen) return;
    let cancelled = false;
    const fit = () => {
      if (cancelled) return;
      const optionsHeight = transport?.querySelector(".player-options-panel")?.getBoundingClientRect().height ?? 0;
      const clearance = shouldShowFullscreenControls && transport
        ? Math.min(card.clientHeight / 2, transport.offsetHeight - optionsHeight + 16)
        : 0;
      card.style.setProperty("--subtitle-controls-clearance", `${clearance}px`);
      if (!lines) return;
      lines.style.removeProperty("--fitted-subtitle-size");
      if (appearance.subtitleSizeMode !== "fill") return;
      const style = getComputedStyle(card);
      const height = card.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const width = lines.clientWidth;
      if (height <= 0 || width <= 0) return;
      // Measure the actual chosen font and both visible lines, including wrapping.
      let low = 8;
      let high = Math.max(height, width);
      for (let attempt = 0; attempt < 12; attempt++) {
        const size = (low + high) / 2;
        lines.style.setProperty("--fitted-subtitle-size", `${size}px`);
        if (lines.scrollHeight <= height && lines.scrollWidth <= width) low = size;
        else high = size;
      }
      lines.style.setProperty("--fitted-subtitle-size", `${Math.floor(low)}px`);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(card);
    if (transport) observer.observe(transport);
    void document.fonts.ready.then(fit);
    return () => { cancelled = true; observer.disconnect(); };
  }, [isFullscreen, shouldShowFullscreenControls, appearance, activeSubtitleText, previousSubtitleCue?.text, subtitleLineHeight, hasLoadedSubtitles, shouldShowLoadedSubtitlePrompt]);

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
    const savedMode = window.localStorage.getItem(scopedPlayerStorageKey(TIME_DISPLAY_MODE_STORAGE_KEY, preferenceScope));
    setTimeDisplayMode(savedMode === "total" ? "total" : "remaining");
  }, [preferenceScope]);

  useEffect(() => {
    setHasLoadedPreferences(false);
    const storedPreferences = parseStoredPreferences(
      window.localStorage.getItem(scopedPlayerStorageKey(PLAYER_PREFERENCES_STORAGE_KEY, preferenceScope)),
    );

    setPlaybackRate(storedPreferences.playbackRate);
    setAppearance(normalizePlayerAppearance(storedPreferences));
    setVolume(storedPreferences.volume);
    setSubtitleScale(storedPreferences.subtitleScale);
    setSubtitleLineHeight(storedPreferences.subtitleLineHeight);
    setSubtitlePosition(storedPreferences.subtitlePosition);
    setSubtitleContrast(storedPreferences.subtitleContrast);
    setFullscreenAutoHideMs(storedPreferences.fullscreenAutoHideMs);
    const loadServerPreferences = async () => {
      try {
        const response = await fetch("/api/preferences/player", { cache: "no-store" });
        if (response.ok) {
          const payload = (await response.json()) as { value?: unknown };
          if (payload.value) {
            const serverPreferences = parseStoredPreferences(JSON.stringify(payload.value));
            setPlaybackRate(serverPreferences.playbackRate);
            setAppearance(normalizePlayerAppearance(serverPreferences));
            setVolume(serverPreferences.volume);
            setSubtitleScale(serverPreferences.subtitleScale);
            setSubtitleLineHeight(serverPreferences.subtitleLineHeight);
            setSubtitlePosition(serverPreferences.subtitlePosition);
            setSubtitleContrast(serverPreferences.subtitleContrast);
            setFullscreenAutoHideMs(serverPreferences.fullscreenAutoHideMs);
          }
        }
      } finally {
        setHasLoadedPreferences(true);
      }
    };
    void loadServerPreferences();
  }, [preferenceScope]);

  useEffect(() => {
    setHasLoadedSubtitlePreferences(false);
    const loadServerSubtitlePreferences = async () => {
      try {
        const response = await fetch("/api/preferences/subtitles", { cache: "no-store" });
        if (response.ok) {
          const payload = (await response.json()) as { value?: unknown };
          if (payload.value && typeof payload.value === "object" && !Array.isArray(payload.value)) {
            const merged = { ...readAllBookSubtitlePreferences(preferenceScope), ...(payload.value as object) };
            window.localStorage.setItem(scopedPlayerStorageKey(BOOK_SUBTITLE_PREFERENCES_STORAGE_KEY, preferenceScope), JSON.stringify(merged));
            setSubtitlePreferencesRevision((value) => value + 1);
          }
        }
      } finally {
        setHasLoadedSubtitlePreferences(true);
      }
    };
    void loadServerSubtitlePreferences();
  }, [preferenceScope]);

  useEffect(() => {
    window.localStorage.setItem(scopedPlayerStorageKey(TIME_DISPLAY_MODE_STORAGE_KEY, preferenceScope), timeDisplayMode);
  }, [preferenceScope, timeDisplayMode]);

  useEffect(() => {
    if (!hasLoadedPreferences) {
      return;
    }

    const preferences = {
      ...appearance,
      playbackRate,
      volume,
      subtitleScale,
      subtitleLineHeight,
      subtitlePosition,
      subtitleContrast,
      fullscreenAutoHideMs,
    } satisfies PlayerPreferences;
    window.localStorage.setItem(
      scopedPlayerStorageKey(PLAYER_PREFERENCES_STORAGE_KEY, preferenceScope),
      JSON.stringify(preferences),
    );
    playerPreferencesDirtyRef.current = true;
    const timeout = window.setTimeout(() => {
      void fetch("/api/preferences/player", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: preferences }),
      }).then((response) => {
        if (response.ok) playerPreferencesDirtyRef.current = false;
      }).catch(() => {
        playerPreferencesDirtyRef.current = true;
      });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [
    appearance,
    fullscreenAutoHideMs,
    hasLoadedPreferences,
    playbackRate,
    preferenceScope,
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
  }, [item?.id]);

  useEffect(() => {
    if (!chapters.length) {
      setIsChapterListOpen(false);
    }
  }, [chapters.length]);

  useEffect(() => {
    const dialog = chapterDialogRef.current;
    if (!dialog) return;
    if (isChapterListOpen && chapters.length) {
      setChapterPage(Math.max(0, Math.min(chapters.length - 5, activeChapterIndex - 2)));
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) dialog.close();
  }, [isChapterListOpen, chapters.length]);

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

  const revealFullscreenControls = useEventCallback((keepVisible = false) => {
    if (!isFullscreen) {
      return;
    }

    setIsFullscreenControlsVisible(true);
    clearFullscreenControlsTimer();

    if (keepVisible || !isPlaying || isChapterListOpen || isOptionsOpen || isShortcutHelpOpen || panelRef.current?.querySelector(".sleep-timer-popover[open]")) {
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
  }, [clearFullscreenControlsTimer, isChapterListOpen, isOptionsOpen, isShortcutHelpOpen, isFullscreen, isPlaying, revealFullscreenControls]);

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

      const capturedTime = currentTimeRef.current;
      const capturedListeningSeconds = snapshotListeningSeconds();
      const capturedCompletion = completionReachedRef.current;

      const previousCheckpoint = checkpointQueueRef.current;
      let releaseCheckpoint: () => void = () => {};
      checkpointQueueRef.current = new Promise<void>((resolve) => {
        releaseCheckpoint = resolve;
      });
      await previousCheckpoint;
      const isCurrent = () => targetItem.id === itemRef.current?.id && targetSession.id === sessionRef.current?.id;

      const duration = Math.max(
        resolveTimelineDuration(
          targetItem,
          targetSession?.audioTracks?.length ? targetSession.audioTracks : targetItem.media.tracks ?? [],
        ),
        1,
      );
      const now = Date.now();
      const nextTime = clampTime(isCurrent() ? currentTimeRef.current : capturedTime, duration);
      const timeListened = isCurrent() ? snapshotListeningSeconds() : capturedListeningSeconds;
      const isFinished = playbackFinished(nextTime, duration, isCurrent() ? completionReachedRef.current : capturedCompletion, Boolean(targetItem.userMediaProgress?.isFinished));

      if (!options?.silent) {
        setBusyAction("syncing");
        setPlayerError(null);
        setPlayerStatus(null);
      }

      if (isCurrent()) setProgressSaveNotice({ state: "saving", message: "Saving progress…", retryable: false });
      let failureStatus: number | undefined;
      try {
        const checkpointSequence = checkpointSequenceRef.current + 1;
        const sessionResponse = await fetch(`/api/session/${targetSession.id}/checkpoint`, {
          method: "POST",
          keepalive: mode === "close",
          signal: AbortSignal.timeout(15000),
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sequence: checkpointSequence,
            action: mode,
            currentTime: nextTime,
            timeListened,
            duration,
            progress: {
              itemId: targetItem.id,
              progress: isFinished ? 1 : duration > 0 ? nextTime / duration : 0,
              isFinished,
              finishedAt: isFinished ? now : null,
              startedAt: targetItem.userMediaProgress?.startedAt ?? targetSession?.startedAt ?? now,
            },
          }),
        });
        if (!sessionResponse.ok) failureStatus = sessionResponse.status;
        const sessionPayload = (await sessionResponse.json()) as {
          ok?: boolean;
          error?: string;
          session?: PlaybackSession | null;
        };

        if (!sessionResponse.ok) {
          failureStatus = sessionResponse.status;
          throw new Error(sessionPayload.error ?? "Unable to sync the Audiobookshelf session.");
        }

        checkpointSequenceRef.current = checkpointSequence;
        if (isCurrent()) {
          failedCheckpointRef.current = null;
          saveFailuresRef.current = 0;
          setProgressSaveNotice({ state: "saved", message: "Progress saved to Audiobookshelf.", retryable: false });
        }

        if (sessionPayload.session?.id && isCurrent()) {
          setSession(sessionPayload.session);
          sessionRef.current = sessionPayload.session;
        }

        if (isCurrent()) { resetListeningClock(); lastSyncedTimeRef.current = nextTime; }
        publishProgress(targetItem.id, { duration, currentTime: nextTime, progress: isFinished ? 1 : nextTime / duration, isFinished, startedAt: targetItem.userMediaProgress?.startedAt || targetSession.startedAt || now, finishedAt: isFinished ? now : null, lastUpdate: now });

        if (mode === "close" && isCurrent()) {
          setSession(null);
          sessionRef.current = null;
        }

        if (options?.refreshItem) {
          try { await onItemRefresh(targetItem.id); } catch { /* A refresh failure is not a failed save. */ }
        }

        return true;
      } catch (error) {
        if (isCurrent()) {
          const failure = progressSaveFailure(failureStatus);
          failedCheckpointRef.current = { itemId: targetItem.id, sessionId: targetSession.id, mode };
          saveFailuresRef.current++;
          setProgressSaveNotice({ state: "failed", ...failure });
        }
        return false;
      } finally {
        releaseCheckpoint();
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

      const parsedCues = parseSubtitle(body);

      if (!parsedCues.length) {
        throw new Error("That subtitle file did not contain any readable SRT or WebVTT cues.");
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
    setProgressSaveNotice(null);
    failedCheckpointRef.current = null;
    saveFailuresRef.current = 0;
    listenedSecondsRef.current = 0;
    listenWindowStartRef.current = null;

    const initialTime = item?.userMediaProgress?.currentTime ?? 0;
    currentTimeRef.current = initialTime;
    lastSyncedTimeRef.current = initialTime;
    setCurrentTime(initialTime);
    seekHistoryRef.current.clear();
    setUndoTime(null);
    setIsChapterListOpen(false);
    completionReachedRef.current = false;

    setSubtitleCues([]);
    setSubtitleError(null);
    const savedSubtitlePreference = item ? readBookSubtitlePreference(item.id, preferenceScope) : { offset: 0, serverFileId: "" };
    setSubtitleOffset(savedSubtitlePreference.offset);
    setSelectedServerSubtitleId(savedSubtitlePreference.serverFileId);
    setSubtitlePreferenceItemId(item?.id ?? null);
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

    const firstSubtitleFile =
      serverSubtitleFiles.find((file) => String(file.ino) === savedSubtitlePreference.serverFileId) ??
      serverSubtitleFiles[0];

    if (firstSubtitleFile) {
      setSubtitleSourceLabel(getLibraryFileLabel(firstSubtitleFile));
      setSubtitleStatus("Loading subtitle file...");
      void loadServerSubtitle(firstSubtitleFile);
      return;
    }

    setSubtitleSourceLabel("No subtitle file loaded");
    setSubtitleStatus(null);
  }, [exitFullscreenSafely, item?.id, preferenceScope, releaseWakeLock, subtitlePreferencesRevision]);

  useEffect(() => {
    if (!item?.id || subtitlePreferenceItemId !== item.id) return;
    writeBookSubtitlePreference(item.id, { offset: subtitleOffset, serverFileId: selectedServerSubtitleId }, preferenceScope);
    if (!hasLoadedSubtitlePreferences) return;
    subtitlePreferencesDirtyRef.current = true;
    const timeout = window.setTimeout(() => {
      void fetch("/api/preferences/subtitles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: readAllBookSubtitlePreferences(preferenceScope) }),
      }).then((response) => {
        if (response.ok) subtitlePreferencesDirtyRef.current = false;
      }).catch(() => {
        subtitlePreferencesDirtyRef.current = true;
      });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [hasLoadedSubtitlePreferences, item?.id, preferenceScope, selectedServerSubtitleId, subtitleOffset, subtitlePreferenceItemId]);

  useEffect(() => {
    const handleOnline = () => {
      if (playerPreferencesDirtyRef.current) {
        const raw = window.localStorage.getItem(scopedPlayerStorageKey(PLAYER_PREFERENCES_STORAGE_KEY, preferenceScope));
        if (raw) {
          void fetch("/api/preferences/player", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value: parseStoredPreferences(raw) }),
          }).then((response) => {
            if (response.ok) playerPreferencesDirtyRef.current = false;
          }).catch(() => undefined);
        }
      }
      if (subtitlePreferencesDirtyRef.current) {
        void fetch("/api/preferences/subtitles", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: readAllBookSubtitlePreferences(preferenceScope) }),
        }).then((response) => {
          if (response.ok) subtitlePreferencesDirtyRef.current = false;
        }).catch(() => undefined);
      }
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [preferenceScope]);

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
    if (!progressSaveNotice) return;
    if (progressSaveNotice.state === "saved") {
      const timeout = window.setTimeout(() => setProgressSaveNotice(null), 5000);
      return () => window.clearTimeout(timeout);
    }
    if (progressSaveNotice.state !== "failed" || !progressSaveNotice.retryable) return;
    const retry = () => {
      const failed = failedCheckpointRef.current;
      if (failed && failed.itemId === itemRef.current?.id && failed.sessionId === sessionRef.current?.id) void syncToAudiobookshelf(failed.mode, { silent: true });
    };
    const timeout = window.setTimeout(retry, progressRetryDelay(saveFailuresRef.current));
    window.addEventListener("online", retry);
    return () => { window.clearTimeout(timeout); window.removeEventListener("online", retry); };
  }, [progressSaveNotice, syncToAudiobookshelf]);

  useEffect(() => {
    if (!session?.id) {
      return;
    }

    const interval = window.setInterval(() => {
      if (!isPlayingRef.current || failedCheckpointRef.current) {
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
      const parsedCues = parseSubtitle(body);

      if (!parsedCues.length) {
        throw new Error("That subtitle file did not contain any readable SRT or WebVTT cues.");
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
    const next = clampTime(nextTime, totalDurationRef.current);
    seekHistoryRef.current.remember(currentTimeRef.current, next);
    setUndoTime(seekHistoryRef.current.target());
    queueTrackLoad(next, Boolean(sessionRef.current) && isPlayingRef.current);
  }

  function handleRelativeSeek(delta: number) {
    seekHistoryRef.current.end();
    handleSeek(currentTimeRef.current + delta);
  }

  function handleChapterJump(chapter: Chapter, index: number) {
    seekHistoryRef.current.end();
    handleSeek(chapter.start);
    setIsChapterListOpen(false);
    setPlayerStatus(`Jumped to ${getChapterTitle(chapter, index)}.`);
  }

  function undoLastJump() {
    const target = seekHistoryRef.current.undo();
    setUndoTime(null);
    if (target !== null) queueTrackLoad(target, Boolean(sessionRef.current) && isPlayingRef.current);
    revealFullscreenControls();
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

    const nextTime = track.startOffset + audio.currentTime;
    if (!audio.paused && !audio.seeking && playbackFinished(nextTime, totalDurationRef.current, true)) completionReachedRef.current = true;
    updatePlayhead(nextTime);
  }

  function handlePlay() {
    const current = itemRef.current;
    if (current) publishProgress(current.id, { ...current.userMediaProgress, duration: totalDurationRef.current, currentTime: currentTimeRef.current, progress: currentTimeRef.current / Math.max(totalDurationRef.current, 1), isFinished: Boolean(current.userMediaProgress?.isFinished), startedAt: current.userMediaProgress?.startedAt || Date.now(), lastUpdate: Date.now() });
    setIsPlaying(true);
    resumeListeningClock();
    void requestWakeLock();
    void syncToAudiobookshelf("sync", { silent: true });
  }

  function handlePause() {
    setIsPlaying(false);
    pauseListeningClock();
    void releaseWakeLock();
    void syncToAudiobookshelf("sync", { silent: true });
  }

  function handleEnded() {
    const trackList = tracksRef.current;
    const trackIndex = getTrackIndexAtTime(trackList, currentTimeRef.current);

    if (trackIndex >= 0 && trackIndex < trackList.length - 1) {
      queueTrackLoad(trackList[trackIndex + 1].startOffset, true, trackList);
      return;
    }

    completionReachedRef.current = true;
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

  function handleSubtitleLineHeightChange(nextValue: SubtitleLineHeight) {
    setSubtitleLineHeight(nextValue);
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

    revealFullscreenControls();
  }

  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }

      const target = event.target;

      if (target instanceof HTMLElement) {
        const tagName = target.tagName;

        if (
          target.isContentEditable ||
          tagName === "BUTTON" ||
          tagName === "A" ||
          tagName === "INPUT" ||
          tagName === "TEXTAREA" ||
          tagName === "SELECT"
        ) {
          return;
        }
      }

      const key = event.key.toLowerCase();
      let handled = true;

      if (event.code === "Space" || key === "k") {
        void handlePrimaryTransport();
      } else if (key === "j") {
        handleRelativeSeek(-10);
      } else if (key === "l") {
        handleRelativeSeek(10);
      } else if (event.key === "ArrowLeft" && event.shiftKey) {
        handleChapterStep("previous");
      } else if (event.key === "ArrowRight" && event.shiftKey) {
        handleChapterStep("next");
      } else if (event.key === "ArrowLeft") {
        handleRelativeSeek(-15);
      } else if (event.key === "ArrowRight") {
        handleRelativeSeek(30);
      } else if (key === "m") {
        setVolume((current) => (current > 0 ? 0 : 1));
      } else if (key === "f") {
        void toggleFullscreen();
      } else if (event.key === "?") {
        setIsOptionsOpen(true);
        setIsShortcutHelpOpen((current) => !current);
      } else if (event.key === "Escape" && isShortcutHelpOpen) {
        setIsShortcutHelpOpen(false);
      } else {
        handled = false;
      }

      if (handled) {
        event.preventDefault();
        revealFullscreenControls(true);
      }
    };

    window.addEventListener("keydown", handleWindowKeyDown);

    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  });

  function renderSubtitleTools() {
    return <>
      <label className="player-option-row"><span>Timing offset</span><span className="player-option-input"><input aria-label="Subtitle timing offset" type="number" min={-8} max={8} step={0.1} value={subtitleOffset} onChange={event => setSubtitleOffset(Math.max(-8, Math.min(8, Number(event.target.value))))} /><span className="player-option-value">seconds</span></span></label>
      <label className="player-option-row"><span>Subtitle file</span><select aria-label="Subtitle file" value={selectedServerSubtitleId} onChange={event => {
        if (event.target.value === "upload") { subtitleUploadRef.current?.click(); return; }
        const file = serverSubtitleFiles.find(entry => String(entry.ino) === event.target.value);
        if (file) void loadServerSubtitle(file);
      }}><option value="">{selectedServerSubtitleId ? "Choose subtitles" : subtitleSourceLabel}</option>{serverSubtitleFiles.map(file => <option key={String(file.ino)} value={String(file.ino)}>{getLibraryFileLabel(file)}</option>)}<option value="upload">Upload .srt or .vtt…</option></select></label>
    </>;
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
    const promptBody = hasLoadedSubtitles
        ? "Your subtitle file is ready. Start playback and the active line will appear here."
        : serverSubtitleFiles.length
          ? "We found subtitle files in Audiobookshelf, but none are loaded yet. Open subtitle options to choose one."
          : "No subtitle file is loaded yet. Open subtitle options to pick an Audiobookshelf subtitle or upload your own .srt or .vtt file.";

    return (
      <article className="subtitle-prompt-card">
        <div>
          <p className="subtitle-prompt-title">{promptTitle}</p>
          <p className="subtitle-prompt-copy">{promptBody}</p>
        </div>

        {(
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
                Upload subtitles
              </button>
            ) : null}
          </div>
        )}
      </article>
    );
  }

  function renderSubtitleStage() {
    return <section className="subtitle-stage" style={subtitleStageStyle}>
      <article ref={subtitleCardRef} className={`subtitle-card subtitle-card-contrast-${subtitleContrast} ${hasLoadedSubtitles ? "" : "subtitle-card-empty"}`}>
        {hasLoadedSubtitles && !shouldShowLoadedSubtitlePrompt ? <div ref={subtitleLinesRef} className="subtitle-lines">
          {appearance.showPreviousSubtitle ? <p className="subtitle-previous" aria-hidden="true">{previousSubtitleCue?.text || "\u00A0"}</p> : null}
          <p aria-live="polite" aria-atomic="true" className="subtitle-active">{activeSubtitleText || "\u00A0"}</p>
        </div> : renderSubtitlePrompt()}
      </article>
    </section>;
  }

  function changeAppearance<K extends keyof PlayerAppearance>(key: K, value: PlayerAppearance[K]) {
    setAppearance(current => ({ ...current, [key]: value }));
    revealFullscreenControls(true);
  }

  function renderSubtitleDisplayOptions() {
    return <>
      <p className="player-option-group-label">Subtitles</p>
      <label className="player-option-row"><span>Font</span><select aria-label="Font" value={appearance.subtitleFont} onChange={event => changeAppearance("subtitleFont", event.target.value as PlayerAppearance["subtitleFont"])}><option value="default">Default</option><option value="georgia">Georgia</option><option value="verdana">Verdana</option><option value="trebuchet">Trebuchet MS</option><option value="times">Times New Roman</option></select></label>
      <label className="player-option-row"><span>Horizontal alignment</span><select aria-label="Horizontal alignment" value={appearance.subtitleAlignment} onChange={event => changeAppearance("subtitleAlignment", event.target.value as PlayerAppearance["subtitleAlignment"])}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
      <label className="player-option-row"><span>Vertical alignment</span><select aria-label="Vertical alignment" value={appearance.subtitleVerticalAlignment} onChange={event => changeAppearance("subtitleVerticalAlignment", event.target.value as PlayerAppearance["subtitleVerticalAlignment"])}><option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option></select></label>
      <label className="player-option-row"><span>Fullscreen text size</span><select aria-label="Fullscreen text size" value={appearance.subtitleSizeMode} onChange={event => changeAppearance("subtitleSizeMode", event.target.value as PlayerAppearance["subtitleSizeMode"])}><option value="manual">Custom size</option><option value="fill">Fill screen</option></select></label>
      <label className="player-option-row"><span>Text size</span><span className="player-option-input"><input aria-label="Subtitle text size" type="range" min={22} max={120} value={appearance.subtitleSize} onChange={event => changeAppearance("subtitleSize", Number(event.target.value))} /><span className="player-option-value">{appearance.subtitleSize}px</span></span></label>
      <label className="player-option-row player-option-toggle"><span>Show previous line</span><input type="checkbox" checked={appearance.showPreviousSubtitle} onChange={event => changeAppearance("showPreviousSubtitle", event.target.checked)} /></label>
    </>;
  }

  function renderPlayerOptions() {
    return <section className="player-options-panel" aria-label="Player options" onClick={event => event.stopPropagation()}>
      <div className="player-options-heading"><h3>Player options</h3><button className="player-icon-control" aria-label="Close player options" type="button" onClick={() => setIsOptionsOpen(false)}><PlayerIcon name="close" /></button></div>
      {renderSubtitleDisplayOptions()}{renderSubtitleTools()}
      <label className="player-option-row player-option-background"><span>Fullscreen background</span><select aria-label="Fullscreen background" value={appearance.fullscreenBackground} onChange={event => changeAppearance("fullscreenBackground", event.target.value as PlayerAppearance["fullscreenBackground"])}><option value="default">Default</option><option value="black">Black</option><option value="custom">Custom color</option><option value="cover">Cover art</option></select></label>
      {appearance.fullscreenBackground === "custom" ? <label className="player-option-row"><span>Custom color</span><span className="player-option-input"><input aria-label="Fullscreen custom color" type="color" value={appearance.fullscreenCustomColor} onChange={event => changeAppearance("fullscreenCustomColor", event.target.value)} /><span className="player-option-value">{appearance.fullscreenCustomColor.toUpperCase()}</span></span></label> : null}
      <div className="player-option-actions">
        <button type="button" disabled={busyAction === "syncing" || !hasActiveSession} onClick={() => void syncToAudiobookshelf("sync", { refreshItem: true })}><PlayerIcon name="sync" />Force sync</button>
        <button type="button" disabled={busyAction === "refreshing"} onClick={() => void pullLatestServerProgress()}><PlayerIcon name="pull" />Pull server progress</button>
        <button type="button" onClick={openPopout}><PlayerIcon name="popup" />Pop out player</button>
        <button type="button" onClick={() => setIsShortcutHelpOpen(current => !current)}><PlayerIcon name="keyboard" />Keyboard shortcuts</button>
      </div>
      <details className="player-extra-options"><summary>More settings</summary>
        <label className="player-option-row"><span>Line height</span><select aria-label="Line height" value={subtitleLineHeight} onChange={event => handleSubtitleLineHeightChange(event.target.value as SubtitleLineHeight)}><option value="tight">Tight</option><option value="standard">Standard</option><option value="relaxed">Relaxed</option></select></label>
        <label className="player-option-row"><span>Contrast</span><select aria-label="Contrast" value={subtitleContrast} onChange={event => handleSubtitleContrastChange(event.target.value as SubtitleContrast)}><option value="solid">Solid</option><option value="soft">Soft</option><option value="glow">Glow</option></select></label>
        <label className="player-option-row"><span>Auto-hide delay</span><select aria-label="Auto-hide delay" value={fullscreenAutoHideMs} onChange={event => handleFullscreenAutoHideChange(Number(event.target.value) as FullscreenAutoHide)}><option value={1500}>1.5s</option><option value={2500}>2.5s</option><option value={4000}>4s</option><option value={6000}>6s</option></select></label>
        <button className="player-text-action" type="button" disabled={busyAction === "starting"} onClick={() => void startPlayback(true)}>Restart playback</button>
      </details>
      {isShortcutHelpOpen ? <section className="shortcut-help-panel" aria-label="Keyboard shortcuts"><p><kbd>Space</kbd>/<kbd>K</kbd> play or pause · <kbd>J</kbd>/<kbd>L</kbd> skip 10s</p><p><kbd>←</kbd>/<kbd>→</kbd> back 15s/forward 30s · <kbd>Shift</kbd> + arrows change chapter</p><p><kbd>M</kbd> mute · <kbd>F</kbd> full screen · <kbd>?</kbd> help</p></section> : null}
    </section>;
  }

  function renderTransport() {
    const volumePercent = Math.round(volume * 100);
    const fullscreenLabel = isFullscreen ? "Exit fullscreen" : "Enter fullscreen";
    return <section ref={transportRef} className="transport reading-focus-transport" aria-label="Playback controls" onFocus={() => revealFullscreenControls(true)} onBlur={event => {
      if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) revealFullscreenControls();
    }}>
      <div className="player-control-meta">
        <div className="player-control-book"><img alt="" src={`/api/items/${item?.id}/cover`} /><div><strong>{item?.media.metadata.title}</strong><p>{item?.media.metadata.authorName ?? "Unknown author"}{item?.media.metadata.narratorName ? ` · ${item.media.metadata.narratorName}` : ""}</p></div></div>
        <div className="player-volume-fullscreen"><label className="player-main-volume"><span>Volume</span><input aria-label="Player volume" type="range" min={0} max={1} step={0.01} value={volume} onChange={event => handleVolumeChange(Number(event.target.value))} /><output>{volumePercent}%</output></label><button type="button" className="player-icon-control" aria-label={fullscreenLabel} title={fullscreenLabel} onClick={() => void toggleFullscreen()}><PlayerIcon name={isFullscreen ? "exit" : "fullscreen"} /></button></div>
      </div>
      <div className="player-timeline">
        <span className="player-time-label">{formatTime(currentTime)}</span>
        <div className="player-timeline-track"><input aria-label={`Playback position, ${formatTime(currentTime)} of ${formatTime(totalDuration)}`} className="progress-slider" type="range" min={0} max={Math.max(totalDuration, 1)} step={0.1} value={Math.min(currentTime, Math.max(totalDuration, 1))}
          onPointerDown={() => seekHistoryRef.current.begin(currentTimeRef.current)} onPointerUp={() => seekHistoryRef.current.end()} onPointerCancel={() => seekHistoryRef.current.end()} onBlur={() => seekHistoryRef.current.end()}
          onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) seekHistoryRef.current.begin(currentTimeRef.current); }} onKeyUp={() => seekHistoryRef.current.end()}
          onChange={event => { handleSeek(Number(event.target.value)); revealFullscreenControls(); }} />
          <div className="player-chapter-markers" aria-hidden="true">{timelineMarkers.map(marker => <span key={marker.index} style={{ left: `${marker.percent}%` }} title={getChapterTitle(chapters[marker.index]!, marker.index)} />)}</div>
        </div>
        <button className="player-time-label player-time-toggle" type="button" onClick={() => setTimeDisplayMode(current => current === "remaining" ? "total" : "remaining")} aria-label={timeDisplayMode === "remaining" ? "Show total time" : "Show remaining time"} title={timeDisplayMode === "remaining" ? "Remaining time · click for total" : "Total time · click for remaining"}>{timeDisplayMode === "remaining" ? `−${formatTime(Math.max(totalDuration - currentTime, 0))}` : formatTime(totalDuration)}</button>
      </div>
      <div className="player-control-row">
        <button className="player-chapter-trigger" type="button" disabled={!chapters.length} aria-haspopup="dialog" aria-expanded={isChapterListOpen} onClick={() => { setIsChapterListOpen(true); revealFullscreenControls(true); }}><PlayerIcon name="chapters" /><span>{activeChapter ? getChapterTitle(activeChapter, activeChapterIndex) : "Chapters"}</span><PlayerIcon name="right" /></button>
        <div className="player-main-controls">
          <button className="player-icon-control player-skip-control" type="button" aria-label="Back 15 seconds" title="Back 15 seconds" onClick={() => handleRelativeSeek(-15)}><PlayerIcon name="back" /><span>15</span></button>
          <button className="player-play-control" type="button" disabled={busyAction === "starting"} aria-label={busyAction === "starting" ? "Starting playback" : isPlaying ? "Pause playback" : "Resume playback"} onClick={() => { void handlePrimaryTransport(); revealFullscreenControls(); }}><PlayerIcon name={isPlaying ? "pause" : "play"} /></button>
          <button className="player-icon-control player-skip-control" type="button" aria-label="Forward 30 seconds" title="Forward 30 seconds" onClick={() => handleRelativeSeek(30)}><PlayerIcon name="forward" /><span>30</span></button>
        </div>
        <div className="player-secondary-controls">
          <select className="player-speed-select" aria-label="Playback speed" value={playbackRate} onChange={event => handlePlaybackRateChange(Number(event.target.value))}>{[0.8, 1, 1.15, 1.25, 1.4, 1.5, 1.75, 2].map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select>
          <details className="sleep-timer-popover" onToggle={event => { if (event.currentTarget.open) revealFullscreenControls(true); else revealFullscreenControls(); }}><summary aria-label="Sleep timer"><PlayerIcon name="moon" /><output>{sleepTimer.selection === "off" ? "Off" : formatSleepTimer(sleepTimer.remainingSeconds)}</output></summary><div className="sleep-timer-panel" aria-label="Sleep timer choices"><div className="sleep-timer-options">{([["off", "Off"], [15, "15m"], [30, "30m"], [45, "45m"], [60, "60m"], ["chapter", "Chapter"]] as Array<[SleepTimerSelection, string]>).map(([value, label]) => <button key={String(value)} type="button" disabled={value === "chapter" && !activeChapter} aria-pressed={sleepTimer.selection === value} className={`sleep-timer-option ${sleepTimer.selection === value ? "sleep-timer-option-active" : ""}`} onClick={event => { sleepTimer.setSelection(value); event.currentTarget.closest("details")?.removeAttribute("open"); }}>{label}</button>)}</div></div></details>
          <button className="player-icon-control" type="button" aria-label={undoTime === null ? "Undo last jump" : `Undo jump to return to ${formatTime(undoTime)}`} title={undoTime === null ? "Undo last jump" : `Return to ${formatTime(undoTime)}`} disabled={undoTime === null} onClick={undoLastJump}><PlayerIcon name="undo" /></button>
          <button className="player-icon-control" type="button" aria-label="Player options" aria-expanded={isOptionsOpen} onClick={() => { setIsOptionsOpen(current => !current); revealFullscreenControls(true); }}><PlayerIcon name="options" /></button>
        </div>
      </div>
      {isOptionsOpen ? renderPlayerOptions() : null}
      {isFullscreen ? renderFooterMeta() : null}
    </section>;
  }

  function renderChapterDialog() {
    return <dialog className="player-chapter-dialog" ref={chapterDialogRef} aria-label="Choose a chapter" onCancel={() => setIsChapterListOpen(false)} onClose={() => setIsChapterListOpen(false)} onClick={event => { if (event.target === event.currentTarget) setIsChapterListOpen(false); }}>
      <div className="player-chapter-dialog-body"><header><h3>Chapters <small>{chapters.length} chapters</small></h3><button className="player-icon-control" type="button" aria-label="Close chapter list" onClick={() => setIsChapterListOpen(false)}><PlayerIcon name="close" /></button></header>
      <div className="player-chapter-dialog-list">{chapters.slice(chapterPage, chapterPage + 5).map((chapter, localIndex) => { const index = chapterPage + localIndex; return <button key={chapter.id ?? index} className="player-chapter-choice" type="button" aria-current={index === activeChapterIndex ? "true" : undefined} onClick={() => handleChapterJump(chapter, index)}><span>{index + 1}</span><span>{getChapterTitle(chapter, index)}</span><time>{formatTime(chapter.start)}</time></button>; })}</div>
      <footer><button type="button" disabled={chapterPage === 0} onClick={() => setChapterPage(page => Math.max(0, page - 5))}><PlayerIcon name="left" />Previous</button><button type="button" disabled={chapterPage + 5 >= chapters.length} onClick={() => setChapterPage(page => Math.min(Math.max(0, chapters.length - 5), page + 5))}>Next<PlayerIcon name="right" /></button></footer></div>
    </dialog>;
  }

  function renderFooterMeta() {
    const shouldShowSubtitleMeta = shouldShowLyricsStage;
    const footerNotice = playerError ?? subtitleError ?? playerStatus ?? subtitleStatus;
    const footerNoticeIsError = Boolean(playerError || subtitleError);
    const progressSaveError = progressSaveNotice?.state === "failed" ? progressSaveNotice : null;

    if (!shouldShowSubtitleMeta && !footerNotice && !progressSaveError && !(isDock && onHide)) {
      return null;
    }

    return (
      <section className="player-footer">
        {progressSaveError ? <div className="progress-save-feedback progress-save-feedback-failed" role="status" aria-live="polite">
          <span>{progressSaveError.message}</span>
          {progressSaveError.retryable ? <button className="button book-action-secondary button-compact" onClick={() => { const failed = failedCheckpointRef.current; if (failed) void syncToAudiobookshelf(failed.mode, { silent: true }); }} type="button">Retry now</button> : null}
        </div> : null}
        <div className={`player-footer-row ${shouldShowSubtitleMeta ? "" : "player-footer-row-end"}`.trim()}>
          {footerNotice || shouldShowSubtitleMeta ? (
            <div className="player-footer-notice" aria-live="polite">
              {footerNotice ? (
                <p role={footerNoticeIsError ? "alert" : "status"} className={`status-message ${footerNoticeIsError ? "status-error" : ""}`.trim()}>
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
      style={isFullscreen ? ({ "--fullscreen-player-bg": appearance.fullscreenBackground === "black" ? "#000" : appearance.fullscreenBackground === "custom" ? appearance.fullscreenCustomColor : "var(--fullscreen-bg)", "--fullscreen-subtitle-ink": appearance.fullscreenBackground === "custom" && useDarkSubtitleText(appearance.fullscreenCustomColor) ? "#1b1016" : "#f4eeee", "--fullscreen-subtitle-muted": appearance.fullscreenBackground === "custom" && useDarkSubtitleText(appearance.fullscreenCustomColor) ? "#4a303b" : "#baaab0" }) as CSSProperties : undefined}
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
      {isFullscreen && appearance.fullscreenBackground === "cover" ? <div className="player-cover-background" aria-hidden="true"><img alt="" src={`/api/items/${item.id}/cover`} /></div> : null}
      <audio
        onEnded={handleEnded}
        onLoadedMetadata={handleLoadedMetadata}
        onPause={handlePause}
        onPlay={handlePlay}
        onTimeUpdate={handleTimeUpdate}
        preload="metadata"
        ref={audioRef}
      />
      <input hidden accept=".srt,.vtt,text/vtt" onChange={handleManualSubtitleUpload} ref={subtitleUploadRef} type="file" />

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
            inert={!shouldShowFullscreenControls}
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

      {renderChapterDialog()}
    </section>
  );
}
