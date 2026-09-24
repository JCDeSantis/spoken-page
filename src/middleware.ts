import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  const headers = new Headers(request.headers);
  headers.set("x-request-id", requestId);
  if (!(request.method === "GET" && request.nextUrl.pathname === "/api/health")) {
    console.info(JSON.stringify({ level: "info", event: "request_received", requestId, method: request.method, path: request.nextUrl.pathname }));
  }
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = { matcher: "/api/:path*" };
