import type { LibraryItemMetadata, LibraryItemMinified } from "./types";

export type SeriesEntry = { name: string; number: string | null; id?: string };
const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
export const seriesKey = (name: string) => name.normalize("NFKC").trim().toLocaleLowerCase();

export function parseSeriesLabel(value?: string | null): SeriesEntry {
  const full = (value ?? "").trim().replace(/\s+/g, " ");
  const explicit = full.match(/^(.*?)\s*(?:[-,:]\s*)?(?:book|bk|volume|vol|part|#)\s*(\d+(?:\.\d+)?)$/i);
  const bare = full.match(/^(.*\S)\s+(?:[-:]\s*)?(\d+(?:\.\d+)?)$/);
  const match = explicit ?? (bare && bare[1].trim().split(/\s+/).length > 1 ? bare : null);
  return { name: match ? match[1].trim().replace(/[-,:]\s*$/, "").trim() : full, number: match?.[2] ?? null };
}

export function bookSeries(metadata: LibraryItemMetadata): SeriesEntry[] {
  // Expanded ABS metadata is authoritative; minified catalogs may only supply seriesName.
  const structured = metadata.series?.filter(entry => entry && typeof entry.name === "string" && entry.name.trim());
  if (structured?.length) return structured.map(entry => ({ name: entry.name.trim(), id: entry.id, number: entry.sequence !== null && entry.sequence !== undefined && String(entry.sequence).trim() ? String(entry.sequence).trim() : null }));
  // Split at numbered membership boundaries, preserving commas inside a series title.
  return (metadata.seriesName ?? "").split(/(?<=\d)\s*[,;]\s*(?=\S)/).map(parseSeriesLabel).filter(entry => entry.name);
}

export function compareSeries(a: LibraryItemMetadata, b: LibraryItemMetadata, direction: "asc" | "desc" = "asc", selectedSeries?: string) {
  const membership = (metadata: LibraryItemMetadata) => {
    const entries = bookSeries(metadata);
    return (selectedSeries && entries.find(entry => seriesKey(entry.name) === seriesKey(selectedSeries))) || entries[0];
  };
  const left = membership(a), right = membership(b);
  if (Boolean(left) !== Boolean(right)) return left ? -1 : 1;
  if (!left || !right) return 0;
  const nameOrder = collator.compare(left.name, right.name);
  const leftNumber = left.number === null ? NaN : Number(left.number), rightNumber = right.number === null ? NaN : Number(right.number);
  if (!nameOrder && Number.isFinite(leftNumber) !== Number.isFinite(rightNumber)) return Number.isFinite(leftNumber) ? -1 : 1;
  const positionOrder = Number.isFinite(leftNumber) && Number.isFinite(rightNumber) ? leftNumber - rightNumber : 0;
  return (nameOrder || positionOrder) * (direction === "desc" ? -1 : 1);
}

export function nextSeriesBook(items: LibraryItemMinified[], current: LibraryItemMinified | null) {
  if (!current) return null;
  for (const membership of bookSeries(current.media.metadata)) {
    if (membership.number === null || !Number.isFinite(Number(membership.number))) continue;
    const matches = items.filter(item => item.libraryId === current.libraryId && item.id !== current.id).flatMap(item => {
      const entry = bookSeries(item.media.metadata).find(series => seriesKey(series.name) === seriesKey(membership.name));
      const position = entry?.number === null || entry?.number === undefined ? NaN : Number(entry.number);
      return Number.isFinite(position) && position > Number(membership.number) ? [{ item, position }] : [];
    }).sort((a,b) => a.position-b.position || collator.compare(a.item.media.metadata.title,b.item.media.metadata.title) || a.item.id.localeCompare(b.item.id));
    if (matches[0]) return matches[0].item;
  }
  return null;
}
