import { describe, expect, it } from "vitest";
import { booleanValue, finiteNumber, playbackPayload, requireId } from "@/lib/server-api";

describe("server input validation", () => {
  it("rejects unsafe route identifiers", () => {
    expect(() => requireId("../admin", "Item ID")).toThrow(/Item ID/);
    expect(requireId("lib_abc-123")).toBe("lib_abc-123");
  });

  it("enforces finite numeric ranges and booleans", () => {
    expect(finiteNumber(0.5, "Progress", { min: 0, max: 1 })).toBe(0.5);
    expect(() => finiteNumber(Number.NaN, "Progress")).toThrow();
    expect(booleanValue(false, "Finished")).toBe(false);
    expect(() => booleanValue("false", "Finished")).toThrow();
  });

  it("validates playback checkpoints", () => {
    expect(playbackPayload({ currentTime: 10, timeListened: 5, duration: 100 })).toEqual({
      currentTime: 10,
      timeListened: 5,
      duration: 100,
    });
    expect(() => playbackPayload({ currentTime: -1, timeListened: 0, duration: 100 })).toThrow();
  });
});
