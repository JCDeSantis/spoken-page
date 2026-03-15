import { NextRequest, NextResponse } from "next/server";
import { syncSession } from "@/lib/audiobookshelf";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const payload = (await request.json()) as {
      currentTime: number;
      timeListened: number;
      duration: number;
    };
    const { sessionId } = await context.params;
    const session = await syncSession(sessionId, payload);
    return NextResponse.json({ ok: true, session });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sync playback progress.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
