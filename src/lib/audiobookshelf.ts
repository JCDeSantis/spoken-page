import { APP_VERSION } from "@/lib/app-version";
import { cookies } from "next/headers";
import { createSession, deleteSession, readSession, updateSession } from "@/lib/session-store";
import {
  AuthorizedSummary,
  LibraryFilterData,
  LibraryItemsResponse,
  LibraryListResponse,
  LibraryItemExpanded,
  PlaybackSession,
} from "@/lib/types";

const SESSION_COOKIE = "spoken_page_session";
const LEGACY_CONNECTION_COOKIE = "abs_sync_connection";
const APP_CLIENT_NAME = "Spoken Page";
const APP_CLIENT_VERSION = APP_VERSION;
const CONNECTION_SECRET_ENV = "SPOKEN_PAGE_SECRET";
const LOCKED_BASE_URL_ENV = "SPOKEN_PAGE_ABS_BASE_URL";
const ALLOWED_BASE_URLS_ENV = "SPOKEN_PAGE_ALLOWED_BASE_URLS";
const UNSAFE_CUSTOM_CONNECTIONS_ENV = "SPOKEN_PAGE_ALLOW_UNSAFE_CUSTOM_CONNECTIONS";

const UPSTREAM_TIMEOUT_MS = 15_000;

export type AudiobookshelfErrorKind = "unauthorized" | "not_found" | "timeout" | "connection" | "upstream" | "invalid_response";
export class AudiobookshelfError extends Error {
  constructor(message: string, public readonly kind: AudiobookshelfErrorKind, public readonly upstreamStatus?: number) {
    super(message);
    this.name = "AudiobookshelfError";
  }
}

export type AudiobookshelfConnection = {
  baseUrl: string;
  token: string;
  deviceId: string;
  userId?: string;
  refreshToken?: string;
  sessionId?: string;
};

export type ConnectionPolicy = {
  lockedBaseUrl: string | null;
  allowedBaseUrls: string[];
  customBaseUrlEnabled: boolean;
  requiresServerConfiguration: boolean;
  secretConfigured: boolean;
};

type FetchInit = RequestInit & {
  connection?: AudiobookshelfConnection;
  skipAuthRefresh?: boolean;
};

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim();
  const parsed = new URL(trimmed);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Audiobookshelf URL must use http or https.");
  }

  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  parsed.search = "";
  parsed.hash = "";

  return parsed.toString().replace(/\/$/, "");
}

function isUnsafeCustomConnectionsEnabled() {
  return process.env[UNSAFE_CUSTOM_CONNECTIONS_ENV]?.trim().toLowerCase() === "true";
}

function getLockedBaseUrl() {
  const configuredBaseUrl = process.env[LOCKED_BASE_URL_ENV]?.trim();
  return configuredBaseUrl ? normalizeBaseUrl(configuredBaseUrl) : null;
}

function parseAllowedBaseUrls() {
  const rawValue = process.env[ALLOWED_BASE_URLS_ENV]?.trim();

  if (!rawValue) {
    return [] as string[];
  }

  return rawValue
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => normalizeBaseUrl(entry));
}

function dedupeBaseUrls(entries: string[]) {
  return [...new Set(entries)];
}

export function getConnectionPolicy(): ConnectionPolicy {
  const lockedBaseUrl = getLockedBaseUrl();
  const allowedBaseUrls = dedupeBaseUrls([
    ...(lockedBaseUrl ? [lockedBaseUrl] : []),
    ...parseAllowedBaseUrls(),
  ]);
  const secretConfigured = Boolean(process.env[CONNECTION_SECRET_ENV]?.trim());
  const requiresServerConfiguration =
    process.env.NODE_ENV === "production" &&
    (!secretConfigured ||
      (!lockedBaseUrl && allowedBaseUrls.length === 0 && !isUnsafeCustomConnectionsEnabled()));

  return {
    lockedBaseUrl,
    allowedBaseUrls,
    customBaseUrlEnabled: !lockedBaseUrl && !requiresServerConfiguration,
    requiresServerConfiguration,
    secretConfigured,
  };
}

