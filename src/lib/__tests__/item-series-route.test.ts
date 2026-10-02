import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ getLibraryItem: vi.fn(), getLibraryCatalog: vi.fn() }));
vi.mock("../audiobookshelf", () => ({ getLibraryItem: mocks.getLibraryItem, AudiobookshelfError: class extends Error {} }));
vi.mock("../library-catalog", () => ({ getLibraryCatalog: mocks.getLibraryCatalog }));
import { GET } from "@/app/api/items/[itemId]/route";
const book = (id: string, sequence: string) => ({ id, libraryId: "library", mediaType: "book", media: { metadata: { title: id, series: [{ name: "Saga", sequence }] } } });
const request = new NextRequest("http://localhost/api/items/current");
const context = { params: Promise.resolve({ itemId: "current" }) };
beforeEach(() => { vi.clearAllMocks(); mocks.getLibraryItem.mockResolvedValue(book("current", "2")); });
describe("next-series details", () => {
  it("uses the complete catalog independently of visible search results", async () => {
    mocks.getLibraryCatalog.mockResolvedValue({ items: [book("earlier", "1"), book("later", "10"), book("next", "2.5")] });
    const response = await GET(request, context);
    expect(response.status).toBe(200);
    expect((await response.json()).nextInSeries.id).toBe("next");
    expect(mocks.getLibraryCatalog).toHaveBeenCalledWith("library");
  });
  it("keeps details usable and reports when the next book cannot be checked", async () => {
    mocks.getLibraryCatalog.mockRejectedValue(new Error("Unavailable"));
    const payload = await (await GET(request, context)).json();
    expect(payload.id).toBe("current"); expect(payload.nextInSeries).toBeNull(); expect(payload.nextInSeriesError).toContain("retry");
  });
  it("never reads the catalog when the selected item is inaccessible", async () => {
    mocks.getLibraryItem.mockRejectedValue(new Error("Access denied"));
    expect((await GET(request, context)).status).toBe(500);
    expect(mocks.getLibraryCatalog).not.toHaveBeenCalled();
  });
});
