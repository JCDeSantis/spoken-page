import { NextRequest, NextResponse } from "next/server";
import { getLibraryFilterData } from "@/lib/audiobookshelf";
import { errorResponse, privateJson, requireId } from "@/lib/server-api";

type RouteContext = {
  params: Promise<{ libraryId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { libraryId: rawLibraryId } = await context.params;
    const libraryId = requireId(rawLibraryId, "Library ID");
    const payload = await getLibraryFilterData(libraryId);
    return privateJson(payload);
  } catch (error) {
    return errorResponse(error, "Unable to load library filters.", request);
  }
}
