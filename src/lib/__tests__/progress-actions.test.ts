import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ getLibraryItem: vi.fn(), updateProgress: vi.fn(), absFetch: vi.fn() }));
vi.mock("../audiobookshelf", () => ({ ...mocks, AudiobookshelfError: class extends Error {} }));
import { POST } from "@/app/api/me/progress/[itemId]/action/route";
const context = { params: Promise.resolve({ itemId: "book-a" }) };
const request = (action: string) => new NextRequest("http://localhost/api/me/progress/book-a/action", { method: "POST", body: JSON.stringify({ action }) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getLibraryItem.mockResolvedValue({ id: "book-a", media: { duration: 100 }, userMediaProgress: { id: "progress-b", duration: 100, currentTime: 25, progress: .25, startedAt: 1000, isFinished: false } });
  mocks.updateProgress.mockResolvedValue(undefined); mocks.absFetch.mockResolvedValue(new Response(null, { status: 200 }));
});
describe("progress actions", () => {
  it("resets the authenticated user's progress RECORD, not the library item ID", async () => {
    const response = await POST(request("restart"), context);
    expect(response.status).toBe(200);
    expect(mocks.absFetch).toHaveBeenCalledWith("/api/me/progress/progress-b", { method: "DELETE" });
    expect((await response.json()).item.userMediaProgress).toBeNull();
  });
  it("preserves position when marking complete", async () => {
    expect((await POST(request("complete"), context)).status).toBe(200);
    expect(mocks.updateProgress).toHaveBeenCalledWith("book-a", expect.objectContaining({ currentTime: 25, isFinished: true, progress: 1 }));
  });
  it("does not modify inaccessible books or accept invalid actions", async () => {
    expect((await POST(request("delete"), context)).status).toBe(400);
    expect(mocks.getLibraryItem).not.toHaveBeenCalled();
    mocks.getLibraryItem.mockRejectedValue(new Error("Access denied"));
    expect((await POST(request("restart"), context)).status).toBe(500);
    expect(mocks.absFetch).not.toHaveBeenCalled();
  });
  it("does not report success or change local progress when a server write fails", async () => {
    mocks.updateProgress.mockRejectedValue(new Error("Connection interrupted"));
    const response = await POST(request("unfinished"), context);
    expect(response.status).toBe(500); expect(await response.json()).not.toHaveProperty("item");
  });
});
