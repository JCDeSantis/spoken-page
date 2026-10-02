import { createHash } from "node:crypto";
import { absJson, getConnection, listLibraryItems, AudiobookshelfError } from "./audiobookshelf";
import type { LibraryItemMinified, LibraryItemsResponse, MediaProgress } from "./types";

type Catalog = { items: LibraryItemMinified[]; updatedAt: number };
const catalogs = new Map<string, Catalog>();
const building = new Map<string, Promise<Catalog>>();
const preparation = new Map<string, { processed: number; total: number; verifying: boolean }>();
const buildErrors = new Map<string, Error>();
const TTL = 60_000;
const PAGE_SIZE = 500;

/** Never publish a partial catalog. Two equal passes detect concurrent membership/metadata changes. */
export async function collectCatalog(load: (page: number, limit: number) => Promise<LibraryItemsResponse>, onProgress?: (processed: number, total: number, verifying: boolean) => void): Promise<LibraryItemMinified[]> {
  let previous = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const first = await load(0, PAGE_SIZE);
    if (!Number.isSafeInteger(first.total) || first.total < 0 || first.total > 250_000) throw new Error("Unsupported library size.");
    const limit = first.limit || PAGE_SIZE;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > PAGE_SIZE) throw new Error("Invalid catalog page size.");
    const items = [...first.results]; let stable = true;
    onProgress?.(items.length, first.total, attempt > 0);
    // Sequential pages bound upstream load and work inside the authenticated request context.
    for (let page = 1; page < Math.ceil(first.total / limit); page++) {
      const result = await load(page, limit);
      stable = stable && result.total === first.total;
      items.push(...result.results);
      onProgress?.(items.length, first.total, attempt > 0);
    }
    const unique = new Set(items.map(i => i.id));
    if (!stable || items.length !== first.total || unique.size !== first.total) { previous = ""; continue; }
    const fingerprint = createHash("sha256").update(JSON.stringify(items.map(({ userMediaProgress: _progress, ...item }) => item).sort((a,b) => a.id.localeCompare(b.id)))).digest("hex");
    if (fingerprint === previous) return items.map(({ userMediaProgress: _progress, ...item }) => item);
    previous = fingerprint;
  }
  throw new Error("The library changed while preparing search. Please refresh and try again; no incomplete results were returned.");
}

export async function getLibraryCatalog(libraryId: string, refresh = false, waitForBuild = true) {
  const connection = await getConnection();
  if (!connection?.userId) throw new AudiobookshelfError("Sign in to search your library.", "unauthorized");
  // Revalidate library access and current user restrictions on EVERY request, including warm hits.
  const [user] = await Promise.all([
    absJson<{ id: string; type?: string; isActive?: boolean; permissions?: unknown; librariesAccessible?: unknown; accessibleTags?: unknown; selectedTagsNotAccessible?: unknown; mediaProgress: (MediaProgress & { libraryItemId: string })[] }>("/api/me", { connection }),
    absJson(`/api/libraries/${libraryId}`, { connection }),
  ]);
  if (user.id !== connection.userId || !Array.isArray(user.mediaProgress)) throw new AudiobookshelfError("Audiobookshelf did not return a complete progress snapshot.", "invalid_response");
  const { mediaProgress, permissions, librariesAccessible, accessibleTags, selectedTagsNotAccessible, type, isActive } = user;
  // Restriction changes invalidate cache; volatile bookmarks/session timestamps do not.
  const authorization = { permissions, librariesAccessible, accessibleTags, selectedTagsNotAccessible, type, isActive };
  const key = createHash("sha256").update(JSON.stringify([connection.baseUrl, connection.userId, libraryId, authorization])).digest("hex");
  if (refresh) buildErrors.delete(key);
  else if (buildErrors.has(key)) throw buildErrors.get(key)!;
  let catalog = catalogs.get(key);
  if (refresh || !catalog || Date.now() - catalog.updatedAt > TTL) {
    let task = building.get(key);
    if (!task) {
      preparation.set(key, { processed: 0, total: 0, verifying: false });
      task = collectCatalog((page, limit) => listLibraryItems(libraryId, connection, page, limit), (processed, total, verifying) => preparation.set(key, { processed, total, verifying })).then(items => {
        const result = { items, updatedAt: Date.now() };
        if (catalogs.size >= 8) catalogs.delete(catalogs.keys().next().value!);
        catalogs.set(key, result); return result;
      }).catch(error => {
        if (buildErrors.size >= 16) buildErrors.delete(buildErrors.keys().next().value!);
        buildErrors.set(key, error instanceof Error ? error : new Error("Unable to prepare library search."));
        throw error;
      }).finally(() => { building.delete(key); preparation.delete(key); });
      building.set(key, task);
      // A request may return 202 while the authenticated build continues. Keep failures handled.
      void task.catch(() => undefined);
    }
    if (!waitForBuild) return { items: [] as LibraryItemMinified[], updatedAt: 0, complete: false as const, preparing: preparation.get(key)! };
    catalog = await task;
  }
  const progress = new Map(mediaProgress.map(p => [p.libraryItemId, p]));
  return { items: catalog.items.map(item => ({ ...item, userMediaProgress: progress.get(item.id) ?? null })), updatedAt: catalog.updatedAt, complete: true as const };
}
