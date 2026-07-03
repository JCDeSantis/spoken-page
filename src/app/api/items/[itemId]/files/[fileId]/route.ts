import { NextRequest, NextResponse } from "next/server";
import { getLibraryItemFile } from "@/lib/audiobookshelf";
import { errorResponse, requireId } from "@/lib/server-api";

type RouteContext = {
  params: Promise<{ itemId: string; fileId: string }>;
};

const FORWARDED_HEADERS = [
  "content-length",
  "content-type",
  "etag",
  "last-modified",
] as const;

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { itemId: rawItemId, fileId: rawFileId } = await context.params;
    const itemId = requireId(rawItemId, "Item ID");
    const fileId = requireId(rawFileId, "File ID");
    const upstream = await getLibraryItemFile(itemId, fileId, {
      signal: request.signal,
    });
    const responseHeaders = new Headers();

    for (const headerName of FORWARDED_HEADERS) {
      const headerValue = upstream.headers.get(headerName);
      if (headerValue) {
        responseHeaders.set(headerName, headerValue);
      }
    }
    responseHeaders.set("cache-control", "private, no-store");

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    return errorResponse(error, "Unable to load the subtitle file.", request);
  }
}
