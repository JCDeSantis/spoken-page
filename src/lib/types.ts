export type Library = {
  id: string;
  name: string;
  icon: string;
  mediaType: "book" | "podcast";
};

export type LibraryItemMetadata = {
  title: string;
  subtitle?: string | null;
  authorName?: string | null;
  narratorName?: string | null;
  seriesName?: string | null;
  description?: string | null;
  publishedYear?: string | null;
  genres?: string[];
  language?: string | null;
};

export type LibraryFilterEntity = {
  id: string;
  name: string;
};

export type LibraryFilterData = {
  authors: LibraryFilterEntity[];
  genres: string[];
  tags: string[];
  series: LibraryFilterEntity[];
  narrators: string[];
  languages: string[];
};

export type AudioTrack = {
  index: number;
  startOffset: number;
  duration: number;
  title: string;
  contentUrl: string;
  mimeType: string;
  metadata?: {
    filename?: string;
    ext?: string;
    path?: string;
    relPath?: string;
  };
};

export type Chapter = {
  id?: number | string;
  start: number;
  end: number;
  title: string;
};

export type LibraryFileMetadata = {
  filename?: string;
  ext?: string;
  path?: string;
  relPath?: string;
};

export type LibraryFile = {
  ino: number | string;
  metadata?: LibraryFileMetadata;
  fileType?: string;
  isSupplementary?: boolean;
};

export type MediaProgress = {
  id?: string;
  duration: number;
  progress: number;
  currentTime: number;
  isFinished: boolean;
  hideFromContinueListening?: boolean;
  lastUpdate?: number;
  startedAt?: number;
  finishedAt?: number | null;
};

export type LibraryItemMinified = {
  id: string;
  libraryId: string;
  mediaType: "book" | "podcast";
  media: {
    metadata: LibraryItemMetadata;
    tags?: string[];
    duration: number;
    coverPath?: string | null;
    numTracks?: number;
    numAudioFiles?: number;
    numChapters?: number;
  };
  userMediaProgress?: MediaProgress;
};

export type LibraryItemExpanded = LibraryItemMinified & {
  libraryFiles?: LibraryFile[];
  media: LibraryItemMinified["media"] & {
    tracks?: AudioTrack[];
    chapters?: Chapter[];
  };
};

export type PlaybackSession = {
  id: string;
  currentTime: number;
  startTime: number;
  timeListening: number;
  startedAt: number;
  updatedAt: number;
  audioTracks: AudioTrack[];
  libraryItem: LibraryItemExpanded;
};

export type AuthorizedSummary = {
  username: string;
  userType: string;
  serverVersion: string;
  userDefaultLibraryId?: string;
};

export type LibraryListResponse = {
  libraries: Library[];
};

export type LibraryItemsResponse = {
  results: LibraryItemMinified[];
  total: number;
  page: number;
  limit: number;
};

export type SubtitleCue = {
  id: string;
  start: number;
  end: number;
  text: string;
};
