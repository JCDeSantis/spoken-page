import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupExpiredSessions, createSession, deleteSession, readSession, updateSession } from "@/lib/session-store";

let testDirectory: string | null = null;

afterEach(async () => {
  if (testDirectory) await rm(testDirectory, { recursive: true, force: true });
  testDirectory = null;
  delete process.env.SPOKEN_PAGE_DATA_DIR;
  delete process.env.SPOKEN_PAGE_SECRET;
  delete process.env.SPOKEN_PAGE_PREVIOUS_SECRETS;
});

describe("durable session store", () => {
  it("round-trips an encrypted per-user connection and deletes it", async () => {
    testDirectory = await mkdtemp(path.join(tmpdir(), "spoken-page-session-"));
    process.env.SPOKEN_PAGE_DATA_DIR = testDirectory;
    process.env.SPOKEN_PAGE_SECRET = "test-secret-one";
    const connection = {
      baseUrl: "https://abs.example.test",
      token: "private-token",
      deviceId: "device-1",
      userId: "user-1",
    };

    const { sessionId } = await createSession(connection);
    expect(sessionId).not.toContain("private-token");
    await expect(readSession(sessionId)).resolves.toEqual(connection);
    await deleteSession(sessionId);
    await expect(readSession(sessionId)).resolves.toBeNull();
  });

  it("can decrypt sessions during secret rotation", async () => {
    testDirectory = await mkdtemp(path.join(tmpdir(), "spoken-page-session-"));
    process.env.SPOKEN_PAGE_DATA_DIR = testDirectory;
    process.env.SPOKEN_PAGE_SECRET = "old-secret";
    const { sessionId } = await createSession({
      baseUrl: "https://abs.example.test",
      token: "token",
      deviceId: "device",
      userId: "user",
    });
    process.env.SPOKEN_PAGE_SECRET = "new-secret";
    process.env.SPOKEN_PAGE_PREVIOUS_SECRETS = "old-secret";
    await expect(readSession(sessionId)).resolves.toMatchObject({ userId: "user" });
  });

  it("updates tokens in place and garbage-collects expired sessions", async () => {
    testDirectory = await mkdtemp(path.join(tmpdir(), "spoken-page-session-"));
    process.env.SPOKEN_PAGE_DATA_DIR = testDirectory;
    process.env.SPOKEN_PAGE_SECRET = "test-secret";
    const original = { baseUrl: "https://abs.test", token: "old", deviceId: "device", userId: "user" };
    const { sessionId } = await createSession(original);
    await updateSession(sessionId, { ...original, token: "new", sessionId });
    await expect(readSession(sessionId)).resolves.toMatchObject({ token: "new" });

    const filePath = path.join(testDirectory, "sessions", `${sessionId}.json`);
    const document = JSON.parse(await readFile(filePath, "utf8")) as { expiresAt: number };
    document.expiresAt = 1;
    await writeFile(filePath, JSON.stringify(document));
    await expect(cleanupExpiredSessions(Date.now())).resolves.toBe(1);
    await expect(readSession(sessionId)).resolves.toBeNull();
  });
});
