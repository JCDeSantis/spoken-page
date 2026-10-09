import { describe, expect, it } from "vitest";
import { chapterMarkers, normalizePlayerAppearance, previousSubtitle, SeekUndoHistory, useDarkSubtitleText } from "../player-display";

describe("player display and navigation", () => {
  it("migrates existing subtitle settings and validates stored appearance", () => {
    expect(normalizePlayerAppearance({ subtitleScale: "x-large", subtitlePosition: "lower-third" })).toMatchObject({ subtitleSize: 38, subtitleVerticalAlignment: "bottom", subtitleFont: "default" });
    expect(normalizePlayerAppearance({ subtitleSize: NaN, fullscreenCustomColor: "url(invalid)" })).toMatchObject({ subtitleSize: 34, fullscreenCustomColor: "#302432" });
    expect(normalizePlayerAppearance({ subtitleSize: 100 })).toMatchObject({ subtitleSize: 100 });
    expect(normalizePlayerAppearance({ subtitleSize: 500 })).toMatchObject({ subtitleSize: 120 });
    expect(normalizePlayerAppearance({ subtitleSizeMode: "fill" })).toMatchObject({ subtitleSizeMode: "fill" });
    expect(useDarkSubtitleText("#ffffff")).toBe(true);
    expect(useDarkSubtitleText("#000000")).toBe(false);
  });
  it("never exposes an upcoming or still-unread overlapping cue as the previous line", () => {
    const cues = [{ id: "a", start: 0, end: 3, text: "past" }, { id: "b", start: 3, end: 6, text: "current" }, { id: "c", start: 5, end: 9, text: "overlap" }, { id: "d", start: 10, end: 12, text: "future" }];
    expect(previousSubtitle(cues, 5, cues[1])?.text).toBe("past");
    expect(previousSubtitle(cues, 0)).toBeNull();
    expect(previousSubtitle(cues, 9.5)?.text).toBe("overlap");
  });
  it("places chapter starts on the whole book timeline, excluding invalid markers", () => {
    expect(chapterMarkers([{ title: "a", start: 0, end: 30 }, { title: "b", start: 30, end: 100 }, { title: "bad", start: -1, end: 0 }], 100)).toEqual([{ index: 0, percent: 0 }, { index: 1, percent: 30 }]);
    expect(chapterMarkers([], 0)).toEqual([]);
  });
  it("undoes an entire slider drag, a chapter jump, and clears history between books", () => {
    const history = new SeekUndoHistory();
    history.begin(100); history.remember(100, 200); history.remember(200, 300); history.end();
    expect(history.undo()).toBe(100);
    expect(history.undo()).toBeNull();
    history.remember(110, 800);
    expect(history.undo()).toBe(110);
    history.remember(100, 200); history.clear();
    expect(history.target()).toBeNull();
  });
  it("preserves the previous undo when a drag returns to its starting position", () => {
    const history = new SeekUndoHistory(); history.remember(100, 200);
    history.begin(200); history.remember(200, 400); history.remember(400, 200); history.end();
    expect(history.undo()).toBe(100);
  });
});
