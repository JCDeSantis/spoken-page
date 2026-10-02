import { describe, expect, it } from "vitest";
import { listeningState, progressForAction, playbackFinished } from "../listening-status";
import { migrateLibraryPreferences, mergeLibraryPreferences } from "../library-preferences";
const progress = { duration: 100, currentTime: 25, progress: .25, isFinished: false, startedAt: 1000 };
describe("listening status", () => {
  it("distinguishes loading, untouched, started, rewound and finished", () => {
    expect(listeningState(undefined)).toBe("unknown"); expect(listeningState(null)).toBe("unstarted");
    expect(listeningState(progress)).toBe("in-progress");
    expect(listeningState({...progress,currentTime:0,progress:0})).toBe("in-progress");
    expect(listeningState({...progress,isFinished:true})).toBe("finished");
  });
  it("marks complete without moving the listening position; unfinished preserves it", () => {
    const finished=progressForAction("complete",progress,100,2000);
    expect(finished.currentTime).toBe(25); expect(finished.isFinished).toBe(true);
    expect(progressForAction("unfinished",finished,100,3000)).toMatchObject({currentTime:25,isFinished:false,progress:.25,finishedAt:null});
    expect(progressForAction("restart",finished,100,3000)).toMatchObject({currentTime:0,isFinished:false,startedAt:0});
  });
  it("does not complete a paused scrub or a zero-duration book", () => {
    expect(playbackFinished(100,100,false)).toBe(false);
    expect(playbackFinished(100,100,true)).toBe(true);
    expect(playbackFinished(.99,1,true)).toBe(false);
    expect(playbackFinished(1,1,true)).toBe(true);
    expect(playbackFinished(0,0,true)).toBe(false);
  });
});
describe("preference migration", () => {
  it("preserves labels, converts planning only, and is idempotent", () => {
    const before={favoriteIds:["pin"],statusOverrides:{a:"planned",b:"finished",c:"unstarted"}};
    const after=migrateLibraryPreferences(before);
    expect(after.wantToListenIds).toEqual(["a"]); expect(after.legacyStatusOverrides).toEqual(before.statusOverrides);
    expect(migrateLibraryPreferences(after)).toEqual(after);
  });
  it("prevents old clients overwriting migrated fields", () => {
    const before={...migrateLibraryPreferences({statusOverrides:{a:"planned"}}),wantToListenIds:["new"]};
    const after=mergeLibraryPreferences(before,{favoriteIds:["pin"],statusOverrides:{a:"finished"}});
    expect(after.wantToListenIds).toEqual(["new"]); expect(after.legacyStatusOverrides.a).toBe("planned"); expect(after.favoriteIds).toEqual(["pin"]);
  });
});
