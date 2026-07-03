import { APP_VERSION } from "@/lib/app-version";

export function GET() {
  return Response.json({ ok: true, service: "spoken-page", version: APP_VERSION }, { headers: { "cache-control": "no-store" } });
}
