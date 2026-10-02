import type { LibraryItemMinified } from "./types";
import { listeningState } from "./listening-status";
import { bookSeries, compareSeries, seriesKey } from "./series";

export const QUERY_FILTERS = ["genre", "tag", "author", "narrator", "series", "language"] as const;
export const QUERY_SORTS = ["title", "recent", "progress", "author", "series", "year", "duration"] as const;
export type LibraryQuery = {
  q: string; status: "all" | "unstarted" | "in-progress" | "finished";
  want: boolean; sort: typeof QUERY_SORTS[number]; direction: "asc" | "desc";
  hideCompleted: boolean;
  page: number; limit: number;
} & Record<typeof QUERY_FILTERS[number], string>;

export function parseLibraryQuery(params: URLSearchParams): LibraryQuery {
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const raw = params.get(key); const n = raw === null ? fallback : Number(raw);
    if (raw === "" || !Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${key} must be between ${min} and ${max}.`);
    return n;
  };
  const text = (key: string) => { const s = (params.get(key) ?? "").trim(); if (s.length > 300) throw new Error(`${key} is too long.`); return s; };
  const sort = params.get("sort") ?? "title";
  const status = params.get("status") ?? "all";
  const direction = params.get("direction") ?? (["recent", "progress", "year"].includes(sort) ? "desc" : "asc");
  if (!(QUERY_SORTS as readonly string[]).includes(sort)) throw new Error("Invalid sort.");
  if (!["all", "unstarted", "in-progress", "finished"].includes(status)) throw new Error("Invalid listening status.");
  if (!["asc", "desc"].includes(direction)) throw new Error("Invalid sort direction.");
  if (params.has("want") && !["true", "false"].includes(params.get("want")!)) throw new Error("Invalid planning filter.");
  if (params.has("hideCompleted") && !["true", "false"].includes(params.get("hideCompleted")!)) throw new Error("Invalid completed filter.");
  return { ...Object.fromEntries(QUERY_FILTERS.map(key => [key, text(key)])), q: text("q"), status, sort, direction, want: params.get("want") === "true", hideCompleted: params.get("hideCompleted") === "true", page: integer("page", 0, 0, 100000), limit: integer("limit", 100, 1, 500) } as LibraryQuery;
}
const normalize = (s: string | null | undefined) => (s ?? "").normalize("NFKC").toLocaleLowerCase().trim();
const namesMatch = (s: string | null | undefined, wanted: string) => !wanted || normalize(s) === normalize(wanted) || (s ?? "").split(/,|;|\/| & /g).some(n => normalize(n) === normalize(wanted));
const compare = new Intl.Collator(undefined, { sensitivity: "base", numeric: true }).compare;

export function queryLibrary(items: LibraryItemMinified[], query: LibraryQuery, wantedIds: string[] = []) {
  const wanted = new Set(wantedIds); const needle = normalize(query.q);
  const matches = items.filter(item => {
    const m = item.media.metadata;
    return (!needle || [m.title, m.subtitle, m.authorName, m.narratorName, ...bookSeries(m).map(series => series.name)].some(s => normalize(s).includes(needle)))
      && (!query.genre || m.genres?.some(g => normalize(g) === normalize(query.genre)))
      && (!query.tag || item.media.tags?.some(t => normalize(t) === normalize(query.tag)))
      && namesMatch(m.authorName, query.author) && namesMatch(m.narratorName, query.narrator)
      && (!query.series || bookSeries(m).some(series => seriesKey(series.name) === seriesKey(query.series)))
      && (!query.language || normalize(m.language) === normalize(query.language))
      && (query.status === "all" || listeningState(item.userMediaProgress) === query.status)
      && (!query.hideCompleted || listeningState(item.userMediaProgress) !== "finished")
      && (!query.want || wanted.has(item.id));
  });
  const score = (item: LibraryItemMinified): string | number => {
    switch (query.sort) {
      case "title": return item.media.metadata.title;
      case "author": return item.media.metadata.authorName ?? "";
      case "series": return bookSeries(item.media.metadata)[0]?.name ?? "";
      case "year": return Number(item.media.metadata.publishedYear) || 0;
      case "duration": return item.media.duration;
      case "recent": return item.userMediaProgress?.lastUpdate ?? 0;
      case "progress": return item.userMediaProgress?.isFinished ? 1 : item.userMediaProgress?.progress ?? 0;
    }
  };
  matches.sort((a,b) => {
    if (query.sort === "series") {
      return compareSeries(a.media.metadata, b.media.metadata, query.direction, query.series) || compare(a.media.metadata.title,b.media.metadata.title) || a.id.localeCompare(b.id);
    }
    const x = score(a), y = score(b);
    const primary = typeof x === "number" && typeof y === "number" ? x-y : compare(String(x),String(y));
    return primary * (query.direction === "desc" ? -1 : 1) || compare(a.media.metadata.title,b.media.metadata.title) || a.id.localeCompare(b.id);
  });
  return { results: matches.slice(query.page * query.limit, (query.page + 1) * query.limit), total: matches.length, page: query.page, limit: query.limit };
}
