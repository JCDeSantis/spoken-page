"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLibrarySearch } from "@/components/library/use-library-search";
import { migrateLibraryPreferences, type LibraryPreferences } from "@/lib/library-preferences";
import { listeningState, type ProgressAction } from "@/lib/listening-status";
import { changeListeningProgress, PROGRESS_EVENT } from "@/lib/progress-client";
import { parseLibraryQuery } from "@/lib/library-query";
import { hasBrowseQuery, restoreBrowsePreferences } from "@/lib/browse-preferences";
import { bookSeries } from "@/lib/series";
import type { MediaProgress } from "@/lib/types";
import { PlayerPanel } from "@/components/player-panel";
import { BookDetails } from "@/components/library/book-details";
import { BookTile } from "@/components/library/book-tile";
import {
  formatDuration,
  libraryItemsById,
  BookProgressStatus,
  BookStatusOverrides,
  LibrarySort,
  ProgressFilter,
  stripSeriesSuffix,
  unloadedShelfIds,
} from "@/components/library/library-utils";
import {
  AuthorizedSummary,
  Library,
  LibraryFilterData,
  LibraryItemExpanded,
  LibraryItemMinified,
} from "@/lib/types";

const FAVORITES_STORAGE_KEY = "spoken-page-favorites";
const PLAYED_RECENTS_STORAGE_KEY = "spoken-page-played-recents";
const HIDDEN_RECENTS_STORAGE_KEY = "spoken-page-hidden-recents";
const QUEUE_STORAGE_KEY = "spoken-page-queue";
const STATUS_OVERRIDES_STORAGE_KEY = "spoken-page-status-overrides";
const LIBRARY_PREFERENCES_STORAGE_KEY = "spoken-page-library-v2";

function userStorageKey(base: string, userId: string) {
  return `${base}:${encodeURIComponent(userId)}`;
}

const EMPTY_BROWSE_FILTERS = {
  genre: "",
  tag: "",
  author: "",
  narrator: "",
  series: "",
  language: "",
};

type BrowseFilters = typeof EMPTY_BROWSE_FILTERS;
type BrowseFilterKey = keyof BrowseFilters;

type DashboardProps = {
  initialLibraries: Library[];
  initialProfile: AuthorizedSummary;
};

function parseStoredIds(value: string | null) {
  if (!value) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

function parseStatusOverrides(value: unknown): BookStatusOverrides {
  if (typeof value === "string") {
    try {
      return parseStatusOverrides(JSON.parse(value) as unknown);
    } catch {
      return {};
    }
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, BookProgressStatus] =>
        entry[1] === "planned" || entry[1] === "unstarted" || entry[1] === "in-progress" || entry[1] === "finished",
    ),
  );
}

