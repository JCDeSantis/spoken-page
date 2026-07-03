import { NextRequest, NextResponse } from "next/server";
import {
  authorize,
  clearConnection,
  listLibraries,
  loginToAudiobookshelf,
  sanitizeConnectionInput,
  setConnection,
} from "@/lib/audiobookshelf";
import type { AudiobookshelfConnection } from "@/lib/audiobookshelf";
import type { AuthorizedSummary } from "@/lib/types";
import { errorResponse, privateJson, record, InputError } from "@/lib/server-api";

const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_ATTEMPT_LIMIT = 20;
const loginAttempts = new Map<string, { count: number; resetsAt: number }>();

function loginAttemptKeys(request: NextRequest, username: string) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  const userKey = username.trim().toLowerCase();
  return [`user:${userKey}`, `ip:${request.headers.get("x-real-ip") || forwarded || "local"}`];
}

function recordLoginAttempt(key: string) {
  const now = Date.now();
  if (loginAttempts.size > 10_000) {
    for (const [entryKey, value] of loginAttempts) {
      if (value.resetsAt <= now) loginAttempts.delete(entryKey);
    }
    if (loginAttempts.size > 10_000) loginAttempts.clear();
  }
  const current = loginAttempts.get(key);
  if (!current || current.resetsAt <= now) {
    loginAttempts.set(key, { count: 1, resetsAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  if (current.count >= LOGIN_ATTEMPT_LIMIT) return false;
  current.count += 1;
  return true;
}

export async function POST(request: NextRequest) {
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 8 * 1024) {
      return privateJson({ error: "Login request is too large." }, { status: 413 });
    }
    const body = record(await request.json());
    if (typeof body.baseUrl !== "string") throw new InputError("baseUrl must be a string.");
    let connection: AudiobookshelfConnection;
    let profile: AuthorizedSummary;
    let attemptKeys: string[] = [];
    if (typeof body.token === "string") {
      const sanitized = sanitizeConnectionInput(body.baseUrl, body.token);
      connection = { ...sanitized, deviceId: crypto.randomUUID() };
      profile = await authorize(connection);
      connection.userId = profile.userId;
    } else {
      if (typeof body.username !== "string" || typeof body.password !== "string") {
        throw new InputError("username and password must be strings.");
      }
      attemptKeys = loginAttemptKeys(request, body.username);
      if (!attemptKeys.every(recordLoginAttempt)) {
        return privateJson(
          { error: "Too many login attempts. Wait a few minutes and try again." },
          { status: 429, headers: { "Retry-After": "600" } },
        );
      }
      ({ connection, profile } = await loginToAudiobookshelf(body.baseUrl, body.username, body.password));
    }
    const libraries = await listLibraries(connection);

    await setConnection(connection);
    for (const attemptKey of attemptKeys) loginAttempts.delete(attemptKey);

    return privateJson({
      ok: true,
      profile,
      libraries,
    });
  } catch (error) {
    return errorResponse(error, "Could not connect to Audiobookshelf.", request);
  }
}

export async function DELETE() {
  await clearConnection();
  return privateJson({ ok: true });
}
