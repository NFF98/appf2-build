import {describe,it,expect,afterEach,vi} from "vitest";
import {savedCandidateTarget} from "../../src/app/code-builder/agent-browser-client.js";
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
