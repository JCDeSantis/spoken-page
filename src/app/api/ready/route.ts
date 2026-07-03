import { getConnectionPolicy } from "@/lib/audiobookshelf";
import { APP_VERSION } from "@/lib/app-version";

export function GET() {
  try {
    const policy = getConnectionPolicy();
    const ready = process.env.NODE_ENV !== "production" || (policy.secretConfigured && !policy.requiresServerConfiguration);
    return Response.json(
      { ok: ready, service: "spoken-page", version: APP_VERSION, checks: { stableSecret: policy.secretConfigured, connectionPolicy: !policy.requiresServerConfiguration } },
      { status: ready ? 200 : 503, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Readiness check failed." }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
