import { NextRequest, NextResponse } from "next/server";
import { absFetch } from "@/lib/audiobookshelf";

type RouteContext = {
  params: Promise<{ itemId: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { itemId } = await context.params;
    const upstream = await absFetch(`/api/items/${itemId}/cover`);

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load cover art.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
