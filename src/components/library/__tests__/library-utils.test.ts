import { describe, expect, it } from "vitest";
import { getSeriesNext, selectedBookStatus, seriesDisplay, seriesPosition, sortLibraryItems, stripSeriesSuffix } from "@/components/library/library-utils";
import type { LibraryItemMinified } from "@/lib/types";

function book(id: string, title: string, seriesName?: string, currentTime = 0): LibraryItemMinified {
  return {
    id,
    libraryId: "library",
    mediaType: "book",
    media: { duration: 3600, metadata: { title, seriesName } },
    userMediaProgress: { duration: 3600, progress: currentTime / 3600, currentTime, isFinished: false },
  };
}

describe("library utilities", () => {
  it("finds the next numbered book in a series", () => {
    const first = book("1", "Beginning", "Saga Book 1");
    const second = book("2", "Middle", "Saga Book 2");
    expect(getSeriesNext([second, first], first)?.id).toBe("2");
    expect(seriesPosition("Saga, Volume 2.5")).toBe(2.5);
  });

  it("shows a clean series name and book number across common suffix formats", () => {
    expect(seriesDisplay("Saga Book 2")).toEqual({ name: "Saga", number: "2" });
    expect(seriesDisplay("A Long Series Name, Volume 2.5")).toEqual({ name: "A Long Series Name", number: "2.5" });
    expect(seriesDisplay("Saga #3")).toEqual({ name: "Saga", number: "3" });
    expect(seriesDisplay("Saga")).toEqual({ name: "Saga", number: null });
    expect(stripSeriesSuffix("A Long Series Name - 4")).toBe("A Long Series Name");
  });

  it("sorts without mutating input and defaults status to empty", () => {
    const items = [book("b", "Beta", undefined, 20), book("a", "Alpha")];
    expect(sortLibraryItems(items, "title").map((item) => item.id)).toEqual(["a", "b"]);
    expect(items[0]?.id).toBe("b");
    expect(selectedBookStatus()).toBeNull();
  });

  it("uses only the saved Spoken Page status", () => {
    const started = book("started", "Started", undefined, 20);
    const untouched = book("untouched", "Untouched");

    expect(selectedBookStatus("finished")).toBe("finished");
    expect(selectedBookStatus("planned")).toBe("planned");
    expect(selectedBookStatus("unstarted")).toBe("unstarted");
    expect(sortLibraryItems([started, untouched], "progress", { untouched: "finished" })[0]?.id).toBe("untouched");
  });
});
