import { NextRequest, NextResponse } from "next/server";
import { getUserSettings, setUserSettings } from "@/lib/user-settings";

type RouteContext = { params: Promise<{ namespace: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { namespace } = await context.params;
    return NextResponse.json(await getUserSettings(namespace), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load settings." },
      { status: 400 },
    );
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > 128 * 1024) {
      return NextResponse.json({ error: "Settings payload is too large." }, { status: 413 });
    }
    const { namespace } = await context.params;
    const body = (await request.json()) as { value?: unknown };
    if (!("value" in body)) {
      return NextResponse.json({ error: "A settings value is required." }, { status: 400 });
    }
    return NextResponse.json({ ok: true, ...(await setUserSettings(namespace, body.value)) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save settings." },
      { status: 400 },
    );
  }
}
