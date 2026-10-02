import { parseLibraryQuery, QUERY_FILTERS } from "./library-query";

export const BROWSE_QUERY_KEYS = ["q", "sort", "direction", "status", "want", "hideCompleted", "library", ...QUERY_FILTERS];
export function hasBrowseQuery(params: URLSearchParams) { return BROWSE_QUERY_KEYS.some(key => params.has(key)); }
export function restoreBrowsePreferences(value: unknown, libraries: string[]) {
  if (!value || typeof value !== "object") return null;
  const saved = value as { schemaVersion?: unknown; query?: unknown; libraryId?: unknown };
  if (saved.schemaVersion !== 1 || typeof saved.query !== "string" || saved.query.length > 5000) return null;
  try {
    const query = parseLibraryQuery(new URLSearchParams(saved.query));
    const libraryId = typeof saved.libraryId === "string" && libraries.includes(saved.libraryId) ? saved.libraryId : null;
    return { query, libraryId };
  } catch { return null; }
}
