import { NextRequest, NextResponse } from "next/server";
import {
  authorize,
  clearConnection,
  listLibraries,
  sanitizeConnectionInput,
  setConnection,
} from "@/lib/audiobookshelf";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { baseUrl?: string; token?: string };
    const sanitized = sanitizeConnectionInput(body.baseUrl ?? "", body.token ?? "");
    const connection = {
      ...sanitized,
      deviceId: crypto.randomUUID(),
    };

    const [profile, libraries] = await Promise.all([
      authorize(connection),
      listLibraries(connection),
    ]);

    await setConnection(connection);

    return NextResponse.json({
      ok: true,
      profile,
      libraries,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not connect to Audiobookshelf.";

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 400 },
    );
  }
}

export async function DELETE() {
  await clearConnection();
  return NextResponse.json({ ok: true });
}
