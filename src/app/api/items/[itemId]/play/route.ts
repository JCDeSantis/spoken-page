import { NextRequest, NextResponse } from "next/server";
import { startPlaybackSession } from "@/lib/audiobookshelf";
import { errorResponse, privateJson, requireId } from "@/lib/server-api";

type RouteContext = {
  params: Promise<{ itemId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { itemId: rawItemId } = await context.params;
    const itemId = requireId(rawItemId, "Item ID");
    const session = await startPlaybackSession(itemId);
    return privateJson(session);
  } catch (error) {
    return errorResponse(error, "Unable to start synced playback.", request);
  }
}
