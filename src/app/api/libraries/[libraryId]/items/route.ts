import { NextRequest, NextResponse } from "next/server";
import { listLibraryItems } from "@/lib/audiobookshelf";

type RouteContext = {
  params: Promise<{ libraryId: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { libraryId } = await context.params;
    const payload = await listLibraryItems(libraryId);
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load library items.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
