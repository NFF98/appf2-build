import {describe,it,expect,afterEach,vi} from "vitest";
import {savedCandidateTarget,readSavedCandidateLibrary,chooseSavedCandidate,saveTarget}
 from "../../src/app/code-builder/agent-browser-client.js";
const SLOT="appf2.agent.candidate.job.v1";
const target={jobId:"ba45436c-c3f1-44f1-adc6-bdd0fb1592e7",
 prompt:"幫我做一個可以計分的骰子遊戲",firstModelKey:"agent_first_12345678"};
function memory(){
 const records=new Map<string,string>();
 return {getItem:(key:string)=>records.get(key)??null,
  setItem:(key:string,v:string)=>{records.set(key,v);},
  removeItem:(key:string)=>{records.delete(key);}};
}
afterEach(()=>vi.unstubAllGlobals());
describe("Durable signed Agent target across browser tabs",()=>{
 it("recovers the exact saved job in a new tab without sessionStorage",()=>{
  const persistent=memory(),tab=memory();
  persistent.setItem(SLOT,JSON.stringify({...target,savedAt:Date.now()}));
  vi.stubGlobal("localStorage",persistent);
  vi.stubGlobal("sessionStorage",tab);
  expect(savedCandidateTarget()).toEqual(target);
  expect(tab.getItem(SLOT)).toBeNull();
 });
 it("expires saved target after signing-key 24-hour horizon",()=>{
  const local=memory();
  local.setItem(SLOT,JSON.stringify({...target,
   savedAt:Date.now()-24*60*60*1000-1000}));
  vi.stubGlobal("localStorage",local);
  vi.stubGlobal("sessionStorage",memory());
  expect(savedCandidateTarget()).toBeNull();
  expect(local.getItem(SLOT)).toBeNull();
 });
 it("rejects corrupt browser profile data and preserves legacy same-tab jobs",()=>{
  const local=memory(),tab=memory();
  vi.stubGlobal("localStorage",local);
  vi.stubGlobal("sessionStorage",tab);
  tab.setItem(SLOT,JSON.stringify(target));
  expect(savedCandidateTarget()).toEqual(target);
  local.setItem(SLOT,"not-json");
  expect(savedCandidateTarget()).toBeNull();
 });
});

describe("Sprint 3.5 multi-project reusable saved Agent cards",()=>{
 it("keeps two separate projects; choosing earlier one never re-creates it",()=>{
  const persistent=memory(),tab=memory();
  vi.stubGlobal("localStorage",persistent);
  vi.stubGlobal("sessionStorage",tab);
  const another={...target,
   jobId:"da4d1bd2-2cce-4c96-a197-637b5e71a3bd",
   prompt:"建立一個有篩選條件的專案管理 App"};
  saveTarget(target);
  const first=readSavedCandidateLibrary()[0];
  expect(first?.jobId).toBe(target.jobId);
  saveTarget(another);
  expect(readSavedCandidateLibrary().map(x=>x.jobId))
   .toEqual([another.jobId,target.jobId]);
  expect(savedCandidateTarget()?.jobId).toBe(another.jobId);
  expect(chooseSavedCandidate(target.jobId)).toBe(true);
  expect(savedCandidateTarget()).toEqual(target);
  // Same project replan must update its pointer, NOT renew proof-key expiry.
  saveTarget(target);
  expect(readSavedCandidateLibrary()[0]?.savedAt).toBe(first?.savedAt);
  expect(readSavedCandidateLibrary().map(x=>x.jobId))
   .toEqual([target.jobId,another.jobId]);
 });
 it("migrates the previous single-project record without recharging",()=>{
  const persistent=memory(),tab=memory();
  vi.stubGlobal("localStorage",persistent);
  vi.stubGlobal("sessionStorage",tab);
  const savedAt=Date.now()-90000;
  persistent.setItem(SLOT,JSON.stringify({...target,savedAt}));
  expect(readSavedCandidateLibrary()).toEqual([{...target,savedAt}]);
  saveTarget(target);
  expect(readSavedCandidateLibrary()[0]?.savedAt).toBe(savedAt);
 });
 it("never restores expired, corrupt, duplicate or forged catalog cards",()=>{
  const persistent=memory(),tab=memory();
  vi.stubGlobal("localStorage",persistent);
  vi.stubGlobal("sessionStorage",tab);
  const now=Date.now();
  const list=[
   {...target,savedAt:now-25*60*60*1000},
   {...target,savedAt:now},
   {...target,savedAt:now},
   {...target,jobId:"not-a-uuid",savedAt:now},
   {...target,jobId:"da4d1bd2-2cce-4c96-a197-637b5e71a3bd",
    savedAt:now+90000},
  ];
  persistent.setItem("appf2.agent.candidate.library.v1",JSON.stringify(list));
  expect(readSavedCandidateLibrary().map(x=>x.jobId)).toEqual([target.jobId]);
  expect(chooseSavedCandidate("da4d1bd2-2cce-4c96-a197-637b5e71a3bd")).toBe(false);
  expect(tab.getItem(SLOT)).toBeNull();
 });
 it("limits project cards to eight recent saved jobs",()=>{
  const persistent=memory(),tab=memory();
  vi.stubGlobal("localStorage",persistent);
  vi.stubGlobal("sessionStorage",tab);
  for(let i=1;i<=10;i++){
   saveTarget({...target,jobId:
    i.toString(16).padStart(8,"0")+"-0000-4000-8000-000000000000"});
  }
  const cards=readSavedCandidateLibrary();
  expect(cards).toHaveLength(8);
  expect(cards[0]?.jobId).toContain("0000000a");
  expect(cards.some(x=>x.jobId.startsWith("00000001"))).toBe(false);
 });
});