function normalizeValue(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function compareByLabel(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function collectNames(value: string | null | undefined) {
  if (!value) {
    return [] as string[];
  }

  return value
    .split(/,|;|\/| & /g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function matchesDelimitedValue(value: string | null | undefined, selected: string) {
  if (!selected) {
    return true;
  }

  const normalizedSelected = normalizeValue(selected);
  const normalizedValue = normalizeValue(value);

  if (!normalizedValue) {
    return false;
  }

  if (normalizedValue === normalizedSelected) {
    return true;
  }

  return collectNames(value).some((entry) => normalizeValue(entry) === normalizedSelected);
}

function getSeriesFilterKey(value: string | null | undefined) {
  return normalizeValue(stripSeriesSuffix(value));
}

function matchesSeriesValue(value: string | null | undefined, selected: string) {
  if (!selected) {
    return true;
  }

  const normalizedValue = normalizeValue(value);
  const normalizedSelected = normalizeValue(selected);

  if (!normalizedValue) {
    return false;
  }

  if (normalizedValue === normalizedSelected) {
    return true;
  }

  return getSeriesFilterKey(value) === getSeriesFilterKey(selected);
}

function normalizeSeriesOptions(entries: LibraryFilterData["series"]) {
  const deduped = new Map<string, LibraryFilterData["series"][number]>();

  for (const entry of entries) {
    const canonicalName = entry.name.trim();
    const canonicalId = normalizeValue(canonicalName) || normalizeValue(entry.id);

    if (!canonicalName || !canonicalId || deduped.has(canonicalId)) {
      continue;
    }

    deduped.set(canonicalId, {
      id: canonicalId,
      name: canonicalName,
    });
  }

  return [...deduped.values()].sort((left, right) => compareByLabel(left.name, right.name));
}

function deriveFilterData(items: LibraryItemMinified[]) {
  const authors = new Map<string, string>();
  const series = new Map<string, string>();
  const genres = new Map<string, string>();
  const tags = new Map<string, string>();
  const narrators = new Map<string, string>();
  const languages = new Map<string, string>();

  for (const entry of items) {
    for (const author of collectNames(entry.media.metadata.authorName)) {
      authors.set(normalizeValue(author), author);
    }

    for (const narrator of collectNames(entry.media.metadata.narratorName)) {
      narrators.set(normalizeValue(narrator), narrator);
    }

    for (const membership of bookSeries(entry.media.metadata)) {
      const canonicalSeriesName = membership.name;
      const canonicalSeriesKey = normalizeValue(canonicalSeriesName);

      if (canonicalSeriesName && canonicalSeriesKey) {
        series.set(canonicalSeriesKey, canonicalSeriesName);
      }
    }

    for (const genre of entry.media.metadata.genres ?? []) {
      const trimmed = genre.trim();
      if (trimmed) {
        genres.set(normalizeValue(trimmed), trimmed);
      }
    }

    for (const tag of entry.media.tags ?? []) {
      const trimmed = tag.trim();
      if (trimmed) {
        tags.set(normalizeValue(trimmed), trimmed);
      }
    }

    const language = entry.media.metadata.language?.trim();
    if (language) {
      languages.set(normalizeValue(language), language);
    }
  }

  return {
    authors: [...authors.entries()]
      .sort((left, right) => compareByLabel(left[1], right[1]))
      .map(([id, name]) => ({ id, name })),
    genres: [...genres.values()].sort(compareByLabel),
    tags: [...tags.values()].sort(compareByLabel),
    series: [...series.entries()]
      .sort((left, right) => compareByLabel(left[1], right[1]))
      .map(([id, name]) => ({ id, name })),
    narrators: [...narrators.values()].sort(compareByLabel),
    languages: [...languages.values()].sort(compareByLabel),
  } satisfies LibraryFilterData;
}

function normalizeFilterData(payload: Partial<LibraryFilterData> | null | undefined) {
  return {
    authors: (payload?.authors ?? []).filter(
      (entry): entry is LibraryFilterData["authors"][number] =>
        Boolean(entry && typeof entry.id === "string" && typeof entry.name === "string"),
    ),
    genres: (payload?.genres ?? []).filter((entry): entry is string => typeof entry === "string"),
    tags: (payload?.tags ?? []).filter((entry): entry is string => typeof entry === "string"),
    series: normalizeSeriesOptions(
      (payload?.series ?? []).filter(
        (entry): entry is LibraryFilterData["series"][number] =>
          Boolean(entry && typeof entry.id === "string" && typeof entry.name === "string"),
      ),
    ),
    narrators: (payload?.narrators ?? []).filter((entry): entry is string => typeof entry === "string"),
    languages: (payload?.languages ?? []).filter((entry): entry is string => typeof entry === "string"),
  } satisfies LibraryFilterData;
}

export function Dashboard({ initialLibraries, initialProfile }: DashboardProps) {
  const [libraries, setLibraries] = useState(initialLibraries);
  const [profile] = useState(initialProfile);
  const [activeLibraryId, setActiveLibraryId] = useState(
    initialProfile.userDefaultLibraryId ?? initialLibraries[0]?.id ?? "",
  );



  const [selectedItemId, setSelectedItemId] = useState<string>("");
  const [selectedItem, setSelectedItem] = useState<LibraryItemExpanded | null>(null);
  const [itemState, setItemState] = useState<"idle" | "loading" | "error">("idle");
  const [itemError, setItemError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<LibrarySort>("title");
  const [progressFilter, setProgressFilter] = useState<ProgressFilter>("all");
  const [browseFilters, setBrowseFilters] = useState<BrowseFilters>({ ...EMPTY_BROWSE_FILTERS });
  const [libraryFilterData, setLibraryFilterData] = useState<LibraryFilterData | null>(null);
  const [libraryFilterState, setLibraryFilterState] = useState<"idle" | "loading" | "error">("idle");
  const [libraryFilterError, setLibraryFilterError] = useState<string | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [showAllPins, setShowAllPins] = useState(false);
  const [completingItemId, setCompletingItemId] = useState("");
  const [continueError, setContinueError] = useState<string | null>(null);
  const [playedRecentIds, setPlayedRecentIds] = useState<string[]>([]);
  const [hiddenRecentIds, setHiddenRecentIds] = useState<string[]>([]);
  const [isBookDetailsOpen, setIsBookDetailsOpen] = useState(false);
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);
  const [isPlayerInlineFullscreen, setIsPlayerInlineFullscreen] = useState(false);
  const [playerOpenToken, setPlayerOpenToken] = useState(0);
  const [queueIds, setQueueIds] = useState<string[]>([]);
  const [preferencesHydrated, setPreferencesHydrated] = useState(false);
  const [planning, setPlanning] = useState<LibraryPreferences>(() => migrateLibraryPreferences(null));
  const [wantFilter, setWantFilter] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [urlReady, setUrlReady] = useState(false);
  const browseSaveQueueRef = useRef(Promise.resolve());
  const browseWritableRef = useRef(false);
  const [browseSaveError, setBrowseSaveError] = useState<string | null>(null);
  const [direction, setDirection] = useState("asc");
  const preferenceScope = profile.preferenceScope ?? profile.userId;
  const queryParams = new URLSearchParams({ q: filter, sort, direction, status: progressFilter === "planned" ? "all" : progressFilter, want: String(wantFilter), hideCompleted: String(hideCompleted), ...browseFilters });
  const queryString = queryParams.toString();
  const search = useLibrarySearch(activeLibraryId, queryString, urlReady && preferencesHydrated);
  const { items, setItems, page: itemsPage, state: itemsState, error: itemsError, loadedLibrary: itemsLibraryId } = search;
  const loadMoreItems = search.loadMore;
  const loadItems = (_libraryId: string) => search.refresh(true);


  const [shelfItemsById, setShelfItemsById] = useState<Record<string, LibraryItemMinified>>({});
  const [resolvedShelfIds, setResolvedShelfIds] = useState<Set<string>>(() => new Set());

  const requestedShelfIdsRef = useRef(new Set<string>());
  const libraryPreferencesRef = useRef<LibraryPreferences>(migrateLibraryPreferences(null));
  const libraryPreferencesDirtyRef = useRef(false);
  const preferencesWritableRef = useRef(false);
  const bookDetailsTriggerRef = useRef<HTMLElement | null>(null);
  const itemLoadGenerationRef = useRef(0);

  libraryPreferencesRef.current = { ...planning, favoriteIds, playedRecentIds, hiddenRecentIds, queueIds };

  async function saveLibraryPreferences() {
    if (!preferencesWritableRef.current) return;
    try {
      const saving = libraryPreferencesRef.current;
      const response = await fetch("/api/preferences/library", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: saving }),
      });
      if (!response.ok) throw new Error("Unable to save library preferences.");
      libraryPreferencesDirtyRef.current = JSON.stringify(libraryPreferencesRef.current) !== JSON.stringify(saving);
      search.refresh();
    } catch {
      libraryPreferencesDirtyRef.current = true;
      setContinueError("Library preferences could not be saved. They will retry when the connection returns.");
    }
  }

  async function loadLibraries() {
    const response = await fetch("/api/libraries");
    const payload = (await response.json()) as { libraries?: Library[]; error?: string };

    if (response.ok && payload.libraries) {
      setLibraries(payload.libraries);
      if (!activeLibraryId && payload.libraries[0]) {
        setActiveLibraryId(payload.libraries[0].id);
      }
    }
  }

  async function loadItem(itemId: string) {
    if (!itemId) {
      setSelectedItem(null);
      setItemState("idle");
      return null;
    }

    setItemState("loading");
    setItemError(null);
    const generation = ++itemLoadGenerationRef.current;
    try {
      const response = await fetch(`/api/items/${itemId}`);
      const payload = (await response.json()) as LibraryItemExpanded | { error?: string };
      if (generation !== itemLoadGenerationRef.current) return "media" in payload ? payload : null;

      if (!response.ok || !("media" in payload)) {
        setItemState("error");
        setItemError("error" in payload ? payload.error ?? "Unable to load the book." : "Unable to load the book.");
        setSelectedItem(null);
        return null;
      }

      setSelectedItem(payload);
      setItems((current) => current.map((entry) => entry.id === itemId ? payload : entry));
      setShelfItemsById((current) => current[itemId] ? { ...current, [itemId]: payload } : current);
      setItemState("idle");
      return payload;
    } catch {
      if (generation === itemLoadGenerationRef.current) {
        setItemState("error");
        setItemError("The book could not be loaded. Close and reopen its details to retry.");
        setSelectedItem(null);
      }
      return null;
    }
  }

  async function loadFilterData(libraryId: string) {
    if (!libraryId) {
      setLibraryFilterData(null);
      setLibraryFilterState("idle");
      setLibraryFilterError(null);
      return;
    }

    setLibraryFilterState("loading");
    setLibraryFilterError(null);

    const response = await fetch(`/api/libraries/${libraryId}/filterdata`);
    const payload = (await response.json()) as Partial<LibraryFilterData> | { error?: string };

    if (!response.ok || !("authors" in payload)) {
      setLibraryFilterData(null);
      setLibraryFilterState("error");
      setLibraryFilterError(
        "error" in payload ? payload.error ?? "Unable to load Audiobookshelf filters." : "Unable to load Audiobookshelf filters.",
      );
      return;
    }

    setLibraryFilterData(normalizeFilterData(payload));
    setLibraryFilterState("idle");
  }

  async function disconnect() {
    const shouldDisconnect = window.confirm(
      "Sign out of Spoken Page on this device? You can sign in again with your Audiobookshelf account.",
    );

    if (!shouldDisconnect) {
      return;
    }

    await fetch("/api/connection", { method: "DELETE" });
    window.location.reload();
  }

  function clearBrowseSearchAndFilters() {
    setFilter("");
    setWantFilter(false);
    setHideCompleted(false);
    setBrowseFilters({ ...EMPTY_BROWSE_FILTERS });
    setProgressFilter("all");
  }

  function rememberRecent(itemId: string) {
    setPlayedRecentIds((current) => [itemId, ...current.filter((entry) => entry !== itemId)].slice(0, 16));
  }

  function handleBookSelect(itemId: string) {
    bookDetailsTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (itemId !== selectedItemId) {
      setSelectedItemId(itemId);
      setSelectedItem(null);
      setItemState("loading");
      setItemError(null);
    } else if (!selectedItem && itemState !== "loading") {
      void loadItem(itemId);
    }

    setIsBookDetailsOpen(true);
    setIsPlayerOpen(false);
  }

  function handleResume() {
    if (!selectedItemId) return;
    resumeBook(selectedItemId);
  }

  function resumeBook(itemId: string) {
    closeBookDetails(false);
    if (itemId !== selectedItemId) {
      setSelectedItemId(itemId);
      setSelectedItem(null);
      setItemState("loading");
      setItemError(null);
    }
    setPlayerOpenToken((current) => current + 1);
    setIsPlayerOpen(true);
    setHiddenRecentIds((current) => current.filter((entry) => entry !== itemId));
  }

  function closeBookDetails(restoreFocus = true) {
    setIsBookDetailsOpen(false);

    if (restoreFocus && bookDetailsTriggerRef.current) {
      window.setTimeout(() => bookDetailsTriggerRef.current?.focus(), 0);
    }
  }

  function toggleFavorite(itemId: string) {
    if (!preferencesWritableRef.current) return;
    setFavoriteIds((current) =>
      current.includes(itemId)
        ? current.filter((entry) => entry !== itemId)
        : [itemId, ...current],
    );
  }

  function toggleWant(itemId: string) {
    if (!preferencesWritableRef.current) return;
    setPlanning(current => ({ ...current, wantToListenIds: current.wantToListenIds.includes(itemId) ? current.wantToListenIds.filter(id => id !== itemId) : [...current.wantToListenIds, itemId] }));
  }

  async function applyProgressAction(item: LibraryItemMinified, action: ProgressAction) {
    if (completingItemId) return;
    if (action === "restart" && !window.confirm("Start this book over? This resets its listening position and completion in Audiobookshelf.")) return;
    setCompletingItemId(item.id); setContinueError(null);
    try {
      await changeListeningProgress(item.id, action);
      search.refresh();
    } catch (error) { setContinueError(error instanceof Error ? error.message : "Unable to save progress."); }
    finally { setCompletingItemId(""); }
  }
  const markContinueComplete = (item: LibraryItemMinified) => applyProgressAction(item, "complete");

  useEffect(() => {
    void loadLibraries();
    const local = {
      favoriteIds: parseStoredIds(window.localStorage.getItem(userStorageKey(FAVORITES_STORAGE_KEY, preferenceScope))),
      playedRecentIds: parseStoredIds(window.localStorage.getItem(userStorageKey(PLAYED_RECENTS_STORAGE_KEY, preferenceScope))),
      hiddenRecentIds: parseStoredIds(window.localStorage.getItem(userStorageKey(HIDDEN_RECENTS_STORAGE_KEY, preferenceScope))),
      queueIds: parseStoredIds(window.localStorage.getItem(userStorageKey(QUEUE_STORAGE_KEY, preferenceScope))),
      statusOverrides: parseStatusOverrides(window.localStorage.getItem(userStorageKey(STATUS_OVERRIDES_STORAGE_KEY, profile.userId))),
    };
    setFavoriteIds(local.favoriteIds);
    setPlayedRecentIds(local.playedRecentIds);
    setHiddenRecentIds(local.hiddenRecentIds);
    setQueueIds(local.queueIds);
    const cachedPreferences = window.localStorage.getItem(userStorageKey(LIBRARY_PREFERENCES_STORAGE_KEY, preferenceScope));
    try { setPlanning(migrateLibraryPreferences(cachedPreferences ? JSON.parse(cachedPreferences) : local)); }
    catch { setPlanning(migrateLibraryPreferences(local)); }

    void (async () => {
      try {
        const response = await fetch("/api/preferences/library");
        const payload = (await response.json()) as { value?: Partial<typeof local> & Partial<LibraryPreferences> };
        if (!response.ok || !payload.value) throw new Error("Unable to load library preferences.");
        if (payload.value) {
          setFavoriteIds(Array.isArray(payload.value.favoriteIds) ? payload.value.favoriteIds : local.favoriteIds);
          setPlayedRecentIds(Array.isArray(payload.value.playedRecentIds) ? payload.value.playedRecentIds : local.playedRecentIds);
          setHiddenRecentIds(Array.isArray(payload.value.hiddenRecentIds) ? payload.value.hiddenRecentIds : local.hiddenRecentIds);
          setQueueIds(Array.isArray(payload.value.queueIds) ? payload.value.queueIds : local.queueIds);
          setPlanning(migrateLibraryPreferences(payload.value));
          preferencesWritableRef.current = true;
        }
      } catch {
        setContinueError("Your saved preferences could not be loaded. Refresh the page to retry before editing pins or Want to listen.");
      } finally {
        setPreferencesHydrated(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (preferencesHydrated) window.localStorage.setItem(userStorageKey(FAVORITES_STORAGE_KEY, preferenceScope), JSON.stringify(favoriteIds));
  }, [favoriteIds, profile.userId]);

  useEffect(() => {
    if (preferencesHydrated) window.localStorage.setItem(userStorageKey(PLAYED_RECENTS_STORAGE_KEY, preferenceScope), JSON.stringify(playedRecentIds));
  }, [playedRecentIds, profile.userId]);

  useEffect(() => {
    if (preferencesHydrated) window.localStorage.setItem(userStorageKey(HIDDEN_RECENTS_STORAGE_KEY, preferenceScope), JSON.stringify(hiddenRecentIds));
  }, [hiddenRecentIds, profile.userId]);

  useEffect(() => {
    if (preferencesHydrated) window.localStorage.setItem(userStorageKey(QUEUE_STORAGE_KEY, preferenceScope), JSON.stringify(queueIds));
  }, [profile.userId, queueIds]);



  useEffect(() => {
    if (!preferencesHydrated) return;
    window.localStorage.setItem(userStorageKey(LIBRARY_PREFERENCES_STORAGE_KEY, preferenceScope), JSON.stringify(libraryPreferencesRef.current));
    libraryPreferencesDirtyRef.current = true;
    const timeout = window.setTimeout(() => {
      void saveLibraryPreferences();
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [favoriteIds, hiddenRecentIds, playedRecentIds, preferencesHydrated, queueIds, planning]);

  useEffect(() => {
    const handleOnline = () => {
      if (libraryPreferencesDirtyRef.current) void saveLibraryPreferences();
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);



  useEffect(() => {
    if (!activeLibraryId || itemsLibraryId !== activeLibraryId || !preferencesHydrated) return;

    const ids = unloadedShelfIds(
      [...favoriteIds, ...playedRecentIds, ...queueIds],
      items,
      shelfItemsById,
      requestedShelfIdsRef.current,
    );
    if (!ids.length) return;
    ids.forEach((id) => requestedShelfIdsRef.current.add(id));

    void (async () => {
      for (let offset = 0; offset < ids.length; offset += 4) {
        const batch = ids.slice(offset, offset + 4);
        const fetched = await Promise.all(batch.map(async (id) => {
          try {
            const response = await fetch(`/api/items/${encodeURIComponent(id)}`);
            if (!response.ok) return null;
            const item = (await response.json()) as LibraryItemMinified;
            return item.id === id && item.mediaType === "book" && item.media?.metadata?.title ? item : null;
          } catch {
            return null;
          }
        }));
        const found = fetched.filter((item): item is LibraryItemMinified => item !== null);
        if (found.length) {
          setShelfItemsById((current) => ({
            ...current,
            ...Object.fromEntries(found.map((item) => [item.id, item])),
          }));
        }
        setResolvedShelfIds((current) => new Set([...current, ...batch]));
      }
    })();
  }, [activeLibraryId, favoriteIds, items, itemsLibraryId, playedRecentIds, preferencesHydrated, queueIds, shelfItemsById]);

  useEffect(() => {
    if (!itemsPage?.shelfItems || itemsLibraryId !== activeLibraryId) return;
    setShelfItemsById(Object.fromEntries(itemsPage.shelfItems.map(item => [item.id, item])));
    // Update the details status without replacing its expanded chapters/tracks.
    const fresh = [...itemsPage.results, ...itemsPage.shelfItems];
    setSelectedItem(current => {
      const match = current && fresh.find(item => item.id === current.id);
      return current && match ? { ...current, userMediaProgress: match.userMediaProgress } : current;
    });
  }, [itemsPage, itemsLibraryId, activeLibraryId]);

  useEffect(() => {
    void loadFilterData(activeLibraryId);
  }, [activeLibraryId]);

  useEffect(() => {
    if (!selectedItemId) {
      return;
    }

    void loadItem(selectedItemId);
  }, [selectedItemId]);

  useEffect(() => {
    if (!isPlayerOpen) {
      setIsPlayerInlineFullscreen(false);
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (isPlayerInlineFullscreen) {
          setIsPlayerInlineFullscreen(false);
          return;
        }

        setIsPlayerOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isPlayerInlineFullscreen, isPlayerOpen]);

  useEffect(() => {
    if (!isBookDetailsOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeBookDetails();
      }
    };

    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isBookDetailsOpen]);

  useEffect(() => {
    const receive = (event: Event) => {
      const { itemId, progress } = (event as CustomEvent<{ itemId: string; progress: MediaProgress | null }>).detail;
      setItems(current => current.map(item => item.id === itemId ? { ...item, userMediaProgress: progress } : item));
      setShelfItemsById(current => current[itemId] ? { ...current, [itemId]: { ...current[itemId], userMediaProgress: progress } } : current);
      setSelectedItem(current => current?.id === itemId ? { ...current, userMediaProgress: progress } : current);
      if (progress && (progress.startedAt || progress.currentTime > 0)) {
        rememberRecent(itemId);
        setPlanning(current => current.wantToListenIds.includes(itemId) ? { ...current, wantToListenIds: current.wantToListenIds.filter(id => id !== itemId) } : current);
      }
    };
    window.addEventListener(PROGRESS_EVENT, receive);
    return () => window.removeEventListener(PROGRESS_EVENT, receive);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const apply = (params: URLSearchParams) => {
      try {
        const query = parseLibraryQuery(params);
        setFilter(query.q); setSort(query.sort); setDirection(query.direction); setProgressFilter(query.status); setWantFilter(query.want);
        setHideCompleted(query.hideCompleted);
        setBrowseFilters({ genre: query.genre, tag: query.tag, author: query.author, narrator: query.narrator, series: query.series, language: query.language });
        const library = params.get("library"); if (library && libraries.some(item => item.id === library)) setActiveLibraryId(library);
      } catch { /* Invalid URL query falls back to the visible controls. */ }
      setUrlReady(true);
    };
    const restore = () => apply(new URLSearchParams(window.location.search));
    const initial = async () => {
      const params = new URLSearchParams(window.location.search);
      const key = userStorageKey("spoken-page-browse-v1", preferenceScope);
      let local: unknown = null;
      try { local = JSON.parse(window.localStorage.getItem(key) ?? "null"); } catch { /* Storage may be unavailable. */ }
      let saved = restoreBrowsePreferences(local, libraries.map(library => library.id));
      try {
        const response = await fetch("/api/preferences/browse");
        if (!response.ok) throw new Error("Unable to load library view.");
        const payload = await response.json();
        saved = restoreBrowsePreferences(payload.value, libraries.map(library => library.id)) ?? saved;
        browseWritableRef.current = true;
      } catch { /* Preserve the browser copy; do not overwrite unavailable server settings. */ }
      if (cancelled) return;
      if (!hasBrowseQuery(params) && saved) {
        const restored = new URLSearchParams(Object.entries(saved.query).map(([key, value]) => [key, String(value)]));
        if (saved.libraryId) restored.set("library", saved.libraryId);
        apply(restored);
      } else apply(params);
    };
    void initial(); window.addEventListener("popstate", restore);
    return () => { cancelled = true; window.removeEventListener("popstate", restore); };
  }, []);
  useEffect(() => {
    if (!urlReady) return;
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams(queryString); params.set("library", activeLibraryId);
      const next = "?" + params.toString();
      if (next !== window.location.search) window.history.pushState(null, "", next);
      const value = { schemaVersion: 1, query: queryString, libraryId: activeLibraryId };
      try { window.localStorage.setItem(userStorageKey("spoken-page-browse-v1", preferenceScope), JSON.stringify(value)); } catch { /* Server storage is still available. */ }
      if (browseWritableRef.current) browseSaveQueueRef.current = browseSaveQueueRef.current.then(async () => {
        try {
          const response = await fetch("/api/preferences/browse", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value }) });
          if (!response.ok) throw new Error("Unable to save library view.");
          setBrowseSaveError(null);
        } catch { setBrowseSaveError("Your library view could not be synced to your account. It will retry the next time you change the view."); }
      });
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [queryString, activeLibraryId, urlReady]);

  const availableFilterData = useMemo(
    () => libraryFilterData ?? deriveFilterData(items),
    [items, libraryFilterData],
  );

  const activeFilterCount = useMemo(
    () => Object.values(browseFilters).filter(Boolean).length + (progressFilter === "all" ? 0 : 1) + (wantFilter ? 1 : 0) + (hideCompleted ? 1 : 0),
    [browseFilters, progressFilter, wantFilter, hideCompleted],
  );

  const activeBrowseFilters = useMemo(
    () =>
      (
        [
          ["genre", browseFilters.genre, "Genre"],
          ["tag", browseFilters.tag, "Tag"],
          ["author", browseFilters.author, "Author"],
          ["narrator", browseFilters.narrator, "Narrator"],
          ["series", browseFilters.series, "Series"],
          ["language", browseFilters.language, "Language"],
        ] as const
      )
        .filter(([, value]) => Boolean(value))
        .map(([key, value, label]) => ({
          key: key as BrowseFilterKey,
          label: `${label}: ${value}`,
        })),
    [browseFilters],
  );

  const filteredItems = items;

  const itemsById = useMemo(
    () => libraryItemsById(activeLibraryId, items, shelfItemsById),
    [activeLibraryId, items, shelfItemsById],
  );

  const favoriteItems = useMemo(
    () =>
      favoriteIds
        .map((id) => itemsById.get(id))
        .filter((entry): entry is LibraryItemMinified => Boolean(entry)),
    [favoriteIds, itemsById],
  );

  const continueItem = useMemo(() =>
    [...new Map([...(itemsPage?.continueItem ? [[itemsPage.continueItem.id, itemsPage.continueItem] as const] : []), ...itemsById]).values()]
      .filter((entry) => {
        const progress = entry.userMediaProgress;
        return listeningState(progress) === "in-progress" && !hiddenRecentIds.includes(entry.id);
      })
      .sort((left, right) => (right.userMediaProgress?.lastUpdate ?? 0) - (left.userMediaProgress?.lastUpdate ?? 0))[0] ?? null,
  [hiddenRecentIds, itemsById, itemsPage]);
  const continueDuration = continueItem?.userMediaProgress?.duration || continueItem?.media.duration || 0;
  const continueCurrentTime = continueItem?.userMediaProgress?.currentTime ?? 0;
  const continuePercent = continueDuration > 0 ? Math.round(Math.min(100, continueCurrentTime / continueDuration * 100)) : 0;

  const browseItems = filteredItems;

  const activeLibrary = libraries.find((library) => library.id === activeLibraryId) ?? null;

  const nextInSeries = selectedItem?.id === selectedItemId ? selectedItem.nextInSeries ?? null : null;
  const queueItems = useMemo(
    () => queueIds.map((id) => itemsById.get(id)).filter((entry): entry is LibraryItemMinified => Boolean(entry)),
    [itemsById, queueIds],
  );

  function renderBookTile(entry: LibraryItemMinified, section: "all" | "pinned") {
    const isFavorite = favoriteIds.includes(entry.id);
    const isSelected = entry.id === selectedItemId && (isBookDetailsOpen || isPlayerOpen);

    return <BookTile key={`${section}-${entry.id}`} item={entry} compact={section === "pinned"} favorite={isFavorite} selected={isSelected} wantToListen={planning.wantToListenIds.includes(entry.id)} onSelect={() => handleBookSelect(entry.id)} onSelectSeries={showSeries} onToggleFavorite={() => toggleFavorite(entry.id)} />;
  }

  function showSeries(seriesName: string | null | undefined) {
    const name = seriesName?.trim() ?? "";
    if (!name) return;
    setFilter("");
    setProgressFilter("all");
    setBrowseFilters({ ...EMPTY_BROWSE_FILTERS, series: name });
    closeBookDetails(false);
    requestAnimationFrame(() => document.getElementById("book-library")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  return (
    <div className={`dashboard ${isPlayerOpen ? "dashboard-with-player" : ""}`}>
      <section className="panel library-panel">
        <div className="library-overview">
          <div className="library-overview-copy">
            <div className="library-overview-main">
              <h2>{activeLibrary?.name ?? "Audiobookshelf Library"}</h2>
              <p className="panel-description library-overview-meta">
                Connected as <strong>{profile.username}</strong> on Audiobookshelf {profile.serverVersion}.
              </p>
            </div>
          </div>

          <div className="library-overview-actions">
            <select
              className="library-select"
              onChange={(event) => setActiveLibraryId(event.target.value)}
              value={activeLibraryId}
            >
              {libraries.map((library) => (
                <option key={library.id} value={library.id}>
                  {library.name}
                </option>
              ))}
            </select>

            <button className="button button-secondary" onClick={() => { search.refresh(true); void loadFilterData(activeLibraryId); }} type="button">Refresh library</button>
            <button className="button button-secondary" onClick={disconnect} type="button">
              Sign out
            </button>
          </div>
        </div>

        {continueError && !isBookDetailsOpen ? <p role="alert" className="status-message status-error">{continueError}</p> : null}
        {continueItem ? (
          <section className="continue-listening" aria-label="Continue listening">
            <button className="continue-listening-book" onClick={() => handleBookSelect(continueItem.id)} type="button">
              <img alt="" src={`/api/items/${continueItem.id}/cover`} />
              <span className="continue-listening-copy">
                <span className="eyebrow">Continue listening</span>
                <strong>{continueItem.media.metadata.title}</strong>
                <span className="continue-listening-author">{continueItem.media.metadata.authorName ?? "Unknown author"}</span>
                <span className="continue-listening-time">{continuePercent}% complete · {formatDuration(Math.max(0, continueDuration - continueCurrentTime))} left</span>
                <span className="continue-listening-progress" role="progressbar" aria-label="Listening progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={continuePercent}>
                  <span style={{ width: `${continuePercent}%` }} />
                </span>
              </span>
            </button>
            <div className="continue-listening-actions">
              <button className="button book-action-secondary" disabled={Boolean(completingItemId)} onClick={() => void markContinueComplete(continueItem)} type="button">{completingItemId ? "Saving…" : "Mark complete"}</button>
              <button className="button button-primary continue-listening-resume" onClick={() => resumeBook(continueItem.id)} type="button">Resume</button>
            </div>
            {continueError ? <p className="continue-listening-error status-error" role="alert">{continueError}</p> : null}
          </section>
        ) : null}

        {continueItem && favoriteItems.length > 0 ? <div className="continue-pinned-divider" aria-hidden="true" /> : null}

        {favoriteItems.length > 0 ? (
          <section className="pinned-section" aria-label="Pinned books">
            <div className="library-section-head">
              <div><h3>Pinned books</h3></div>
              <span className="section-count">{favoriteItems.length}</span>
            </div>
            {favoriteItems.length > 0 ? (
              <>
                <div className="pinned-book-grid">
                  {(showAllPins ? favoriteItems : favoriteItems.slice(0, 4)).map((entry) => renderBookTile(entry, "pinned"))}
                </div>
                {favoriteItems.length > 4 ? (
                  <button className="button button-secondary pinned-show-more" onClick={() => setShowAllPins((current) => !current)} type="button">
                    {showAllPins ? "Show fewer" : `Show all ${favoriteItems.length} pins`}
                  </button>
                ) : null}
              </>
            ) : null}
          </section>
        ) : null}

        <section className="library-section-card library-section-main" id="book-library">
          {browseSaveError ? <p className="status-message" role="status">{browseSaveError}</p> : null}
          <div className="library-section-head">
            <div>
              <h3>Browse books</h3>
            </div>
            <span className="section-count">{itemsPage?.total ?? "…"}</span>
          </div>

          <div className="all-books-searchbar">
            <label className="field">
              <input
                aria-label="Search book library"
                className="library-search"
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Search the entire library"
                value={filter}
              />
            </label>

            <label className="field library-compact-field">
              <span>Sort</span>
              <select aria-label="Sort books" onChange={(event) => { setSort(event.target.value as LibrarySort); setDirection(["recent", "progress", "year"].includes(event.target.value) ? "desc" : "asc"); }} value={sort}>
                <option value="title">Title</option>
                <option value="recent">Recently played</option>
                <option value="progress">Progress</option>
                <option value="author">Author</option>
                <option value="series">Series</option>
                <option value="year">Publication year</option>
                <option value="duration">Duration</option>
              </select>
            </label>


            <label className="field library-compact-field">
              <span>Status</span>
              <select aria-label="Filter by listening status" onChange={(event) => { const want = event.target.value === "want"; setWantFilter(want); setProgressFilter(want ? "all" : event.target.value as ProgressFilter); if (event.target.value === "finished") setHideCompleted(false); }} value={wantFilter ? "want" : progressFilter}>
                <option value="all">All books</option>

                <option value="unstarted">Not started</option>
                <option value="in-progress">In progress</option>
                <option value="finished">Completed</option>
                <option value="want">Want to listen</option>
              </select>
            </label>

            <button
              className="button button-secondary library-clear-button"
              disabled={!filter && activeFilterCount === 0}
              onClick={clearBrowseSearchAndFilters}
              type="button"
            >
              Clear
            </button>

            <details className="library-filter-dropdown">
              <summary>
                <span className="library-filter-summary-label">
                  <span>Filters</span>
                  <span className="library-filter-summary-copy">
                    {activeFilterCount > 0 ? `${activeFilterCount} active` : "Genre, author, series, and more"}
                  </span>
                </span>
                <span className="library-filter-summary-count">{activeFilterCount}</span>
              </summary>

              <div className="library-filter-dropdown-body">
                {libraryFilterState === "loading" ? (
                  <p className="library-filter-status">Loading Audiobookshelf filters...</p>
                ) : null}
                {libraryFilterError ? (
                  <p className="library-filter-status">
                    Using the books already loaded here to build the filter list.
                  </p>
                ) : null}

                <div className="library-filter-grid">
                  <label className="field">
                    <span>Genre</span>
                    <select
                      onChange={(event) =>
                        setBrowseFilters((current) => ({ ...current, genre: event.target.value }))
                      }
                      value={browseFilters.genre}
                    >
                      <option value="">All genres</option>
                      {availableFilterData.genres.map((genre) => (
                        <option key={genre} value={genre}>
                          {genre}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Tag</span>
                    <select
                      onChange={(event) =>
                        setBrowseFilters((current) => ({ ...current, tag: event.target.value }))
                      }
                      value={browseFilters.tag}
                    >
                      <option value="">All tags</option>
                      {availableFilterData.tags.map((tag) => (
                        <option key={tag} value={tag}>
                          {tag}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Author</span>
                    <select
                      onChange={(event) =>
                        setBrowseFilters((current) => ({ ...current, author: event.target.value }))
                      }
                      value={browseFilters.author}
                    >
                      <option value="">All authors</option>
                      {availableFilterData.authors.map((authorOption) => (
                        <option key={authorOption.id} value={authorOption.name}>
                          {authorOption.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Narrator</span>
                    <select
                      onChange={(event) =>
                        setBrowseFilters((current) => ({ ...current, narrator: event.target.value }))
                      }
                      value={browseFilters.narrator}
                    >
                      <option value="">All narrators</option>
                      {availableFilterData.narrators.map((narratorOption) => (
                        <option key={narratorOption} value={narratorOption}>
                          {narratorOption}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Series</span>
                    <select
                      onChange={(event) =>
                        setBrowseFilters((current) => ({ ...current, series: event.target.value }))
                      }
                      value={browseFilters.series}
                    >
                      <option value="">All series</option>
                      {availableFilterData.series.map((seriesOption) => (
                        <option key={seriesOption.id} value={seriesOption.name}>
                          {seriesOption.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Language</span>
                    <select
                      onChange={(event) =>
                        setBrowseFilters((current) => ({ ...current, language: event.target.value }))
                      }
                      value={browseFilters.language}
                    >
                      <option value="">All languages</option>
                      {availableFilterData.languages.map((language) => (
                        <option key={language} value={language}>
                          {language}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="library-filter-toggles">
                  <button className="button book-action-secondary want-listen-button" aria-pressed={hideCompleted} onClick={() => { setHideCompleted(current => !current); if (!hideCompleted && progressFilter === "finished") setProgressFilter("all"); }} type="button">Hide completed</button>
                  <button className="button book-action-secondary" disabled={activeFilterCount === 0} onClick={clearBrowseSearchAndFilters} type="button">Clear all</button>
                </div>
              </div>
            </details>
            <button className="button book-action-secondary library-sort-direction" aria-label={`Sort ${direction === "asc" ? "ascending" : "descending"}. Switch to ${direction === "asc" ? "descending" : "ascending"}`} title={direction === "asc" ? "Ascending — switch to descending" : "Descending — switch to ascending"} onClick={() => setDirection(current => current === "asc" ? "desc" : "asc")} type="button">
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <g opacity={direction === "asc" ? 1 : .35}><path d="M7 19V5m-4 4 4-4 4 4" /></g>
                <g opacity={direction === "desc" ? 1 : .35}><path d="M17 5v14m-4-4 4 4 4-4" /></g>
              </svg>
            </button>
          </div>

          {activeBrowseFilters.length > 0 ? (
            <div className="all-books-active-filters" aria-label="Active filters">
              {activeBrowseFilters.map((entry) => (
                <button
                  className="filter-chip-pill"
                  key={entry.key}
                  onClick={() =>
                    setBrowseFilters((current) => ({
                      ...current,
                      [entry.key]: "",
                    }))
                  }
                  type="button"
                >
                  <span>{entry.label}</span>
                  <span aria-hidden="true">x</span>
                </button>
              ))}
            </div>
          ) : null}

          {hideCompleted ? <div className="all-books-active-filters"><button className="filter-chip-pill" onClick={() => setHideCompleted(false)} type="button"><span>Hide completed</span><span aria-hidden="true">×</span></button></div> : null}
          {progressFilter !== "all" ? <div className="all-books-active-filters"><button className="filter-chip-pill" onClick={() => setProgressFilter("all")} type="button"><span>Status: {progressFilter.replace("-", " ")}</span><span aria-hidden="true">×</span></button></div> : null}

          {itemsState === "loading" ? <p role="status" className="status-message">{search.preparing ? `${search.preparing.verifying ? "Verifying" : "Preparing"} library search: ${search.preparing.processed} of ${search.preparing.total || "…"} books…` : items.length ? "Updating library results…" : "Preparing complete library search…"}</p> : null}
          {itemsError ? <p role="alert" className="status-message status-error">{itemsError} <button className="button button-secondary" onClick={() => search.refresh(true)} type="button">Try again</button></p> : null}

          <div className="book-tile-grid">
            {browseItems.map((entry) => renderBookTile(entry, "all"))}
          </div>

          {itemsPage && itemsPage.total > items.length ? (
            <div className="pagination-actions">
              <p className="status-message">Showing {items.length} of {itemsPage.total} matching books.</p>
              <button className="button button-secondary" disabled={itemsState === "loading"} onClick={() => void loadMoreItems()} type="button">
                {itemsState === "loading" ? "Loading…" : "Load more books"}
              </button>
            </div>
          ) : null}

          {itemsState === "idle" && browseItems.length === 0 ? (
            <p className="status-message">No audiobooks in this library match your search and filters.</p>
          ) : null}
        </section>

      </section>

      {isBookDetailsOpen ? (
        <div
          className="book-details-modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeBookDetails();
          }}
        >
          <section
            aria-label={selectedItem ? `${selectedItem.media.metadata.title} details` : "Book details"}
            aria-modal="true"
            className="book-details-modal"
            role="dialog"
          >
            <button
              aria-label="Close book details"
              autoFocus
              className="book-details-modal-close"
              onClick={() => closeBookDetails()}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M6 6l12 12" />
                <path d="M18 6L6 18" />
              </svg>
            </button>
            <BookDetails
              error={itemError}
              item={selectedItem}
              loading={itemState === "loading"}
              nextInSeries={nextInSeries}
              onAddToQueue={(item) => setQueueIds((current) => current.includes(item.id) ? current : [...current, item.id])}
              onRemoveFromQueue={(id) => setQueueIds((current) => current.filter((entry) => entry !== id))}
              onSelectQueued={(id) => {
                setQueueIds((current) => current.filter((entry) => entry !== id));
                handleBookSelect(id);
              }}
              onResume={handleResume}
              onSelectSeries={showSeries}
              onSelectNext={handleBookSelect}
              wantToListen={Boolean(selectedItem && planning.wantToListenIds.includes(selectedItem.id))}
              onToggleWant={() => { if (selectedItem) toggleWant(selectedItem.id); }}
              onProgressAction={(action) => { if (selectedItem) void applyProgressAction(selectedItem, action); }}
              progressBusy={Boolean(completingItemId)}
              progressError={continueError}
              legacyStatus={selectedItem && !planning.dismissedLegacyIds.includes(selectedItem.id) ? planning.legacyStatusOverrides[selectedItem.id] : undefined}
              onDismissLegacy={() => { if (selectedItem) setPlanning(current => ({ ...current, dismissedLegacyIds: [...current.dismissedLegacyIds, selectedItem.id] })); }}
              queue={queueItems}
            />
          </section>
        </div>
      ) : null}

      {isPlayerOpen ? (
        <section
          className={`player-subsection-panel ${
            isPlayerInlineFullscreen ? "player-subsection-panel-fullscreen" : ""
          }`}
          aria-label="Player section"
        >
          <div className="player-subsection-body">
            {itemState === "loading" ? <p className="status-message">Loading book details...</p> : null}
            {itemError ? <p className="status-message status-error">{itemError}</p> : null}
            <PlayerPanel
              item={selectedItem}
              preferenceScope={preferenceScope}
              onHide={() => {
                setIsPlayerInlineFullscreen(false);
                setIsPlayerOpen(false);
              }}
              onInlineFullscreenChange={setIsPlayerInlineFullscreen}
              onItemRefresh={loadItem}
              openToken={playerOpenToken}
              variant="dock"
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
