import { NextRequest, NextResponse } from "next/server";
import { getLibraryItem } from "@/lib/audiobookshelf";

type RouteContext = {
  params: Promise<{ itemId: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { itemId } = await context.params;
    const item = await getLibraryItem(itemId);
    return NextResponse.json(item);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load the selected book.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
