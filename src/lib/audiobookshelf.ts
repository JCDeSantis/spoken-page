import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import {
  AuthorizedSummary,
  LibraryFilterData,
  LibraryItemsResponse,
  LibraryListResponse,
  LibraryItemExpanded,
  PlaybackSession,
} from "@/lib/types";

const CONNECTION_COOKIE = "abs_sync_connection";
const CONNECTION_COOKIE_VERSION = 1;
const APP_CLIENT_NAME = "Spoken Page";
const APP_CLIENT_VERSION = "1.0.1";
const CONNECTION_SECRET_ENV = "SPOKEN_PAGE_SECRET";
const LOCKED_BASE_URL_ENV = "SPOKEN_PAGE_ABS_BASE_URL";
const ALLOWED_BASE_URLS_ENV = "SPOKEN_PAGE_ALLOWED_BASE_URLS";
const UNSAFE_CUSTOM_CONNECTIONS_ENV = "SPOKEN_PAGE_ALLOW_UNSAFE_CUSTOM_CONNECTIONS";

let generatedConnectionSecret: string | null = null;

export type AudiobookshelfConnection = {
  baseUrl: string;
  token: string;
  deviceId: string;
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
};

type StoredConnectionEnvelope = {
  version: number;
  payload: string;
  signature: string;
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

function getConnectionSecret() {
  const configuredSecret = process.env[CONNECTION_SECRET_ENV]?.trim();

  if (configuredSecret) {
    return configuredSecret;
  }

  if (process.env.NODE_ENV !== "production") {
    return "spoken-page-dev-secret";
  }

  generatedConnectionSecret ??= randomBytes(32).toString("hex");
  return generatedConnectionSecret;
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
  const requiresServerConfiguration =
    process.env.NODE_ENV === "production" &&
    !lockedBaseUrl &&
    allowedBaseUrls.length === 0 &&
    !isUnsafeCustomConnectionsEnabled();

  return {
    lockedBaseUrl,
    allowedBaseUrls,
    customBaseUrlEnabled: !lockedBaseUrl && !requiresServerConfiguration,
    requiresServerConfiguration,
    secretConfigured: Boolean(process.env[CONNECTION_SECRET_ENV]?.trim()),
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

function signConnectionPayload(payload: string) {
  return createHmac("sha256", getConnectionSecret()).update(payload).digest("base64url");
}

function verifyConnectionSignature(payload: string, signature: string) {
  const expectedSignature = signConnectionPayload(payload);
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const signatureBuffer = Buffer.from(signature, "utf8");

  return (
    expectedBuffer.length === signatureBuffer.length &&
    timingSafeEqual(expectedBuffer, signatureBuffer)
  );
}

function serializeConnection(connection: AudiobookshelfConnection) {
  const payload = Buffer.from(JSON.stringify(connection), "utf8").toString("base64url");

  return JSON.stringify({
    version: CONNECTION_COOKIE_VERSION,
    payload,
    signature: signConnectionPayload(payload),
  } satisfies StoredConnectionEnvelope);
}

function parseSerializedConnection(payload: string) {
  const decoded = Buffer.from(payload, "base64url").toString("utf8");
  const parsed = JSON.parse(decoded) as Partial<AudiobookshelfConnection>;

  if (
    typeof parsed.baseUrl !== "string" ||
    typeof parsed.token !== "string" ||
    typeof parsed.deviceId !== "string"
  ) {
    return null;
  }

  return {
    baseUrl: validateConnectionBaseUrl(parsed.baseUrl),
    token: parsed.token,
    deviceId: parsed.deviceId,
  } satisfies AudiobookshelfConnection;
}

function parseConnection(rawValue: string | undefined) {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<StoredConnectionEnvelope>;

    if (
      parsed.version !== CONNECTION_COOKIE_VERSION ||
      typeof parsed.payload !== "string" ||
      typeof parsed.signature !== "string" ||
      !verifyConnectionSignature(parsed.payload, parsed.signature)
    ) {
      return null;
    }

    return parseSerializedConnection(parsed.payload);
  } catch {
    return null;
  }
}

export async function getConnection() {
  const store = await cookies();
  return parseConnection(store.get(CONNECTION_COOKIE)?.value);
}

export async function setConnection(connection: AudiobookshelfConnection) {
  const store = await cookies();
  store.set(CONNECTION_COOKIE, serializeConnection(connection), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearConnection() {
  const store = await cookies();
  store.delete(CONNECTION_COOKIE);
}

export function sanitizeConnectionInput(baseUrl: string, token: string) {
  if (!baseUrl.trim() || !token.trim()) {
    throw new Error("Server URL and API token are required.");
  }

  return {
    baseUrl: validateConnectionBaseUrl(baseUrl),
    token: token.trim(),
  };
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
    throw new Error("Connect to your Audiobookshelf server first.");
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

export async function absFetch(path: string, init: FetchInit = {}) {
  const connection = await getRequiredConnection(init.connection);
  const url = resolveServerUrl(connection.baseUrl, path);
  const headers = new Headers(init.headers);

  headers.set("Authorization", `Bearer ${connection.token}`);

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
  });

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

    throw new Error(message);
  }

  return response;
}

export async function absJson<T>(path: string, init: FetchInit = {}) {
  const response = await absFetch(path, init);
  return (await response.json()) as T;
}

export async function absOptionalJson<T>(path: string, init: FetchInit = {}) {
  const response = await absFetch(path, init);
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return null as T | null;
  }

  return (await response.json()) as T;
}

export async function authorize(connection?: AudiobookshelfConnection) {
  const payload = await absJson<{
    user: { username: string; type: string };
    serverSettings: { version: string };
    userDefaultLibraryId?: string;
  }>("/api/authorize", {
    method: "POST",
    connection,
  });

  return {
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

  return payload.libraries.filter((library) => library.mediaType === "book");
}

export async function listLibraryItems(libraryId: string, connection?: AudiobookshelfConnection) {
  const params = new URLSearchParams({
    sort: "media.metadata.title",
    minified: "1",
    limit: "0",
    page: "0",
    include: "progress",
  });

  return absJson<LibraryItemsResponse>(
    `/api/libraries/${libraryId}/items?${params.toString()}`,
    { connection },
  );
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

  return absJson<LibraryItemExpanded>(`/api/items/${itemId}?${params.toString()}`, {
    connection,
  });
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

  return absJson<PlaybackSession>(`/api/items/${itemId}/play`, {
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
