"use client";

import { useEffect, useMemo, useState } from "react";
import { PlayerPanel } from "@/components/player-panel";
import {
  AuthorizedSummary,
  Library,
  LibraryItemExpanded,
  LibraryItemMinified,
} from "@/lib/types";

const FAVORITES_STORAGE_KEY = "spoken-page-favorites";
const RECENTS_STORAGE_KEY = "spoken-page-recents";

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
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);
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

  async function disconnect() {
    await fetch("/api/connection", { method: "DELETE" });
    window.location.reload();
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
    rememberRecent(itemId);
  }

  function toggleFavorite(itemId: string) {
    setFavoriteIds((current) =>
      current.includes(itemId)
        ? current.filter((entry) => entry !== itemId)
        : [itemId, ...current],
    );
  }

  useEffect(() => {
    void loadLibraries();
    setFavoriteIds(parseStoredIds(window.localStorage.getItem(FAVORITES_STORAGE_KEY)));
    setRecentIds(parseStoredIds(window.localStorage.getItem(RECENTS_STORAGE_KEY)));
  }, []);

  useEffect(() => {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favoriteIds));
  }, [favoriteIds]);

  useEffect(() => {
    window.localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(recentIds));
  }, [recentIds]);

  useEffect(() => {
    void loadItems(activeLibraryId);
  }, [activeLibraryId]);

  useEffect(() => {
    if (!selectedItemId || !isPlayerOpen) {
      return;
    }

    void loadItem(selectedItemId);
  }, [isPlayerOpen, selectedItemId]);

  useEffect(() => {
    if (!isPlayerOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsPlayerOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isPlayerOpen]);

  const filteredItems = useMemo(() => {
    const query = filter.trim().toLowerCase();

    if (!query) {
      return items;
    }

    return items.filter((entry) => {
      const title = entry.media.metadata.title.toLowerCase();
      const author = entry.media.metadata.authorName?.toLowerCase() ?? "";
      const narrator = entry.media.metadata.narratorName?.toLowerCase() ?? "";

      return title.includes(query) || author.includes(query) || narrator.includes(query);
    });
  }, [filter, items]);

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

    return [...items]
      .filter(
        (entry) =>
          localRecentOrder.has(entry.id) ||
          Boolean(entry.userMediaProgress?.lastUpdate) ||
          (entry.userMediaProgress?.currentTime ?? 0) > 0,
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
  }, [items, recentIds]);

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
                <p className="eyebrow">Quick Shelf</p>
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
                <p className="eyebrow">Continue</p>
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
              <p className="eyebrow">Browse</p>
              <h3>All Books</h3>
            </div>
            <span className="section-count">{filteredItems.length}</span>
          </div>

          <div className="all-books-searchbar">
            <label className="field">
              <span>Search all books</span>
              <input
                className="library-search"
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Search by title, author, or narrator"
                value={filter}
              />
            </label>
          </div>

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
        <section className="player-subsection-panel" aria-label="Player section">
          <div className="player-subsection-body">
            {itemState === "loading" ? <p className="status-message">Loading book details...</p> : null}
            {itemError ? <p className="status-message status-error">{itemError}</p> : null}
            <PlayerPanel
              item={selectedItem}
              onHide={() => setIsPlayerOpen(false)}
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
