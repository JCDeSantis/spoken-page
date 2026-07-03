import { NextRequest, NextResponse } from "next/server";
import { updateProgress } from "@/lib/audiobookshelf";
import { booleanValue, errorResponse, finiteNumber, privateJson, record, requireId } from "@/lib/server-api";

type RouteContext = {
  params: Promise<{ itemId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { itemId: rawItemId } = await context.params;
    const itemId = requireId(rawItemId, "Item ID");
    const raw = record(await request.json());
    const duration = finiteNumber(raw.duration, "duration", { min: 0 });
    const body = {
      duration,
      progress: finiteNumber(raw.progress, "progress", { min: 0, max: 1 }),
      currentTime: finiteNumber(raw.currentTime, "currentTime", { min: 0, max: duration + 1 }),
      isFinished: booleanValue(raw.isFinished, "isFinished"),
      finishedAt: raw.finishedAt === null || raw.finishedAt === undefined ? raw.finishedAt : finiteNumber(raw.finishedAt, "finishedAt", { min: 0 }),
      startedAt: raw.startedAt === undefined ? undefined : finiteNumber(raw.startedAt, "startedAt", { min: 0 }),
    };
    await updateProgress(itemId, body);
    return privateJson({ ok: true });
  } catch (error) {
    return errorResponse(error, "Unable to save media progress.", request);
  }
}
