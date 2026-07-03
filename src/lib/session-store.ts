import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AudiobookshelfConnection } from "@/lib/audiobookshelf";

const SESSION_VERSION = 1;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 90;
const SECRET_ENV = "SPOKEN_PAGE_SECRET";
const PREVIOUS_SECRETS_ENV = "SPOKEN_PAGE_PREVIOUS_SECRETS";
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
let lastCleanupAt = 0;

type StoredSession = {
  version: 1;
  createdAt: number;
  expiresAt: number;
  iv: string;
  ciphertext: string;
  tag: string;
};

function dataDirectory() {
  return process.env.SPOKEN_PAGE_DATA_DIR?.trim() || path.join(process.cwd(), "data");
}

function currentSecret() {
  const secret = process.env[SECRET_ENV]?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV !== "production") return "spoken-page-dev-secret";
  throw new Error(`${SECRET_ENV} must be configured with a stable, high-entropy value in production.`);
}

function key(secret: string) {
  return createHash("sha256").update(`spoken-page:session:v${SESSION_VERSION}:`).update(secret).digest();
}

function decryptionKeys() {
  const previous = (process.env[PREVIOUS_SECRETS_ENV] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return [key(currentSecret()), ...previous.map(key)];
}

function sessionPath(sessionId: string) {
  if (!/^[A-Za-z0-9_-]{40,80}$/.test(sessionId)) return null;
  return path.join(dataDirectory(), "sessions", `${sessionId}.json`);
}

export async function createSession(connection: AudiobookshelfConnection) {
  if (Date.now() - lastCleanupAt >= CLEANUP_INTERVAL_MS) {
    await cleanupExpiredSessions();
  }
  const sessionId = randomBytes(32).toString("base64url");
  const now = Date.now();
  await writeEncryptedSession(sessionId, connection, now, now + SESSION_TTL_MS);
  return { sessionId, maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000) };
}

export async function cleanupExpiredSessions(now = Date.now()) {
  lastCleanupAt = now;
  const directory = path.join(dataDirectory(), "sessions");
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!/^[A-Za-z0-9_-]{40,80}\.json$/.test(entry)) continue;
    const filePath = path.join(directory, entry);
    try {
      const document = JSON.parse(await readFile(filePath, "utf8")) as Partial<StoredSession>;
      if (typeof document.expiresAt !== "number" || document.expiresAt <= now) {
        await unlink(filePath);
        removed += 1;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        // Leave unreadable files in place for operator inspection rather than deleting blindly.
      }
    }
  }
  return removed;
}

async function writeEncryptedSession(
  sessionId: string,
  connection: AudiobookshelfConnection,
  createdAt: number,
  expiresAt: number,
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(currentSecret()), iv);
  cipher.setAAD(Buffer.from(sessionId));
  const persistedConnection = { ...connection };
  delete persistedConnection.sessionId;
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(persistedConnection), "utf8"),
    cipher.final(),
  ]);
  const document: StoredSession = {
    version: SESSION_VERSION,
    createdAt,
    expiresAt,
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  };
  const filePath = sessionPath(sessionId)!;
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(document), { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, filePath);
}

export async function updateSession(sessionId: string, connection: AudiobookshelfConnection) {
  const filePath = sessionPath(sessionId);
  if (!filePath) throw new Error("Session identifier is invalid.");
  const existing = JSON.parse(await readFile(filePath, "utf8")) as Partial<StoredSession>;
  const now = Date.now();
  await writeEncryptedSession(
    sessionId,
    connection,
    typeof existing.createdAt === "number" ? existing.createdAt : now,
    typeof existing.expiresAt === "number" && existing.expiresAt > now ? existing.expiresAt : now + SESSION_TTL_MS,
  );
}

export async function readSession(sessionId: string) {
  const filePath = sessionPath(sessionId);
  if (!filePath) return null;
  try {
    const document = JSON.parse(await readFile(filePath, "utf8")) as Partial<StoredSession>;
    if (
      document.version !== SESSION_VERSION ||
      typeof document.expiresAt !== "number" ||
      typeof document.iv !== "string" ||
      typeof document.ciphertext !== "string" ||
      typeof document.tag !== "string"
    ) return null;
    if (document.expiresAt <= Date.now()) {
      await deleteSession(sessionId);
      return null;
    }

    for (const candidateKey of decryptionKeys()) {
      try {
        const decipher = createDecipheriv("aes-256-gcm", candidateKey, Buffer.from(document.iv, "base64url"));
        decipher.setAAD(Buffer.from(sessionId));
        decipher.setAuthTag(Buffer.from(document.tag, "base64url"));
        const decoded = Buffer.concat([
          decipher.update(Buffer.from(document.ciphertext, "base64url")),
          decipher.final(),
        ]).toString("utf8");
        const connection = JSON.parse(decoded) as Partial<AudiobookshelfConnection>;
        if (
          typeof connection.baseUrl === "string" &&
          typeof connection.token === "string" &&
          typeof connection.deviceId === "string"
        ) return connection as AudiobookshelfConnection;
      } catch {
        // Try a previous rotation key.
      }
    }
    return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function deleteSession(sessionId: string) {
  const filePath = sessionPath(sessionId);
  if (!filePath) return;
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