function validateConnectionBaseUrl(value: string) {
  const normalized = normalizeBaseUrl(value);
  const policy = getConnectionPolicy();

  if (policy.requiresServerConfiguration) {
    throw new Error(
      `This deployment needs ${LOCKED_BASE_URL_ENV} or ${ALLOWED_BASE_URLS_ENV} configured before it can connect to Audiobookshelf.`,
    );
  }

  if (policy.lockedBaseUrl && normalized !== policy.lockedBaseUrl) {
    throw new Error(`This deployment is locked to ${policy.lockedBaseUrl}.`);
  }

  if (policy.allowedBaseUrls.length > 0 && !policy.allowedBaseUrls.includes(normalized)) {
    throw new Error("That Audiobookshelf URL is not allowed by this deployment.");
  }

  return normalized;
}

export async function getConnection() {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;
  const connection = await readSession(sessionId);
  if (!connection) return null;
  return { ...connection, baseUrl: validateConnectionBaseUrl(connection.baseUrl), sessionId };
}

export async function setConnection(connection: AudiobookshelfConnection) {
  const store = await cookies();
  const existingSessionId = store.get(SESSION_COOKIE)?.value;
  const session = await createSession(connection);
  if (existingSessionId) await deleteSession(existingSessionId);
  store.set(SESSION_COOKIE, session.sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: session.maxAgeSeconds,
  });
  store.delete(LEGACY_CONNECTION_COOKIE);
}

export async function clearConnection() {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  if (sessionId) await deleteSession(sessionId);
  store.delete(SESSION_COOKIE);
  store.delete(LEGACY_CONNECTION_COOKIE);
}

export function sanitizeLoginInput(baseUrl: string, username: string, password: string) {
  if (process.env.NODE_ENV === "production" && !getConnectionPolicy().secretConfigured) {
    throw new Error(`${CONNECTION_SECRET_ENV} must be configured before users can sign in.`);
  }
  if (!baseUrl.trim()) throw new Error("Audiobookshelf server URL is required.");
  if (!username.trim()) throw new Error("Username is required.");
  if (username.length > 200 || password.length > 1024) throw new Error("Login details are too long.");
  return { baseUrl: validateConnectionBaseUrl(baseUrl), username: username.trim(), password };
}

export function sanitizeConnectionInput(baseUrl: string, token: string) {
  if (!baseUrl.trim() || !token.trim()) throw new Error("Server URL and API token are required.");
  return { baseUrl: validateConnectionBaseUrl(baseUrl), token: token.trim() };
}

function withBasePath(serverUrl: URL, path: string) {
  const basePath = serverUrl.pathname === "/" ? "" : serverUrl.pathname.replace(/\/$/, "");

  if (!basePath) {
    return path;
  }

  if (path === basePath || path.startsWith(`${basePath}/`)) {
    return path;
  }

  if (path.startsWith("/")) {
    return `${basePath}${path}`;
  }

  return `${basePath}/${path.replace(/^\/+/, "")}`;
}

export function resolveServerUrl(baseUrl: string, path: string) {
  const serverUrl = new URL(baseUrl);
  const trimmedPath = path.trim();
  const isAbsolutePath = /^[a-z][a-z\d+\-.]*:/i.test(trimmedPath);
  const basePath = serverUrl.pathname === "/" ? "" : serverUrl.pathname.replace(/\/$/, "");
  const basePathUrl = new URL(basePath ? `${serverUrl.origin}${basePath}/` : `${serverUrl.origin}/`);
  const resolved = isAbsolutePath
    ? new URL(trimmedPath)
    : new URL(
        withBasePath(serverUrl, trimmedPath.startsWith("/") ? trimmedPath : trimmedPath.replace(/^\/+/, "")),
        basePathUrl,
      );

  if (resolved.origin !== serverUrl.origin) {
    throw new Error("Cross-origin Audiobookshelf paths are not allowed.");
  }

  if (
    basePath &&
    resolved.pathname !== basePath &&
    !resolved.pathname.startsWith(`${basePath}/`)
  ) {
    throw new Error("Cross-path Audiobookshelf requests are not allowed.");
  }

  return resolved.toString();
}

