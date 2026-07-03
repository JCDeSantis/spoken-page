import { describe, expect, it } from "vitest";
import { findCueIndex, parseSubtitle } from "@/lib/srt";

describe("subtitle parsing", () => {
  it("parses SRT cues and strips alignment tags", () => {
    const cues = parseSubtitle("1\n00:00:01,250 --> 00:00:03,500\n{\\an8}Hello world");
    expect(cues).toEqual([{ id: "1.25-3.5-0", start: 1.25, end: 3.5, text: "Hello world" }]);
  });

  it("parses WebVTT identifiers, cue settings, and inline tags", () => {
    const cues = parseSubtitle("WEBVTT\n\nintro\n00:01.000 --> 00:03.250 align:center\n<v Speaker><b>Hello</b></v>");
    expect(cues[0]).toMatchObject({ start: 1, end: 3.25, text: "Hello" });
  });

  it("finds the active cue with a binary search", () => {
    const cues = parseSubtitle("00:00.000 --> 00:01.000\nOne\n\n00:02.000 --> 00:03.000\nTwo");
    expect(findCueIndex(cues, 2.5)).toBe(1);
    expect(findCueIndex(cues, 1.5)).toBe(-1);
  });
});
