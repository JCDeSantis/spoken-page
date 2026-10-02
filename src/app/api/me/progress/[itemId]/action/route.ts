import { NextRequest } from "next/server";
import { getLibraryItem, updateProgress, absFetch } from "@/lib/audiobookshelf";
import { progressForAction, type ProgressAction } from "@/lib/listening-status";
import { record, requireId, InputError, errorResponse, privateJson } from "@/lib/server-api";

export async function POST(request: NextRequest, context: { params: Promise<{ itemId: string }> }) {
  try {
    const itemId = requireId((await context.params).itemId, "Item ID");
    const body = record(await request.json());
    if (!["complete", "unfinished", "restart"].includes(String(body.action))) throw new InputError("Invalid progress action.");
    const action = body.action as ProgressAction;
    const item = await getLibraryItem(itemId);
    const next = progressForAction(action, item.userMediaProgress, item.media.duration);
    if (action === "restart") {
      // ABS exposes deletion specifically to reset all progress fields; PATCH may retain startedAt.
      if (item.userMediaProgress) {
        const progressId = requireId(item.userMediaProgress.id, "Progress record ID");
        await absFetch(`/api/me/progress/${encodeURIComponent(progressId)}`, { method: "DELETE" });
      }
    } else {
      await updateProgress(itemId, next);
    }
    return privateJson({ item: { ...item, userMediaProgress: action === "restart" ? null : next } });
  } catch (error) { return errorResponse(error, "Unable to change listening progress.", request); }
}