async function getRequiredConnection(explicit?: AudiobookshelfConnection) {
  const connection = explicit ?? (await getConnection());

  if (!connection) {
    throw new AudiobookshelfError("Connect to your Audiobookshelf server first.", "unauthorized");
  }

  return connection;
}

function formatUpstreamError(response: Response, url: string, text: string) {
  const statusLabel = response.statusText
    ? `${response.status} ${response.statusText}`
    : `status ${response.status}`;
  const trimmed = text.trim();
  const stripped = trimmed.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const isHtmlDocument = /<(?:!doctype|html|head|body|title)\b/i.test(trimmed);

  if (isHtmlDocument) {
    const upstreamOrigin = new URL(url).origin;

    if (response.status === 403) {
      return `Audiobookshelf returned 403 Forbidden from ${upstreamOrigin}. This usually means SPOKEN_PAGE_ABS_BASE_URL points to the wrong host or path, or a reverse proxy is blocking the ABS API. Check the URL, include any ABS subpath, and prefer an internal Docker URL like http://audiobookshelf:80 when both apps share a compose stack.`;
    }

    return `Audiobookshelf returned ${statusLabel} from ${upstreamOrigin}. Check SPOKEN_PAGE_ABS_BASE_URL and any reverse proxy or subpath in front of Audiobookshelf.`;
  }

  if (stripped) {
    return stripped;
  }

  return `Audiobookshelf request failed with ${statusLabel}.`;
}

async function refreshAudiobookshelfConnection(connection: AudiobookshelfConnection) {
  if (!connection.refreshToken) return null;
  const response = await fetch(resolveServerUrl(connection.baseUrl, "/auth/refresh"), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "x-refresh-token": connection.refreshToken,
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as {
    user?: { accessToken?: string; refreshToken?: string };
  };
  if (typeof payload.user?.accessToken !== "string") return null;
  const refreshed = {
    ...connection,
    token: payload.user.accessToken,
    refreshToken: payload.user.refreshToken ?? connection.refreshToken,
  };
  if (connection.sessionId) await updateSession(connection.sessionId, refreshed);
  return refreshed;
}

export async function absFetch(path: string, init: FetchInit = {}) {
  const connection = await getRequiredConnection(init.connection);
  const url = resolveServerUrl(connection.baseUrl, path);
  const headers = new Headers(init.headers);

  headers.set("Authorization", `Bearer ${connection.token}`);

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const startedAt = Date.now();
  const timeoutSignal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers, cache: "no-store", signal });
  } catch (error) {
    const timedOut = timeoutSignal.aborted && !init.signal?.aborted;
    throw new AudiobookshelfError(timedOut ? "Audiobookshelf did not respond in time." : "Could not reach Audiobookshelf.", timedOut ? "timeout" : "connection");
  } finally {
    if (process.env.SPOKEN_PAGE_VERBOSE_REQUEST_LOGS === "true") {
      console.info(JSON.stringify({ level: "info", event: "abs_request", method: init.method ?? "GET", path: new URL(url).pathname, durationMs: Date.now() - startedAt }));
    }
  }

  if (response.status === 401 && !init.skipAuthRefresh) {
    try {
      const refreshed = await refreshAudiobookshelfConnection(connection);
      if (refreshed) return absFetch(path, { ...init, connection: refreshed, skipAuthRefresh: true });
    } catch {
      // Fall through to the original authorization error.
    }
  }

  if (!response.ok) {
    let message = `Audiobookshelf request failed with status ${response.status}.`;

    try {
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const payload = (await response.json()) as { error?: string; message?: string };
        message = payload.message ?? payload.error ?? message;
      } else {
        const text = (await response.text()).trim();
        if (text) {
          message = formatUpstreamError(response, url, text);
        }
      }
    } catch {
      // Ignore secondary parse failures and keep the fallback message.
    }

    const kind = response.status === 401 || response.status === 403 ? "unauthorized" : response.status === 404 ? "not_found" : "upstream";
    throw new AudiobookshelfError(message, kind, response.status);
  }

  return response;
}

