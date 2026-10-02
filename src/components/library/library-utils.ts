import { parseSeriesLabel, compareSeries, nextSeriesBook } from "@/lib/series";
import { LibraryItemMinified } from "@/lib/types";

export type LibrarySort = "title" | "recent" | "progress" | "author" | "series" | "year" | "duration";
export type ProgressFilter = "all" | "planned" | "unstarted" | "in-progress" | "finished";
export type BookProgressStatus = Exclude<ProgressFilter, "all">;
export type BookStatusOverrides = Record<string, BookProgressStatus>;

export function unloadedShelfIds(
  ids: string[],
  pagedItems: LibraryItemMinified[],
  cachedItems: Record<string, LibraryItemMinified>,
  requestedIds: Set<string>,
) {
  const pagedIds = new Set(pagedItems.map((item) => item.id));
  return [...new Set(ids)].filter((id) => id && !pagedIds.has(id) && !cachedItems[id] && !requestedIds.has(id));
}

export function libraryItemsById(
  libraryId: string,
  pagedItems: LibraryItemMinified[],
  cachedItems: Record<string, LibraryItemMinified>,
) {
  return new Map<string, LibraryItemMinified>(
    [...Object.values(cachedItems), ...pagedItems]
      .filter((item) => item.libraryId === libraryId)
      .map((item) => [item.id, item] as const),
  );
}

export function normalized(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleLowerCase();
}

export function stripSeriesSuffix(value: string | null | undefined) { return parseSeriesLabel(value).name; }
export function seriesDisplay(value: string | null | undefined) { return parseSeriesLabel(value); }
export function seriesIdentity(value: string | null | undefined) { return normalized(parseSeriesLabel(value).name); }
export function seriesPosition(value: string | null | undefined) { const n = parseSeriesLabel(value).number; return n === null ? Number.POSITIVE_INFINITY : Number(n); }

export function selectedBookStatus(status?: BookProgressStatus): BookProgressStatus | null {
  return status ?? null;
}

export function sortLibraryItems(items: LibraryItemMinified[], sort: LibrarySort, statusOverrides: BookStatusOverrides = {}) {
  return [...items].sort((left, right) => {
    const leftMetadata = left.media.metadata;
    const rightMetadata = right.media.metadata;
    switch (sort) {
      case "recent":
        return (right.userMediaProgress?.lastUpdate ?? 0) - (left.userMediaProgress?.lastUpdate ?? 0);
      case "progress":
        return progressSortValue(right, statusOverrides[right.id]) - progressSortValue(left, statusOverrides[left.id]);
      case "author":
        return normalized(leftMetadata.authorName).localeCompare(normalized(rightMetadata.authorName)) ||
          normalized(leftMetadata.title).localeCompare(normalized(rightMetadata.title));
      case "series":
        return compareSeries(leftMetadata, rightMetadata) || normalized(leftMetadata.title).localeCompare(normalized(rightMetadata.title));
      case "year":
        return Number(rightMetadata.publishedYear ?? 0) - Number(leftMetadata.publishedYear ?? 0) ||
          normalized(leftMetadata.title).localeCompare(normalized(rightMetadata.title));
      case "duration":
        return right.media.duration - left.media.duration;
      default:
        return normalized(leftMetadata.title).localeCompare(normalized(rightMetadata.title));
    }
  });
}

function progressSortValue(item: LibraryItemMinified, _selectedStatus?: BookProgressStatus) {
  return item.userMediaProgress?.isFinished ? 1 : item.userMediaProgress?.progress ?? 0;
}

export const getSeriesNext = nextSeriesBook;

export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "Unknown length";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}
