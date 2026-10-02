import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
vi.mock("../audiobookshelf",()=>({getConnection:vi.fn(async()=>({baseUrl:"https://test.example",userId:"test-user"}))}));
import { getUserSettings, setUserSettings } from "../user-settings";
import { migrateLibraryPreferences } from "../library-preferences";
let directory:string;
beforeEach(async()=>{directory=await mkdtemp(path.join(tmpdir(),"spoken-page-migration-"));vi.stubEnv("SPOKEN_PAGE_DATA_DIR",directory);});
afterEach(async()=>{vi.unstubAllEnvs();await rm(directory,{recursive:true,force:true});});
describe("persistent preference migration",()=>{
  it("preserves an actual legacy document before concurrent initial reads",async()=>{
    const identity=createHash("sha256").update("https://test.example").update("\0").update("test-user").digest("hex");
    const file=path.join(directory,`${identity}.json`);
    const legacy={version:1,updatedAt:123,namespaces:{library:{favoriteIds:["p"],statusOverrides:{a:"planned",b:"finished"}},player:{speed:1.5}}};
    await writeFile(file,JSON.stringify(legacy));
    const results=await Promise.all([getUserSettings("library"),getUserSettings("library")]);
    for(const result of results) expect((result.value as ReturnType<typeof migrateLibraryPreferences>).wantToListenIds).toEqual(["a"]);
    expect(JSON.parse(await readFile(`${file}.pre-status-v2.bak`,"utf8"))).toEqual(legacy);
    expect(JSON.parse(await readFile(file,"utf8")).namespaces.player).toEqual({speed:1.5});
  });
  it("backs up before migration and preserves v2 fields across old client saves",async()=>{
    await setUserSettings("library",migrateLibraryPreferences({statusOverrides:{a:"planned",b:"finished"}}));
    const files=await readdir(directory);expect(files.filter(f=>f.endsWith('.bak'))).toHaveLength(1);
    const backup=await readFile(path.join(directory,files.find(f=>f.endsWith('.bak'))!),"utf8");
    await setUserSettings("library",{favoriteIds:["p"],statusOverrides:{a:"finished"}});
    const value=(await getUserSettings("library")).value as ReturnType<typeof migrateLibraryPreferences>;
    expect(value.wantToListenIds).toEqual(["a"]);expect(value.legacyStatusOverrides.b).toBe("finished");
    expect(await readFile(path.join(directory,files.find(f=>f.endsWith('.bak'))!),"utf8")).toBe(backup);
  });
});
