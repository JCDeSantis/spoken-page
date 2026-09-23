import { LibraryItemMinified } from "@/lib/types";

export type LibrarySort = "title" | "recent" | "progress" | "author" | "year" | "duration";
export type ProgressFilter = "all" | "planned" | "unstarted" | "in-progress" | "finished";
export type BookProgressStatus = Exclude<ProgressFilter, "all">;
export type BookStatusOverrides = Record<string, BookProgressStatus>;

export function normalized(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleLowerCase();
}

export function stripSeriesSuffix(value: string | null | undefined) {
  const collapsed = (value ?? "").trim().replace(/\s+/g, " ");
  if (!collapsed) return "";

  const labeled = collapsed
    .replace(/(?:\s*[-,:]\s*)?(?:book|bk|volume|vol(?:ume)?|part)\s*\d+(?:\.\d+)?$/i, "")
    .replace(/(?:\s*[-,:]\s*)?#\s*\d+(?:\.\d+)?$/i, "")
    .trim();
  if (labeled !== collapsed) return labeled;

  const separated = collapsed.match(/^(.*\S)\s*[-:]\s*\d+(?:\.\d+)?$/);
  if (separated && separated[1].trim().split(/\s+/).length > 1) return separated[1].trim();

  const bare = collapsed.match(/^(.*\S)\s+\d+(?:\.\d+)?$/);
  if (bare && bare[1].trim().split(/\s+/).length > 1) return bare[1].trim();

  return collapsed;
}

export function seriesDisplay(value: string | null | undefined) {
  const name = stripSeriesSuffix(value);
  const full = (value ?? "").trim().replace(/\s+/g, " ");
  const suffix = full.slice(name.length);
  const number = name !== full ? suffix.match(/(\d+(?:\.\d+)?)\s*$/)?.[1] : undefined;
  return { name, number: number ?? null };
}

export function seriesIdentity(value: string | null | undefined) {
  return normalized(value)
    .replace(/(?:\s*[-,:]\s*)?(?:book|bk|volume|vol(?:ume)?|part)\s*\d+(?:\.\d+)?$/i, "")
    .replace(/(?:\s*[-,:]\s*)?#\s*\d+(?:\.\d+)?$/i, "")
    .trim();
}

export function seriesPosition(value: string | null | undefined) {
  const match = (value ?? "").match(/(?:book|bk|volume|vol(?:ume)?|part|#)\s*(\d+(?:\.\d+)?)\s*$/i);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

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

function progressSortValue(_item: LibraryItemMinified, selectedStatus?: BookProgressStatus) {
  const status = selectedBookStatus(selectedStatus);
  if (status === "finished") return 3;
  if (status === "in-progress") return 2;
  if (status === "planned") return 1;
  if (status === "unstarted") return 0;
  return -1;
}

export function getSeriesNext(items: LibraryItemMinified[], current: LibraryItemMinified | null) {
  const identity = seriesIdentity(current?.media.metadata.seriesName);
  if (!identity || !current) return null;
  const ordered = items
    .filter((item) => seriesIdentity(item.media.metadata.seriesName) === identity)
    .sort((a, b) => seriesPosition(a.media.metadata.seriesName) - seriesPosition(b.media.metadata.seriesName) ||
      normalized(a.media.metadata.title).localeCompare(normalized(b.media.metadata.title)));
  const currentIndex = ordered.findIndex((item) => item.id === current.id);
  return currentIndex >= 0 ? ordered[currentIndex + 1] ?? null : null;
}

export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "Unknown length";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}
