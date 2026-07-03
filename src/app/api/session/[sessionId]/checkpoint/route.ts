import { NextRequest } from "next/server";
import { closeSession, syncSession, updateProgress, type PlaybackCheckpoint } from "@/lib/audiobookshelf";
import { booleanValue, errorResponse, finiteNumber, privateJson, record, requireId, InputError } from "@/lib/server-api";

type RouteContext = { params: Promise<{ sessionId: string }> };
const latestSequences = new Map<string, number>();
const sessionQueues = new Map<string, Promise<unknown>>();

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { sessionId: rawSessionId } = await context.params;
    const sessionId = requireId(rawSessionId, "Session ID");
    const body = record(await request.json());
    const sequence = finiteNumber(body.sequence, "sequence", { min: 0 });
    if (!Number.isInteger(sequence)) throw new InputError("sequence must be an integer.");
    const action = body.action;
    if (action !== "sync" && action !== "close") throw new InputError("action must be sync or close.");
    const duration = finiteNumber(body.duration, "duration", { min: 0 });
    const currentTime = finiteNumber(body.currentTime, "currentTime", { min: 0, max: Math.max(duration, 0) + 1 });
    const timeListened = finiteNumber(body.timeListened, "timeListened", { min: 0 });
    let progress: PlaybackCheckpoint["progress"];
    if (body.progress !== undefined) {
      const raw = record(body.progress, "progress");
      progress = {
        itemId: requireId(raw.itemId, "Item ID"),
        progress: finiteNumber(raw.progress, "progress.progress", { min: 0, max: 1 }),
        isFinished: booleanValue(raw.isFinished, "progress.isFinished"),
        finishedAt: raw.finishedAt === null || raw.finishedAt === undefined ? raw.finishedAt : finiteNumber(raw.finishedAt, "progress.finishedAt", { min: 0 }),
        startedAt: raw.startedAt === undefined ? undefined : finiteNumber(raw.startedAt, "progress.startedAt", { min: 0 }),
      };
    }
    const previousWork = sessionQueues.get(sessionId) ?? Promise.resolve();
    const work = previousWork.catch(() => undefined).then(async () => {
      const previous = latestSequences.get(sessionId);
      if (previous !== undefined && sequence <= previous) return { stale: true, sequence: previous, session: null };
      // Apply the absolute/idempotent progress write before the session's listened-time
      // delta so a retry cannot count the same listening interval twice.
      if (progress) {
        await updateProgress(progress.itemId, {
          duration,
          currentTime,
          progress: progress.progress,
          isFinished: progress.isFinished,
          finishedAt: progress.finishedAt,
          startedAt: progress.startedAt,
        });
      }
      const sessionPayload = { currentTime, timeListened, duration };
      const session = action === "close"
        ? await closeSession(sessionId, sessionPayload)
        : await syncSession(sessionId, sessionPayload);
      latestSequences.set(sessionId, sequence);
      return { stale: false, sequence, session };
    });
    sessionQueues.set(sessionId, work);
    const result = await work;
    if (sessionQueues.get(sessionId) === work) sessionQueues.delete(sessionId);
    if (latestSequences.size > 10_000) latestSequences.clear();
    return privateJson({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error, "Unable to save playback checkpoint.", request);
  }
}
