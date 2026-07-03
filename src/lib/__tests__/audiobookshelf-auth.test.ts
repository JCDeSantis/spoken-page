import { afterEach, describe, expect, it, vi } from "vitest";
import { absFetch, loginToAudiobookshelf, sanitizeLoginInput } from "@/lib/audiobookshelf";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Audiobookshelf authentication", () => {
  it("supports passwordless root login and stores rotating access tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      user: {
        id: "root",
        username: "root",
        type: "root",
        token: "legacy-token",
        accessToken: "access-token",
        refreshToken: "refresh-token",
      },
      serverSettings: { version: "2.35.0" },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    expect(sanitizeLoginInput("https://abs.example.test", "root", "").password).toBe("");
    const result = await loginToAudiobookshelf("https://abs.example.test", "root", "");
    expect(result.connection).toMatchObject({ token: "access-token", refreshToken: "refresh-token", userId: "root" });
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get("x-return-tokens")).toBe("true");
  });

  it("refreshes an expired access token once and retries the request", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "expired" }), { status: 401, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { accessToken: "new-access", refreshToken: "new-refresh" } }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await absFetch("/api/test", {
      connection: {
        baseUrl: "https://abs.example.test",
        token: "expired-access",
        refreshToken: "refresh-token",
        deviceId: "device",
        userId: "user",
      },
    });
    expect(await response.text()).toBe("ok");
    expect(new Headers(fetchMock.mock.calls[2]![1]?.headers).get("authorization")).toBe("Bearer new-access");
  });
});
