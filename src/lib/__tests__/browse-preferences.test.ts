import { it, expect } from "vitest";
import { hasBrowseQuery, restoreBrowsePreferences } from "../browse-preferences";
it("restores a validated view and ignores removed libraries", () => {
  const saved=restoreBrowsePreferences({schemaVersion:1,query:"sort=series&direction=desc&hideCompleted=true&author=A",libraryId:"removed"},["available"]);
  expect(saved?.query).toMatchObject({sort:"series",direction:"desc",hideCompleted:true,author:"A"});
  expect(saved?.libraryId).toBeNull();
  expect(restoreBrowsePreferences({schemaVersion:1,query:"sort=bad"},[])).toBeNull();
  expect(restoreBrowsePreferences({schemaVersion:99,query:"sort=title"},[])).toBeNull();
});
it("an explicit view URL wins while unrelated URL parameters do not", () => {
  expect(hasBrowseQuery(new URLSearchParams("sort=title"))).toBe(true);
  expect(hasBrowseQuery(new URLSearchParams("hideCompleted=false"))).toBe(true);
  expect(hasBrowseQuery(new URLSearchParams("tracking=abc"))).toBe(false);
});
