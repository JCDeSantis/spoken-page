import { NextRequest, NextResponse } from "next/server";
import { getLibraryFilterData } from "@/lib/audiobookshelf";

type RouteContext = {
  params: Promise<{ libraryId: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { libraryId } = await context.params;
    const payload = await getLibraryFilterData(libraryId);
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load library filters.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
