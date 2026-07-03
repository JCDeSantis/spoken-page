import { beforeEach, describe, expect, it, vi } from "vitest";

const { syncSession, closeSession, updateProgress } = vi.hoisted(() => ({
  syncSession: vi.fn(),
  closeSession: vi.fn(),
  updateProgress: vi.fn(),
}));

vi.mock("@/lib/audiobookshelf", () => ({
  syncSession,
  closeSession,
  updateProgress,
  AudiobookshelfError: class AudiobookshelfError extends Error {},
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/session/[sessionId]/checkpoint/route";

function request(sequence: number) {
  return new NextRequest("http://localhost/api/session/session_test/checkpoint", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sequence,
      action: "sync",
      currentTime: 10,
      timeListened: 5,
      duration: 100,
      progress: { itemId: "item_test", progress: 0.1, isFinished: false },
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  syncSession.mockResolvedValue({ id: "session_test" });
  closeSession.mockResolvedValue({ id: "session_test" });
  updateProgress.mockResolvedValue(undefined);
});

describe("playback checkpoints", () => {
  it("writes idempotent progress before applying listened-time deltas", async () => {
    const response = await POST(request(1001), { params: Promise.resolve({ sessionId: "session_test_order" }) });
    expect(response.status).toBe(200);
    expect(updateProgress.mock.invocationCallOrder[0]).toBeLessThan(syncSession.mock.invocationCallOrder[0]!);
  });

  it("does not apply the session delta when progress fails, allowing a safe retry", async () => {
    updateProgress.mockRejectedValueOnce(new Error("temporary failure"));
    const context = { params: Promise.resolve({ sessionId: "session_test_retry" }) };
    expect((await POST(request(2001), context)).status).toBe(500);
    expect(syncSession).not.toHaveBeenCalled();

    const retry = await POST(request(2001), context);
    expect(retry.status).toBe(200);
    expect(syncSession).toHaveBeenCalledTimes(1);
  });
});
