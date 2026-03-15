import { NextRequest, NextResponse } from "next/server";
import { updateProgress } from "@/lib/audiobookshelf";

type RouteContext = {
  params: Promise<{ itemId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { itemId } = await context.params;
    const body = (await request.json()) as {
      duration: number;
      progress: number;
      currentTime: number;
      isFinished: boolean;
      finishedAt?: number | null;
      startedAt?: number;
    };

    await updateProgress(itemId, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save media progress.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
