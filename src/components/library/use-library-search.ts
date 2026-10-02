"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LibraryItemMinified } from "@/lib/types";

type SearchResponse = { results: LibraryItemMinified[]; total: number; page: number; limit: number; complete: boolean; updatedAt: number; continueItem: LibraryItemMinified | null; shelfItems: LibraryItemMinified[]; error?: string };
type Preparation = { processed: number; total: number; verifying: boolean };

export function useLibrarySearch(libraryId: string, query: string, enabled: boolean) {
  const [items, setItems] = useState<LibraryItemMinified[]>([]);
  const [page, setPage] = useState<SearchResponse | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [loadedLibrary, setLoadedLibrary] = useState("");
  const [revision, setRevision] = useState(0);
  const [preparing, setPreparing] = useState<Preparation | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const context = useRef("");
  const contextKey = `${libraryId}:${query}:${revision}`;
  // Invalidate synchronously, including the interval before the debounce effect runs.
  if (context.current !== contextKey) { context.current = contextKey; generation.current++; }
  const refreshCatalog = useRef(false);

  const request = useCallback(async (nextPage: number, refresh: boolean, token: number) => {
    requestRef.current?.abort();
    const controller = new AbortController(); requestRef.current = controller;
    setState("loading"); setError(null);
    const params = new URLSearchParams(query); params.set("page", String(nextPage)); params.set("limit", "100");
    if (refresh) params.set("refresh", "true");
    try {
      let response: Response;
      let payload: SearchResponse & { preparing?: Preparation };
      do {
        response = await fetch(`/api/libraries/${encodeURIComponent(libraryId)}/items?${params}`, { signal: controller.signal });
        payload = await response.json() as typeof payload;
        if (controller.signal.aborted || token !== generation.current) return;
        if (response.status === 202) {
          setPreparing(payload.preparing ?? null);
          params.delete("refresh");
          await new Promise<void>((resolve, reject) => {
            const onAbort = () => { window.clearTimeout(timer); reject(new Error("Search canceled")); };
            const timer = window.setTimeout(() => { controller.signal.removeEventListener("abort", onAbort); resolve(); }, 750);
            controller.signal.addEventListener("abort", onAbort, { once: true });
          });
        }
      } while (response.status === 202);
      if (!response.ok || !payload.complete || !Array.isArray(payload.results)) throw new Error(payload.error ?? "Library search is incomplete. Please try again.");
      if (controller.signal.aborted || token !== generation.current) return;
      setItems(current => nextPage === 0 ? payload.results : [...current, ...payload.results.filter(item => !current.some(known => known.id === item.id))]);
      setPage(payload); setLoadedLibrary(libraryId); setPreparing(null); setState("idle");
    } catch (cause) {
      if (controller.signal.aborted || token !== generation.current) return;
      setError(cause instanceof Error ? cause.message : "Unable to search the library."); setState("error");
    }
  }, [libraryId, query]);

  useEffect(() => {
    requestRef.current?.abort();
    if (!enabled || !libraryId) return;
    setState("loading"); setError(null); setPreparing(null); setPage(null);
    if (loadedLibrary !== libraryId) setItems([]);
    const token = generation.current;
    const timeout = window.setTimeout(() => { const refresh = refreshCatalog.current; refreshCatalog.current = false; void request(0, refresh, token); }, 280);
    return () => { window.clearTimeout(timeout); requestRef.current?.abort(); };
  }, [libraryId, query, revision, enabled, request]);

  const refresh = useCallback((catalog = false) => { refreshCatalog.current ||= catalog; generation.current++; setRevision(value => value + 1); }, []);
  useEffect(() => {
    const onFocus = () => refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 60_000);
    window.addEventListener("focus", onFocus); window.addEventListener("online", onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); window.removeEventListener("online", onFocus); };
  }, [refresh]);
  return { items, setItems, page, state, error, loadedLibrary, preparing, refresh, loadMore: () => { if (state === "idle" && page && items.length < page.total) void request(page.page + 1, false, generation.current); } };
}
