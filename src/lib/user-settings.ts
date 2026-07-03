import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConnection } from "@/lib/audiobookshelf";

type SettingsDocument = {
  version: 1;
  updatedAt: number;
  namespaces: Record<string, unknown>;
};

const MAX_NAMESPACE_BYTES = 128 * 1024;
let writeQueue = Promise.resolve();

function dataDirectory() {
  return process.env.SPOKEN_PAGE_DATA_DIR?.trim() || path.join(process.cwd(), "data");
}

function validateNamespace(namespace: string) {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(namespace)) {
    throw new Error("Invalid settings namespace.");
  }
  return namespace;
}

async function settingsPath() {
  const connection = await getConnection();
  if (!connection) throw new Error("Connect to Audiobookshelf first.");

  // ABS user identity keeps settings stable across sessions and devices without
  // putting a username or token in the filesystem path.
  if (!connection.userId) throw new Error("This session is missing an Audiobookshelf user identity. Sign in again.");
  const identity = createHash("sha256")
    .update(connection.baseUrl)
    .update("\0")
    .update(connection.userId)
    .digest("hex");
  return path.join(dataDirectory(), `${identity}.json`);
}

async function readDocument(filePath: string): Promise<SettingsDocument> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<SettingsDocument>;
    if (parsed.version === 1 && parsed.namespaces && typeof parsed.namespaces === "object") {
      return {
        version: 1,
        updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
        namespaces: parsed.namespaces,
      };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { version: 1, updatedAt: 0, namespaces: {} };
}

export async function getUserSettings(namespace: string) {
  validateNamespace(namespace);
  const document = await readDocument(await settingsPath());
  return { value: document.namespaces[namespace] ?? null, updatedAt: document.updatedAt };
}

export async function setUserSettings(namespace: string, value: unknown) {
  validateNamespace(namespace);
  const serializedValue = JSON.stringify(value);
  if (Buffer.byteLength(serializedValue, "utf8") > MAX_NAMESPACE_BYTES) {
    throw new Error("Settings payload is too large.");
  }

  const operation = writeQueue.then(async () => {
    const filePath = await settingsPath();
    const document = await readDocument(filePath);
    document.namespaces[namespace] = value;
    document.updatedAt = Date.now();
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(document), { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, filePath);
    return { updatedAt: document.updatedAt };
  });

  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}
