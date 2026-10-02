import { NextRequest, NextResponse } from "next/server";
import { getLibraryItem } from "@/lib/audiobookshelf";
import { getLibraryCatalog } from "@/lib/library-catalog";
import { bookSeries, nextSeriesBook } from "@/lib/series";
import { errorResponse, privateJson, requireId } from "@/lib/server-api";

type RouteContext = {
  params: Promise<{ itemId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { itemId: rawItemId } = await context.params;
    const itemId = requireId(rawItemId, "Item ID");
    const item = await getLibraryItem(itemId);
    if (!bookSeries(item.media.metadata).length) return privateJson({ ...item, nextInSeries: null });
    try {
      const catalog = await getLibraryCatalog(item.libraryId);
      return privateJson({ ...item, nextInSeries: nextSeriesBook(catalog.items, item), nextInSeriesError: null });
    } catch {
      // Book details remain usable if the full catalog cannot currently be read.
      return privateJson({ ...item, nextInSeries: null, nextInSeriesError: "The next book could not be checked. Reopen these details to retry." });
    }
  } catch (error) {
    return errorResponse(error, "Unable to load the selected book.", request);
  }
}
