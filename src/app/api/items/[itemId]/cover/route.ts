import { NextRequest, NextResponse } from "next/server";
import { absFetch } from "@/lib/audiobookshelf";
import { errorResponse, requireId } from "@/lib/server-api";

type RouteContext = {
  params: Promise<{ itemId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { itemId: rawItemId } = await context.params;
    const itemId = requireId(rawItemId, "Item ID");
    const upstream = await absFetch(`/api/items/${itemId}/cover`, {
      signal: request.signal,
    });

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return errorResponse(error, "Unable to load cover art.", request);
  }
}
