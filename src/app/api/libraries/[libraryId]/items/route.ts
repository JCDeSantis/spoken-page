import { NextRequest, NextResponse } from "next/server";
import { listLibraryItems } from "@/lib/audiobookshelf";
import { errorResponse, privateJson, requireId, InputError } from "@/lib/server-api";

type RouteContext = {
  params: Promise<{ libraryId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { libraryId: rawLibraryId } = await context.params;
    const libraryId = requireId(rawLibraryId, "Library ID");
    const page = Number(request.nextUrl.searchParams.get("page") ?? 0);
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 100);
    if (!Number.isInteger(page) || page < 0) throw new InputError("page must be a non-negative integer.");
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new InputError("limit must be an integer between 1 and 500.");
    const payload = await listLibraryItems(libraryId, undefined, page, limit);
    return privateJson(payload);
  } catch (error) {
    return errorResponse(error, "Unable to load library items.", request);
  }
}