export async function absJson<T>(path: string, init: FetchInit = {}) {
  const response = await absFetch(path, init);
  try { return (await response.json()) as T; }
  catch { throw new AudiobookshelfError("Audiobookshelf returned an invalid JSON response.", "invalid_response", response.status); }
}

export async function absOptionalJson<T>(path: string, init: FetchInit = {}) {
  const response = await absFetch(path, init);
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return null as T | null;
  }

  return (await response.json()) as T;
}

export async function loginToAudiobookshelf(baseUrl: string, username: string, password: string) {
  const sanitized = sanitizeLoginInput(baseUrl, username, password);
  const url = resolveServerUrl(sanitized.baseUrl, "/login");
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-return-tokens": "true",
      },
      body: JSON.stringify({ username: sanitized.username, password: sanitized.password }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new AudiobookshelfError("Audiobookshelf login timed out.", "timeout");
    }
    throw new AudiobookshelfError("Could not reach the configured Audiobookshelf server.", "connection");
  }

  let payload: {
    user?: {
      id?: string;
      username?: string;
      type?: string;
      token?: string;
      accessToken?: string;
      refreshToken?: string;
    };
    serverSettings?: { version?: string };
    userDefaultLibraryId?: string;
    error?: string;
    message?: string;
  };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    throw new AudiobookshelfError("Audiobookshelf returned an invalid login response.", "invalid_response", response.status);
  }
  if (!response.ok) {
    throw new AudiobookshelfError(
      response.status === 401
        ? "Incorrect Audiobookshelf username or password."
        : payload.message ?? payload.error ?? "Audiobookshelf login failed.",
      response.status === 401 || response.status === 403 ? "unauthorized" : "upstream",
      response.status,
    );
  }
  if (
    (typeof payload.user?.accessToken !== "string" && typeof payload.user?.token !== "string") ||
    typeof payload.user.username !== "string" ||
    typeof payload.user.type !== "string" ||
    typeof payload.serverSettings?.version !== "string"
  ) {
    throw new AudiobookshelfError("Audiobookshelf login response was missing required fields.", "invalid_response", response.status);
  }

  const userId = typeof payload.user.id === "string" ? payload.user.id : payload.user.username;
  return {
    connection: {
      baseUrl: sanitized.baseUrl,
      token: payload.user.accessToken ?? payload.user.token!,
      refreshToken: payload.user.refreshToken,
      deviceId: crypto.randomUUID(),
      userId,
    } satisfies AudiobookshelfConnection,
    profile: {
      userId,
      username: payload.user.username,
      userType: payload.user.type,
      serverVersion: payload.serverSettings.version,
      userDefaultLibraryId: payload.userDefaultLibraryId,
    } satisfies AuthorizedSummary,
  };
}

export async function authorize(connection?: AudiobookshelfConnection) {
  const payload = await absJson<{
    user: { id?: string; username: string; type: string };
    serverSettings: { version: string };
    userDefaultLibraryId?: string;
  }>("/api/authorize", {
    method: "POST",
    connection,
  });

  if (!payload?.user || typeof payload.user.username !== "string" || typeof payload.user.type !== "string" || typeof payload.serverSettings?.version !== "string") {
    throw new AudiobookshelfError("Audiobookshelf authorization response was missing required fields.", "invalid_response");
  }

  return {
    userId: payload.user.id ?? connection?.userId ?? payload.user.username,
    username: payload.user.username,
    userType: payload.user.type,
    serverVersion: payload.serverSettings.version,
    userDefaultLibraryId: payload.userDefaultLibraryId,
  } satisfies AuthorizedSummary;
}

export async function listLibraries(connection?: AudiobookshelfConnection) {
  const payload = await absJson<LibraryListResponse>("/api/libraries", {
    connection,
  });

  if (!Array.isArray(payload?.libraries)) throw new AudiobookshelfError("Audiobookshelf returned an invalid library list.", "invalid_response");

  return payload.libraries.filter((library) => library && typeof library.id === "string" && typeof library.name === "string" && library.mediaType === "book");
}

