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

export type AudiobookshelfConnection = {
  baseUrl: string;
  token: string;
  deviceId: string;
};

type FetchInit = RequestInit & {
  connection?: AudiobookshelfConnection;
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

function parseConnection(rawValue: string | undefined) {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<AudiobookshelfConnection>;

    if (
      typeof parsed.baseUrl !== "string" ||
      typeof parsed.token !== "string" ||
      typeof parsed.deviceId !== "string"
    ) {
      return null;
    }

    return {
      baseUrl: normalizeBaseUrl(parsed.baseUrl),
      token: parsed.token,
      deviceId: parsed.deviceId,
    } satisfies AudiobookshelfConnection;
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
  store.set(CONNECTION_COOKIE, JSON.stringify(connection), {
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
    baseUrl: normalizeBaseUrl(baseUrl),
    token: token.trim(),
  };
}

export function resolveServerUrl(baseUrl: string, path: string) {
  const resolved = new URL(path, baseUrl);
  const serverUrl = new URL(baseUrl);

  if (resolved.origin !== serverUrl.origin) {
    throw new Error("Cross-origin Audiobookshelf paths are not allowed.");
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
          message = text;
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

export async function getLibraryItemFile(itemId: string, fileId: string, connection?: AudiobookshelfConnection) {
  return absFetch(`/api/items/${itemId}/file/${encodeURIComponent(fileId)}/download`, {
    connection,
  });
}

export async function startPlaybackSession(itemId: string, connection?: AudiobookshelfConnection) {
  const liveConnection = await getRequiredConnection(connection);

  return absJson<PlaybackSession>(`/api/items/${itemId}/play`, {
    method: "POST",
    connection: liveConnection,
    body: JSON.stringify({
      deviceInfo: {
        deviceId: liveConnection.deviceId,
        clientName: "Shelf Sync Subtitles",
        clientVersion: "0.1.0",
        manufacturer: "Custom Web App",
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
