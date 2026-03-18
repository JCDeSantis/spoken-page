"use client";

import { useEffect, useMemo, useState } from "react";
import { PlayerPanel } from "@/components/player-panel";
import {
  AuthorizedSummary,
  Library,
  LibraryFilterData,
  LibraryItemExpanded,
  LibraryItemMinified,
} from "@/lib/types";

const FAVORITES_STORAGE_KEY = "spoken-page-favorites";
const RECENTS_STORAGE_KEY = "spoken-page-recents";
const HIDDEN_RECENTS_STORAGE_KEY = "spoken-page-hidden-recents";

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

function normalizeValue(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function collapseWhitespace(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ");
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

function stripSeriesSuffix(value: string | null | undefined) {
  const collapsed = collapseWhitespace(value);

  if (!collapsed) {
    return "";
  }

  const labeledSuffixRemoved = collapsed
    .replace(/(?:\s*[-,:]\s*)?(?:book|bk|volume|vol(?:ume)?|part)\s*\d+(?:\.\d+)?$/i, "")
    .replace(/(?:\s*[-,:]\s*)?#\s*\d+(?:\.\d+)?$/i, "")
    .trim();

  if (labeledSuffixRemoved !== collapsed) {
    return labeledSuffixRemoved;
  }

  const separatedNumberMatch = collapsed.match(/^(.*\S)\s*[-:]\s*\d+(?:\.\d+)?$/);
  if (separatedNumberMatch) {
    const base = separatedNumberMatch[1].trim();
    if (base.split(/\s+/).length > 1) {
      return base;
    }
  }

  const bareNumberMatch = collapsed.match(/^(.*\S)\s+\d+(?:\.\d+)?$/);
  if (bareNumberMatch) {
    const base = bareNumberMatch[1].trim();
    if (base.split(/\s+/).length > 1) {
      return base;
    }
  }

  return collapsed;
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
    const canonicalName = stripSeriesSuffix(entry.name);
    const canonicalId = getSeriesFilterKey(entry.name) || normalizeValue(entry.id) || normalizeValue(entry.name);

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

    const seriesName = entry.media.metadata.seriesName?.trim();
    if (seriesName) {
      const canonicalSeriesName = stripSeriesSuffix(seriesName);
      const canonicalSeriesKey = getSeriesFilterKey(seriesName);

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
  const [items, setItems] = useState<LibraryItemMinified[]>([]);
  const [itemsState, setItemsState] = useState<"idle" | "loading" | "error">("idle");
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string>("");
  const [selectedItem, setSelectedItem] = useState<LibraryItemExpanded | null>(null);
  const [itemState, setItemState] = useState<"idle" | "loading" | "error">("idle");
  const [itemError, setItemError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [browseFilters, setBrowseFilters] = useState<BrowseFilters>({ ...EMPTY_BROWSE_FILTERS });
  const [libraryFilterData, setLibraryFilterData] = useState<LibraryFilterData | null>(null);
  const [libraryFilterState, setLibraryFilterState] = useState<"idle" | "loading" | "error">("idle");
  const [libraryFilterError, setLibraryFilterError] = useState<string | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [hiddenRecentIds, setHiddenRecentIds] = useState<string[]>([]);
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);
  const [isPlayerInlineFullscreen, setIsPlayerInlineFullscreen] = useState(false);
  const [playerOpenToken, setPlayerOpenToken] = useState(0);

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

  async function loadItems(libraryId: string) {
    if (!libraryId) {
      setItems([]);
      setSelectedItem(null);
      return;
    }

    setItemsState("loading");
    setItemsError(null);

    const response = await fetch(`/api/libraries/${libraryId}/items`);
    const payload = (await response.json()) as {
      results?: LibraryItemMinified[];
      error?: string;
    };

    if (!response.ok || !payload.results) {
      setItemsState("error");
      setItemsError(payload.error ?? "Unable to load books from this library.");
      return;
    }

    setItems(payload.results);
    setItemsState("idle");

    if (!payload.results.some((entry) => entry.id === selectedItemId)) {
      const preferred =
        payload.results.find((entry) => !entry.userMediaProgress?.isFinished) ?? payload.results[0] ?? null;
      setSelectedItemId(preferred?.id ?? "");
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

    const response = await fetch(`/api/items/${itemId}`);
    const payload = (await response.json()) as LibraryItemExpanded | { error?: string };

    if (!response.ok || !("media" in payload)) {
      setItemState("error");
      setItemError("error" in payload ? payload.error ?? "Unable to load the book." : "Unable to load the book.");
      setSelectedItem(null);
      return null;
    }

    setSelectedItem(payload);
    setItemState("idle");
    return payload;
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
      "Disconnect from this Audiobookshelf server? You can reconnect at any time with your API token.",
    );

    if (!shouldDisconnect) {
      return;
    }

    await fetch("/api/connection", { method: "DELETE" });
    window.location.reload();
  }

  function clearBrowseSearchAndFilters() {
    setFilter("");
    setBrowseFilters({ ...EMPTY_BROWSE_FILTERS });
  }

  function rememberRecent(itemId: string) {
    setRecentIds((current) => [itemId, ...current.filter((entry) => entry !== itemId)].slice(0, 16));
  }

  function handleBookSelect(itemId: string) {
    setSelectedItemId(itemId);
    setSelectedItem(null);
    setItemState("loading");
    setItemError(null);
    setPlayerOpenToken((current) => current + 1);
    setIsPlayerOpen(true);
    setHiddenRecentIds((current) => current.filter((entry) => entry !== itemId));
    rememberRecent(itemId);
  }

  function toggleFavorite(itemId: string) {
    setFavoriteIds((current) =>
      current.includes(itemId)
        ? current.filter((entry) => entry !== itemId)
        : [itemId, ...current],
    );
  }

  function dismissRecent(itemId: string) {
    setRecentIds((current) => current.filter((entry) => entry !== itemId));
    setHiddenRecentIds((current) =>
      current.includes(itemId) ? current : [itemId, ...current],
    );
  }

  useEffect(() => {
    void loadLibraries();
    setFavoriteIds(parseStoredIds(window.localStorage.getItem(FAVORITES_STORAGE_KEY)));
    setRecentIds(parseStoredIds(window.localStorage.getItem(RECENTS_STORAGE_KEY)));
    setHiddenRecentIds(parseStoredIds(window.localStorage.getItem(HIDDEN_RECENTS_STORAGE_KEY)));
  }, []);

  useEffect(() => {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favoriteIds));
  }, [favoriteIds]);

  useEffect(() => {
    window.localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(recentIds));
  }, [recentIds]);

  useEffect(() => {
    window.localStorage.setItem(HIDDEN_RECENTS_STORAGE_KEY, JSON.stringify(hiddenRecentIds));
  }, [hiddenRecentIds]);

  useEffect(() => {
    void loadItems(activeLibraryId);
  }, [activeLibraryId]);

  useEffect(() => {
    void loadFilterData(activeLibraryId);
    setBrowseFilters({ ...EMPTY_BROWSE_FILTERS });
  }, [activeLibraryId]);

  useEffect(() => {
    if (!selectedItemId || !isPlayerOpen) {
      return;
    }

    void loadItem(selectedItemId);
  }, [isPlayerOpen, selectedItemId]);

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

  const availableFilterData = useMemo(
    () => libraryFilterData ?? deriveFilterData(items),
    [items, libraryFilterData],
  );

  const activeFilterCount = useMemo(
    () => Object.values(browseFilters).filter(Boolean).length,
    [browseFilters],
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

  const filteredItems = useMemo(() => {
    const query = filter.trim().toLowerCase();

    return items.filter((entry) => {
      const title = entry.media.metadata.title.toLowerCase();
      const author = entry.media.metadata.authorName?.toLowerCase() ?? "";
      const narrator = entry.media.metadata.narratorName?.toLowerCase() ?? "";
      const matchesQuery =
        !query || title.includes(query) || author.includes(query) || narrator.includes(query);
      const matchesGenre =
        !browseFilters.genre ||
        (entry.media.metadata.genres ?? []).some(
          (genre) => normalizeValue(genre) === normalizeValue(browseFilters.genre),
        );
      const matchesTag =
        !browseFilters.tag ||
        (entry.media.tags ?? []).some((tag) => normalizeValue(tag) === normalizeValue(browseFilters.tag));
      const matchesAuthor = matchesDelimitedValue(entry.media.metadata.authorName, browseFilters.author);
      const matchesNarrator = matchesDelimitedValue(entry.media.metadata.narratorName, browseFilters.narrator);
      const matchesSeries = matchesSeriesValue(entry.media.metadata.seriesName, browseFilters.series);
      const matchesLanguage =
        !browseFilters.language ||
        normalizeValue(entry.media.metadata.language) === normalizeValue(browseFilters.language);

      return (
        matchesQuery &&
        matchesGenre &&
        matchesTag &&
        matchesAuthor &&
        matchesNarrator &&
        matchesSeries &&
        matchesLanguage
      );
    });
  }, [browseFilters, filter, items]);

  const itemsById = useMemo(() => new Map(items.map((entry) => [entry.id, entry])), [items]);

  const favoriteItems = useMemo(
    () =>
      favoriteIds
        .map((id) => itemsById.get(id))
        .filter((entry): entry is LibraryItemMinified => Boolean(entry)),
    [favoriteIds, itemsById],
  );

  const recentItems = useMemo(() => {
    const localRecentOrder = new Map(recentIds.map((id, index) => [id, index]));
    const hiddenRecentSet = new Set(hiddenRecentIds);

    return [...items]
      .filter(
        (entry) =>
          !hiddenRecentSet.has(entry.id) &&
          (localRecentOrder.has(entry.id) ||
            Boolean(entry.userMediaProgress?.lastUpdate) ||
            (entry.userMediaProgress?.currentTime ?? 0) > 0),
      )
      .sort((left, right) => {
        const lastUpdateDifference =
          (right.userMediaProgress?.lastUpdate ?? 0) - (left.userMediaProgress?.lastUpdate ?? 0);

        if (lastUpdateDifference !== 0) {
          return lastUpdateDifference;
        }

        return (localRecentOrder.get(left.id) ?? 999) - (localRecentOrder.get(right.id) ?? 999);
      })
      .slice(0, 12);
  }, [hiddenRecentIds, items, recentIds]);

  const activeLibrary = libraries.find((library) => library.id === activeLibraryId) ?? null;

  function renderBookTile(entry: LibraryItemMinified, section: "all" | "recent" | "favorites") {
    const isFavorite = favoriteIds.includes(entry.id);
    const isSelected = entry.id === selectedItemId;

    return (
      <article
        className={`book-tile ${isSelected ? "book-tile-active" : ""} ${
          section !== "all" ? "book-tile-compact" : ""
        }`}
        key={`${section}-${entry.id}`}
      >
        <button
          className="book-tile-select"
          onClick={() => handleBookSelect(entry.id)}
          type="button"
        >
          <img alt="" className="book-tile-cover" src={`/api/items/${entry.id}/cover`} />

          <div className="book-tile-copy">
            <strong>{entry.media.metadata.title}</strong>
            <span>{entry.media.metadata.authorName ?? "Unknown author"}</span>
          </div>
        </button>

        {section === "recent" ? (
          <button
            aria-label="Remove from recent books"
            className="recent-chip"
            onClick={(event) => {
              event.stopPropagation();
              dismissRecent(entry.id);
            }}
            title="Remove from recent books"
            type="button"
          />
        ) : null}

        <button
          aria-label={isFavorite ? "Remove from saved books" : "Save this book"}
          className={`favorite-chip ${isFavorite ? "favorite-chip-active" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            toggleFavorite(entry.id);
          }}
          type="button"
        >
          <span className="favorite-chip-label">
            <span className="favorite-chip-text favorite-chip-text-default">
              {isFavorite ? "Saved" : "Save"}
            </span>
            {isFavorite ? (
              <span className="favorite-chip-text favorite-chip-text-hover">Remove</span>
            ) : null}
          </span>
        </button>
      </article>
    );
  }

  return (
    <div className={`dashboard ${isPlayerOpen ? "dashboard-with-player" : ""}`}>
      <section className="panel library-panel">
        <div className="library-overview">
          <div className="library-overview-copy">
            <p className="eyebrow">Spoken Page Library</p>
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

            <button className="button button-secondary" onClick={disconnect} type="button">
              Disconnect
            </button>
          </div>
        </div>

        <div className="library-sections">
          <section className="library-section-card">
            <div className="library-section-head">
              <div>
                <h3>Favorites</h3>
              </div>
              <span className="section-count">{favoriteItems.length}</span>
            </div>

            {favoriteItems.length > 0 ? (
              <div className="book-tile-grid book-tile-grid-featured">
                {favoriteItems.slice(0, 8).map((entry) => renderBookTile(entry, "favorites"))}
              </div>
            ) : (
              <p className="status-message">
                Save books here so the ones you revisit often stay pinned to the top.
              </p>
            )}
          </section>

          <section className="library-section-card">
            <div className="library-section-head">
              <div>
                <h3>Recent Books</h3>
              </div>
              <span className="section-count">{recentItems.length}</span>
            </div>

            {recentItems.length > 0 ? (
              <div className="book-tile-grid book-tile-grid-featured">
                {recentItems.map((entry) => renderBookTile(entry, "recent"))}
              </div>
            ) : (
              <p className="status-message">
                Recently opened or in-progress books will appear here for quicker return trips.
              </p>
            )}
          </section>
        </div>

        <section className="library-section-card library-section-main">
          <div className="library-section-head">
            <div>
              <h3>Book Library</h3>
            </div>
            <span className="section-count">{filteredItems.length}</span>
          </div>

          <div className="all-books-searchbar">
            <label className="field">
              <input
                aria-label="Search book library"
                className="library-search"
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Search by title, author, or narrator"
                value={filter}
              />
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
                <div className="library-filter-dropdown-head">
                  <div>
                    <p className="eyebrow">Refine Shelf</p>
                    <h4>Browse filters</h4>
                  </div>

                  <button
                    className="button button-secondary button-compact"
                    disabled={activeFilterCount === 0}
                    onClick={clearBrowseSearchAndFilters}
                    type="button"
                  >
                    Clear all
                  </button>
                </div>

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
              </div>
            </details>
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

          {itemsState === "loading" ? <p className="status-message">Loading books...</p> : null}
          {itemsError ? <p className="status-message status-error">{itemsError}</p> : null}

          <div className="book-tile-grid">
            {filteredItems.map((entry) => renderBookTile(entry, "all"))}
          </div>

          {itemsState === "idle" && filteredItems.length === 0 ? (
            <p className="status-message">No audiobooks matched that filter.</p>
          ) : null}
        </section>
      </section>

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
