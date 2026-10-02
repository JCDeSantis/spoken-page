import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({getConnection:vi.fn(),absJson:vi.fn(),listLibraryItems:vi.fn()}));
vi.mock("../audiobookshelf",()=>({...mocks,AudiobookshelfError:class extends Error { constructor(message:string,public kind:string){super(message);} }}));
import { collectCatalog, getLibraryCatalog } from "../library-catalog";
import type { LibraryItemMinified } from "../types";
const books:LibraryItemMinified[]=Array.from({length:1201},(_,i)=>({id:String(i),libraryId:"lib",mediaType:"book",media:{duration:100,metadata:{title:String(i)}}}));
const page=(page:number,limit:number)=>({results:books.slice(page*limit,(page+1)*limit),total:books.length,page,limit});
beforeEach(()=>{ vi.clearAllMocks(); mocks.getConnection.mockResolvedValue({baseUrl:"https://abs.test",userId:"u",token:"secret"}); mocks.absJson.mockImplementation(async (url:string)=>url==="/api/me"?{id:"u",mediaProgress:[],permissions:{}}:{}); mocks.listLibraryItems.mockImplementation(async (_id:string,_connection:unknown,p:number,l:number)=>page(p,l)); });
describe("catalog completeness",()=>{
  it("reports background preparation and surfaces failure until explicitly retried",async()=>{
    mocks.listLibraryItems.mockRejectedValue(new Error("offline during build"));
    const pending=await getLibraryCatalog("lib-background",true,false);
    expect(pending.complete).toBe(false);
    await vi.waitFor(async()=>{await expect(getLibraryCatalog("lib-background",false,false)).rejects.toThrow("offline during build");});
    mocks.listLibraryItems.mockImplementation(async (_id:string,_connection:unknown,p:number,l:number)=>page(p,l));
    expect((await getLibraryCatalog("lib-background",true)).complete).toBe(true);
  });
  it("collects and reconciles every page, keeping progress out of cached metadata",async()=>{
    const load=vi.fn(async(p:number,l:number)=>page(p,l)); const result=await collectCatalog(load);
    expect(result).toHaveLength(1201); expect(load).toHaveBeenCalledTimes(6); expect(result[0]).not.toHaveProperty("userMediaProgress");
  });
  it("never returns incomplete or duplicate pages",async()=>{
    await expect(collectCatalog(async(p,l)=>({...page(p,l),results:p===1?books.slice(0,500):page(p,l).results}))).rejects.toThrow("library changed");
  });
  it("does not publish a failed build",async()=>{
    await expect(collectCatalog(async(p,l)=>{if(p===1)throw new Error("disconnected");return page(p,l);})).rejects.toThrow("disconnected");
  });
  it("refreshes progress on cache hits and rechecks access",async()=>{
    await getLibraryCatalog("lib-access",true);
    mocks.absJson.mockImplementation(async(url:string)=>url==="/api/me"?{id:"u",mediaProgress:[{libraryItemId:"1200",currentTime:20,isFinished:false}],permissions:{}}:{});
    const second=await getLibraryCatalog("lib-access"); expect(second.items.at(-1)?.userMediaProgress?.currentTime).toBe(20);
    expect(mocks.listLibraryItems).toHaveBeenCalledTimes(6);
    mocks.absJson.mockRejectedValue(new Error("access revoked")); await expect(getLibraryCatalog("lib-access")).rejects.toThrow("access revoked");
  });
  it("isolates accounts and invalidates changed permissions",async()=>{
    await getLibraryCatalog("lib-scope",true); const first=mocks.listLibraryItems.mock.calls.length;
    mocks.absJson.mockImplementation(async(url:string)=>url==="/api/me"?{id:"u",mediaProgress:[],permissions:{download:false}}:{});
    await getLibraryCatalog("lib-scope"); expect(mocks.listLibraryItems.mock.calls.length).toBe(first+6);
    mocks.getConnection.mockResolvedValue({baseUrl:"https://abs.test",userId:"other",token:"other"});
    mocks.absJson.mockImplementation(async(url:string)=>url==="/api/me"?{id:"other",mediaProgress:[],permissions:{}}:{});
    await getLibraryCatalog("lib-scope"); expect(mocks.listLibraryItems.mock.calls.length).toBe(first+12);
  });
});
