import { describe, expect, it } from "vitest";
import { parseLibraryQuery, queryLibrary } from "../library-query";
import type { LibraryItemMinified } from "../types";

const items: LibraryItemMinified[] = Array.from({ length: 10000 }, (_, i) => ({
  id: `book-${i}`, libraryId: "library", mediaType: "book",
  media: { duration: 3600, metadata: { title: `Book ${i}`, subtitle: i === 9999 ? "Hidden treasure" : "", authorName: i % 2 ? "Author One; Author Two" : "Other", narratorName: "Voice", seriesName: "A long saga Book 3", genres: ["Fantasy"], language: "en" }, tags: ["Favorite"] },
  userMediaProgress: i % 2 ? { duration: 3600, currentTime: i, progress: i/10000, isFinished: false, startedAt: 1 } : null,
}));
const query = (s: string) => parseLibraryQuery(new URLSearchParams(s));

describe("whole-library queries", () => {
  it("hides completed books before counting and pagination", () => {
    const finished = { ...items[0], userMediaProgress: { ...items[1].userMediaProgress!, isFinished: true } };
    const result = queryLibrary([finished, items[1], items[2]], query("hideCompleted=true&limit=1&page=1"));
    expect(result.total).toBe(2);
    expect(result.results[0].id).toBe("book-2");
    expect(() => query("hideCompleted=bad")).toThrow();
  });
  it("sorts series by name and numeric book order before pagination, with standalone books last", () => {
    const books = ["Saga #10", "Saga #2", undefined, "Alpha Book 1"].map((seriesName, i) => ({ ...items[i], media: { ...items[i].media, metadata: { ...items[i].media.metadata, seriesName } } }));
    expect(queryLibrary(books, query("sort=series")).results.map(book => book.id)).toEqual(["book-3", "book-1", "book-0", "book-2"]);
    expect(queryLibrary(books, query("sort=series&direction=desc&limit=2")).results.map(book => book.id)).toEqual(["book-0", "book-1"]);
  });
  it("finds subtitle text beyond every initially loaded page", () => {
    const result = queryLibrary(items, query("q=hidden+treasure"));
    expect(result.total).toBe(1); expect(result.results[0].id).toBe("book-9999");
  });
  it("combines filters before pagination and sorts real progress", () => {
    const result = queryLibrary(items, query("q=book&author=Author+Two&genre=Fantasy&tag=Favorite&language=en&series=A+long+saga&status=in-progress&sort=progress&limit=2&page=1"));
    expect(result.total).toBe(5000); expect(result.results.map(i=>i.id)).toEqual(["book-9995","book-9993"]);
  });
  it("keeps planning separate and leaves source order intact", () => {
    expect(queryLibrary(items, query("want=true&status=unstarted"), ["book-2", "book-3"]).results.map(i=>i.id)).toEqual(["book-2"]);
    expect(items[0].id).toBe("book-0");
  });
  it("normalizes Unicode and uses ID tie-breakers", () => {
    const same = [{ ...items[0], id:"b",media:{...items[0].media,metadata:{title:"Café"}} }, { ...items[0], id:"a",media:{...items[0].media,metadata:{title:"Café"}} }];
    expect(queryLibrary(same, query("q=Cafe%CC%81")).results.map(i=>i.id)).toEqual(["a","b"]);
  });
  it.each(["page=-1", "page=1.5", "limit=501", "sort=bad", "direction=bad", "status=planned", "want=1", "q="+"a".repeat(301)])("rejects malformed query %s", value => expect(()=>query(value)).toThrow());
  it("runs a warm 10,000-book query within the target budget", () => {
    const start=performance.now(); queryLibrary(items, query("sort=title&genre=Fantasy"));
    expect(performance.now()-start).toBeLessThan(500);
  });
});
