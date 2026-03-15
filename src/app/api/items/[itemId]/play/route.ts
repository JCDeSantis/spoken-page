import { NextRequest, NextResponse } from "next/server";
import { startPlaybackSession } from "@/lib/audiobookshelf";

type RouteContext = {
  params: Promise<{ itemId: string }>;
};

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const { itemId } = await context.params;
    const session = await startPlaybackSession(itemId);
    return NextResponse.json(session);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start synced playback.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
