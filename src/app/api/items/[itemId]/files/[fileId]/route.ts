import { NextRequest, NextResponse } from "next/server";
import { getLibraryItemFile } from "@/lib/audiobookshelf";

type RouteContext = {
  params: Promise<{ itemId: string; fileId: string }>;
};

const FORWARDED_HEADERS = [
  "cache-control",
  "content-length",
  "content-type",
  "etag",
  "last-modified",
] as const;

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { itemId, fileId } = await context.params;
    const upstream = await getLibraryItemFile(itemId, fileId);
    const responseHeaders = new Headers();

    for (const headerName of FORWARDED_HEADERS) {
      const headerValue = upstream.headers.get(headerName);
      if (headerValue) {
        responseHeaders.set(headerName, headerValue);
      }
    }

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load the subtitle file.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
