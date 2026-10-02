import { NextRequest } from "next/server";
import { getLibraryCatalog } from "@/lib/library-catalog";
import { parseLibraryQuery, queryLibrary } from "@/lib/library-query";
import { getUserSettings } from "@/lib/user-settings";
import { migrateLibraryPreferences } from "@/lib/library-preferences";
import { errorResponse, privateJson, requireId, InputError } from "@/lib/server-api";

type RouteContext = {
  params: Promise<{ libraryId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { libraryId: rawLibraryId } = await context.params;
    const libraryId = requireId(rawLibraryId, "Library ID");
    let query;
    try { query = parseLibraryQuery(request.nextUrl.searchParams); } catch (error) { throw new InputError((error as Error).message); }
    const [catalog, preferences] = await Promise.all([getLibraryCatalog(libraryId, request.nextUrl.searchParams.get("refresh") === "true", false), getUserSettings("library")]);
    if (!catalog.complete) return privateJson({ complete: false, preparing: catalog.preparing }, { status: 202 });
    const value = migrateLibraryPreferences(preferences.value);
    const payload = queryLibrary(catalog.items, query, value.wantToListenIds);
    const continueItem = catalog.items.filter(item => item.userMediaProgress && !item.userMediaProgress.isFinished && !value.hiddenRecentIds.includes(item.id) && ((item.userMediaProgress.startedAt ?? 0) > 0 || item.userMediaProgress.currentTime > 0)).sort((a,b) => (b.userMediaProgress?.lastUpdate ?? 0) - (a.userMediaProgress?.lastUpdate ?? 0))[0] ?? null;
    const shelfIds = new Set([...value.favoriteIds, ...value.playedRecentIds, ...value.queueIds]);
    const shelfItems = catalog.items.filter(item => shelfIds.has(item.id));
    return privateJson({ ...payload, complete: catalog.complete, updatedAt: catalog.updatedAt, libraryTotal: catalog.items.length, continueItem, shelfItems });
  } catch (error) {
    return errorResponse(error, "Unable to load library items.", request);
  }
}
