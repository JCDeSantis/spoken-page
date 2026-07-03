import { NextRequest, NextResponse } from "next/server";
import { closeSession } from "@/lib/audiobookshelf";
import { errorResponse, playbackPayload, privateJson, requireId } from "@/lib/server-api";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const payload = playbackPayload(await request.json());
    const { sessionId: rawSessionId } = await context.params;
    const sessionId = requireId(rawSessionId, "Session ID");
    const session = await closeSession(sessionId, payload);
    return privateJson({ ok: true, session });
  } catch (error) {
    return errorResponse(error, "Unable to close the playback session.", request);
  }
}