export async function listLibraryItems(libraryId: string, connection?: AudiobookshelfConnection, page = 0, limit = 100) {
  const params = new URLSearchParams({
    sort: "media.metadata.title",
    minified: "1",
    limit: String(limit),
    page: String(page),
    include: "progress",
  });

  const payload = await absJson<LibraryItemsResponse>(
    `/api/libraries/${libraryId}/items?${params.toString()}`,
    { connection },
  );
  if (!Array.isArray(payload?.results) || typeof payload.total !== "number") throw new AudiobookshelfError("Audiobookshelf returned an invalid item list.", "invalid_response");
  return { ...payload, results: payload.results.filter((item) => item && typeof item.id === "string" && item.mediaType === "book") };
}

export async function getLibraryFilterData(libraryId: string, connection?: AudiobookshelfConnection) {
  return absJson<LibraryFilterData>(`/api/libraries/${libraryId}/filterdata`, {
    connection,
  });
}

export async function getLibraryItem(itemId: string, connection?: AudiobookshelfConnection) {
  const params = new URLSearchParams({
    expanded: "1",
    include: "progress",
  });

  const item = await absJson<LibraryItemExpanded>(`/api/items/${itemId}?${params.toString()}`, {
    connection,
  });
  if (!item || typeof item.id !== "string" || !item.media || typeof item.media.duration !== "number" || !item.media.metadata || typeof item.media.metadata.title !== "string") {
    throw new AudiobookshelfError("Audiobookshelf returned an invalid library item.", "invalid_response");
  }
  return item;
}

export async function getLibraryItemFile(
  itemId: string,
  fileId: string,
  init: FetchInit = {},
) {
  return absFetch(`/api/items/${itemId}/file/${encodeURIComponent(fileId)}/download`, init);
}

export async function startPlaybackSession(itemId: string, connection?: AudiobookshelfConnection) {
  const liveConnection = await getRequiredConnection(connection);

  const session = await absJson<PlaybackSession>(`/api/items/${itemId}/play`, {
    method: "POST",
    connection: liveConnection,
    body: JSON.stringify({
      deviceInfo: {
        deviceId: liveConnection.deviceId,
        clientName: APP_CLIENT_NAME,
        clientVersion: APP_CLIENT_VERSION,
        manufacturer: APP_CLIENT_NAME,
        model: "Browser",
      },
      mediaPlayer: "html5",
      forceDirectPlay: true,
      supportedMimeTypes: [
        "audio/mpeg",
        "audio/mp4",
        "audio/aac",
        "audio/x-m4a",
        "audio/flac",
        "audio/ogg",
        "audio/opus",
        "audio/webm",
        "audio/wav",
      ],
    }),
  });
  if (!session || typeof session.id !== "string" || !Array.isArray(session.audioTracks) || !session.libraryItem) {
    throw new AudiobookshelfError("Audiobookshelf returned an invalid playback session.", "invalid_response");
  }
  return session;
}

export async function syncSession(
  sessionId: string,
  payload: { currentTime: number; timeListened: number; duration: number },
) {
  return absOptionalJson<PlaybackSession>(`/api/session/${sessionId}/sync`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function closeSession(
  sessionId: string,
  payload: { currentTime: number; timeListened: number; duration: number },
) {
  return absOptionalJson<PlaybackSession>(`/api/session/${sessionId}/close`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateProgress(
  itemId: string,
  payload: {
    duration: number;
    progress: number;
    currentTime: number;
    isFinished: boolean;
    finishedAt?: number | null;
    startedAt?: number;
  },
) {
  await absFetch(`/api/me/progress/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export type PlaybackCheckpoint = {
  action: "sync" | "close";
  currentTime: number;
  timeListened: number;
  duration: number;
  progress?: { itemId: string; progress: number; isFinished: boolean; finishedAt?: number | null; startedAt?: number };
};
