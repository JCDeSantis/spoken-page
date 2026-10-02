import { describe, it, expect } from "vitest";
import { bookSeries, nextSeriesBook } from "../series";
import { queryLibrary, parseLibraryQuery } from "../library-query";
import type { LibraryItemMinified } from "../types";
const book = (id: string, seriesName: string, libraryId = "library"): LibraryItemMinified => ({ id, libraryId, mediaType: "book", media: { duration: 100, metadata: { title: id, seriesName } } });
describe("multiple series", () => {
  it("separates combined memberships without confusing their positions", () => {
    expect(bookSeries({ title: "Book", seriesName: "First Saga #2, Other Series #8" })).toEqual([{name:"First Saga",number:"2"},{name:"Other Series",number:"8"}]);
    expect(bookSeries({ title:"Book", seriesName:"A Tale, in Space #2" })[0].name).toBe("A Tale, in Space");
  });
  it("uses structured metadata without interpreting numbers inside names", () => {
    expect(bookSeries({ title:"Book", seriesName:"incorrect", series:[{id:"s",name:"Space 1999",sequence:2.5}] })).toEqual([{id:"s",name:"Space 1999",number:"2.5"}]);
  });
  it("filters and searches secondary memberships", () => {
    const books=[book("a","First Saga #2, Other Series #8"),book("b","Other Series #9")];
    expect(queryLibrary(books,parseLibraryQuery(new URLSearchParams("series=Other+Series"))).total).toBe(2);
    expect(queryLibrary(books,parseLibraryQuery(new URLSearchParams("q=other"))).total).toBe(2);
  });
  it("finds the next numeric member independently of input order and excludes another library", () => {
    const current=book("a","First Saga #2, Other Series #8");
    expect(nextSeriesBook([book("foreign","First Saga #2.1","other"),book("ten","First Saga #10"),book("half","First Saga #2.5"),book("unknown","First Saga")],current)?.id).toBe("half");
    expect(nextSeriesBook([book("secondary","Other Series #9")],current)?.id).toBe("secondary");
    expect(nextSeriesBook([book("unknown","First Saga")],current)).toBeNull();
  });
  it("sorts numeric sequences and keeps unknown positions and standalone books last", () => {
    const books=[book("ten","Saga #10"),book("two","Saga #2"),book("half","Saga #2.5"),book("unknown","Saga"),book("standalone","")];
    expect(queryLibrary(books,parseLibraryQuery(new URLSearchParams("sort=series"))).results.map(item=>item.id)).toEqual(["two","half","ten","unknown","standalone"]);
    expect(queryLibrary(books,parseLibraryQuery(new URLSearchParams("sort=series&direction=desc"))).results.map(item=>item.id)).toEqual(["ten","half","two","unknown","standalone"]);
  });
  it("sorts by the selected secondary membership when filtering a series", () => {
    const books=[book("a","First Saga #1, Other Series #10"),book("b","Other Series #2")];
    expect(queryLibrary(books,parseLibraryQuery(new URLSearchParams("sort=series&series=Other+Series"))).results.map(item=>item.id)).toEqual(["b","a"]);
  });
});
