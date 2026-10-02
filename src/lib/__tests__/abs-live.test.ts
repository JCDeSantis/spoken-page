import { describe, it, expect } from "vitest";
import { loadEnvConfig } from "@next/env";
import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readSession } from "../session-store";
import { absJson, absFetch, listLibraries, listLibraryItems, getLibraryItem, type AudiobookshelfConnection } from "../audiobookshelf";

const server = process.env.SPOKEN_PAGE_CHECK_SERVER;
describe.skipIf(!server)("read-only deployed Audiobookshelf compatibility", () => {
  it("checks authenticated shapes and range support without changing listening history", async () => {
    loadEnvConfig(process.cwd());
    const directory = path.join(process.env.SPOKEN_PAGE_DATA_DIR || path.join(process.cwd(), "data"), "sessions");
    let connection: AudiobookshelfConnection | undefined;
    for (const file of await readdir(directory)) {
      if (!/^[A-Za-z0-9_-]{40,80}\.json$/.test(file)) continue;
      const sessionId = file.slice(0, -5);
      const candidate = await readSession(sessionId);
      if (candidate?.baseUrl.replace(/\/$/, "") === server!.replace(/\/$/, "")) connection = { ...candidate, sessionId };
    }
    if (!connection) throw new Error("No saved session matches this exact server. Sign in to the review build first.");
    // The app's existing client handles token refresh and persists rotating credentials.
    const me = await absJson<{ id: string; permissions?: { download?: boolean }; mediaProgress: unknown[] }>("/api/me", { connection });
    expect(Array.isArray(me.mediaProgress)).toBe(true);
    const libraries = await listLibraries(connection);
    const report: Record<string, unknown> = { server: new URL(server!).hostname, checkedAt: new Date().toISOString(), authenticated: true, progressSnapshot: true, audiobookLibraries: libraries.length, downloadPermission: me.permissions?.download };
    const status = await fetch(new URL("/status", server!), { signal: AbortSignal.timeout(10000) }).then(response => response.json());
    report.version = status.serverVersion ?? status.version;
    const library = libraries[0];
    if (library) {
      const first = await listLibraryItems(library.id, connection, 0, 100);
      report.pagination = { total: first.total, returned: first.results.length, page: first.page, limit: first.limit };
      if (first.total > 100) {
        const last = await listLibraryItems(library.id, connection, Math.floor((first.total - 1) / 100), 100);
        expect(last.total).toBe(first.total);
        report.lastPage = { returned: last.results.length, matchingTotal: true };
      }
      const sample = first.results[0];
      if (sample) {
        const search = await absJson<Record<string, unknown>>(`/api/libraries/${library.id}/search?q=${encodeURIComponent(sample.media.metadata.title)}&limit=1`, { connection });
        report.search = { resultKeys: Object.keys(search), hasTotal: typeof search.total === "number", returnedBooks: Array.isArray(search.book) ? search.book.length : null };
        const item = await getLibraryItem(sample.id, connection);
        report.trackMetadata = { tracks: item.media.tracks?.length ?? 0, chapters: item.media.chapters?.length ?? 0, files: item.libraryFiles?.length ?? 0, progressLoaded: Object.hasOwn(item, "userMediaProgress") };
        const file = item.libraryFiles?.find(file => file.fileType === "audio" || /\.(mp3|m4b|m4a|flac|ogg)$/i.test(file.metadata?.filename ?? ""));
        if (file && me.permissions?.download !== false) {
          const response = await absFetch(`/api/items/${sample.id}/file/${encodeURIComponent(file.ino)}/download`, { connection, headers: { Range: "bytes=0-0" } });
          report.audioRange = { status: response.status, contentRange: response.headers.get("content-range"), hasValidator: response.headers.has("etag") || response.headers.has("last-modified"), mime: response.headers.get("content-type") };
          await response.body?.cancel();
        }
      }
    }
    report.sessionImport = "Not invoked: mutates listening history. Replay semantics remain a required gate for the offline phase.";
    console.log("ABS_CAPABILITIES " + JSON.stringify(report));
    if (process.env.SPOKEN_PAGE_CHECK_REPORT) await writeFile(process.env.SPOKEN_PAGE_CHECK_REPORT, JSON.stringify(report, null, 2) + "\n");
  }, 120000);
});
