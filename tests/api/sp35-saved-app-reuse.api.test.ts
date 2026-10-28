import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { SavedApps } from "../../src/app/discover/SavedApps.js";
import {
  clearTabAppTarget, forgetSavedTabApp, readSavedTabApps, readTabAppTarget,
  rememberSavedTabApp, saveTabAppTarget
} from "../../src/app/shell/tab-app-recovery.js";

const intentId="0199f5d0-53e8-7505-adf6-bc4c744fe0c7";
const contentHash="sha256:"+"b".repeat(64);
const another="0199f5d0-53e8-7505-adf6-bc4c744fe0c8";
const target={intentId,contentHash};
function tab() {
  const values=new Map<string,string>();
  vi.stubGlobal("sessionStorage",{
    getItem:(key:string)=>values.get(key)??null,
    setItem:(key:string,value:string)=>{values.set(key,value);},
    removeItem:(key:string)=>{values.delete(key);}
  });
  return values;
}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

describe("Sprint 3.5 no-AI same-tab authenticated App reuse",()=>{
  it("keeps only a bounded title + opaque IDs + hash, not prompts, secrets or Blueprints",()=>{
    const data=tab();
    const saved=rememberSavedTabApp(target,"  LifePilot  ");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({...target,title:"LifePilot"});
    const raw=data.get("appf2.tab.saved-apps.v1")!;
    expect(raw).not.toContain("raw_intent");
    expect(raw).not.toContain("privateKey");
    expect(raw).not.toContain("blueprint");
    expect(readSavedTabApps()).toHaveLength(1);
    rememberSavedTabApp(target,"LifePilot");
    expect(readSavedTabApps()).toHaveLength(1);
    for(let i=0;i<12;i++){
      rememberSavedTabApp({intentId:"0199f5d0-53e8-7505-adf6-"+(i+1).toString(16).padStart(12,"0"),contentHash},"App "+i);
    }
    expect(readSavedTabApps()).toHaveLength(8);
  });
  it("Home clears current relaunch target without deleting already verified App cards",()=>{
    tab();
    saveTabAppTarget(target);
    rememberSavedTabApp(target,"LifePilot");
    clearTabAppTarget();
    expect(readTabAppTarget()).toBeNull();
    expect(readSavedTabApps()).toMatchObject([{...target,title:"LifePilot"}]);
    const picked=readSavedTabApps()[0]!;
    saveTabAppTarget(picked);
    expect(readTabAppTarget()).toEqual(target);
    expect(forgetSavedTabApp(picked)).toEqual([]);
  });
  it("cards render a real open action, unlike inspiration prefill",()=>{
    tab();
    const items=rememberSavedTabApp(target,"LifePilot");
    const html=renderToStaticMarkup(createElement(SavedApps,{
      headingRef:null,apps:items,onOpen:()=>undefined,onForget:()=>undefined
    }));
    expect(html).toContain("開啟 App（不使用 AI）");
    expect(html).toContain("LifePilot");
    expect(html).toContain("最長 24 小時");
    expect(html).not.toContain("試試看");
  });
  it("rejects corrupted, expired, tampered and untrusted saved targets",()=>{
    const data=tab();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T00:00:00.000Z"));
    rememberSavedTabApp(target,"App");
    expect(readSavedTabApps()).toHaveLength(1);
    vi.advanceTimersByTime(24*60*60*1000+1);
    expect(readSavedTabApps()).toEqual([]);
    data.set("appf2.tab.saved-apps.v1",JSON.stringify([
      {intentId:"evil",contentHash,title:"forged",savedAt:Date.now()},
      {intentId:another,contentHash:"sha256:bad",title:"bad",savedAt:Date.now()}
    ]));
    expect(readSavedTabApps()).toEqual([]);
    data.set("appf2.tab.saved-apps.v1","broken json");
    expect(readSavedTabApps()).toEqual([]);
  });
  it("real browser-wide catalog survives another tab with a different sessionStorage",()=>{
    const firstTab=tab();
    const shared=new Map<string,string>();
    vi.stubGlobal("localStorage",{
      getItem:(key:string)=>shared.get(key)??null,
      setItem:(key:string,value:string)=>{shared.set(key,value);},
      removeItem:(key:string)=>{shared.delete(key);}
    });
    rememberSavedTabApp(target,"LifePilot");
    expect(shared.has("appf2.tab.saved-apps.v1")).toBe(true);
    expect(firstTab.has("appf2.tab.saved-apps.v1")).toBe(false);
    vi.stubGlobal("sessionStorage",{
      getItem:()=>null, setItem:()=>{}, removeItem:()=>{}
    });
    expect(readSavedTabApps()).toMatchObject([{...target,title:"LifePilot"}]);
    forgetSavedTabApp(target);
    expect(readSavedTabApps()).toEqual([]);
  });
  it("a successful reopen never extends the original 24h authority expiry",()=>{
    tab();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T00:00:00Z"));
    rememberSavedTabApp(target,"LifePilot");
    const first=readSavedTabApps()[0]!.savedAt;
    vi.advanceTimersByTime(23*60*60*1000);
    rememberSavedTabApp(target,"LifePilot");
    expect(readSavedTabApps()[0]!.savedAt).toBe(first);
    vi.advanceTimersByTime(60*60*1000+1);
    expect(readSavedTabApps()).toEqual([]);
  });
  it("fails safely when sessionStorage is denied",()=>{
    vi.stubGlobal("sessionStorage",{
      getItem:()=>{throw new Error("denied");},
      setItem:()=>{throw new Error("denied");},
      removeItem:()=>{throw new Error("denied");}
    });
    expect(()=>rememberSavedTabApp(target,"App")).not.toThrow();
    expect(readSavedTabApps()).toEqual([]);
  });
});
