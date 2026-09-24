import { NextResponse } from "next/server";
import { AudiobookshelfError } from "@/lib/audiobookshelf";

export class InputError extends Error {}

export function requireId(value: unknown, label = "ID") {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(value)) {
    throw new InputError(`${label} is invalid.`);
  }
  return value;
}

export function record(value: unknown, label = "Request body") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InputError(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

export function finiteNumber(value: unknown, label: string, options: { min?: number; max?: number } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new InputError(`${label} must be a finite number.`);
  if (options.min !== undefined && value < options.min) throw new InputError(`${label} must be at least ${options.min}.`);
  if (options.max !== undefined && value > options.max) throw new InputError(`${label} must be at most ${options.max}.`);
  return value;
}

export function booleanValue(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new InputError(`${label} must be a boolean.`);
  return value;
}

export function playbackPayload(value: unknown) {
  const raw = record(value);
  const duration = finiteNumber(raw.duration, "duration", { min: 0 });
  return {
    duration,
    currentTime: finiteNumber(raw.currentTime, "currentTime", { min: 0, max: duration + 1 }),
    timeListened: finiteNumber(raw.timeListened, "timeListened", { min: 0 }),
  };
}

export function errorResponse(error: unknown, fallback: string, request?: Request) {
  const requestId = request?.headers.get("x-request-id") || crypto.randomUUID();
  let status = 500;
  let message = fallback;
  if (error instanceof InputError || error instanceof SyntaxError) {
    status = 400;
    message = error instanceof SyntaxError ? "Request body must be valid JSON." : error.message;
  } else if (error instanceof AudiobookshelfError) {
    status = error.kind === "unauthorized" ? 401 : error.kind === "not_found" ? 404 : error.kind === "timeout" ? 504 : error.kind === "connection" ? 503 : 502;
    message = error.message;
  } else if (error instanceof Error) {
    message = error.message;
  }
  console.error(JSON.stringify({ level: "error", event: "api_error", requestId, path: request ? new URL(request.url).pathname : undefined, status, message, errorType: error instanceof Error ? error.name : typeof error }));
  return NextResponse.json({ error: message, requestId }, { status, headers: { "x-request-id": requestId, "cache-control": "no-store" } });
}

export function privateJson<T>(value: T, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("cache-control", "private, no-store");
  return NextResponse.json(value, { ...init, headers });
}
