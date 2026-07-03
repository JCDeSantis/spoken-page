import { NextRequest, NextResponse } from "next/server";
import { absFetch } from "@/lib/audiobookshelf";
import { errorResponse } from "@/lib/server-api";

const FORWARDED_RESPONSE_HEADERS = [
  "accept-ranges",
  "content-length",
  "content-range",
  "content-type",
  "etag",
  "last-modified",
] as const;

export async function GET(request: NextRequest) {
  const relativePath = request.nextUrl.searchParams.get("path");

  if (!relativePath) {
    return NextResponse.json({ error: "Audio path is required." }, { status: 400 });
  }

  try {
    const headers = new Headers();
    const range = request.headers.get("range");

    if (range) {
      headers.set("Range", range);
    }

    const upstream = await absFetch(relativePath, {
      headers,
      signal: request.signal,
    });
    const responseHeaders = new Headers();

    for (const headerName of FORWARDED_RESPONSE_HEADERS) {
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
    return errorResponse(error, "Unable to stream audio.", request);
  }
}
