import { NextRequest, NextResponse } from "next/server";
import { getLibraryItem } from "@/lib/audiobookshelf";
import { errorResponse, privateJson, requireId } from "@/lib/server-api";

type RouteContext = {
  params: Promise<{ itemId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { itemId: rawItemId } = await context.params;
    const itemId = requireId(rawItemId, "Item ID");
    const item = await getLibraryItem(itemId);
    return privateJson(item);
  } catch (error) {
    return errorResponse(error, "Unable to load the selected book.", request);
  }
}
