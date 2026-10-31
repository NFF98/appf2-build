import {describe,it,expect,afterEach,vi} from "vitest";
import {mayResumeSavedModel,savedBrowserQaAttemptState,savedQaObservedChecks}
 from "../../src/edge/agent-progress.js";
import {savedCandidateTarget,readSavedCandidateLibrary,chooseSavedCandidate,saveTarget,
 paidAgentReconciliationRequired,provenPreviewBuildAndTest,savedPreviewPair}
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
 it("retains Agent targets 25 hours, but expires after 30 days",()=>{
  const local=memory();
  local.setItem(SLOT,JSON.stringify({...target,
   savedAt:Date.now()-25*60*60*1000}));
   vi.stubGlobal("localStorage",local);
   vi.stubGlobal("sessionStorage",memory());
   expect(savedCandidateTarget()).toEqual(target);
   local.setItem(SLOT,JSON.stringify({...target,
    savedAt:Date.now()-30*24*60*60*1000-1000}));
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
   {...target,savedAt:now-31*24*60*60*1000},
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
 it("retains 32 distinct resumable Agent project cards",()=>{
  const persistent=memory(),tab=memory();
  vi.stubGlobal("localStorage",persistent);
  vi.stubGlobal("sessionStorage",tab);
  for(let i=1;i<=34;i++){
   saveTarget({...target,jobId:
    i.toString(16).padStart(8,"0")+"-0000-4000-8000-000000000000"});
  }
  const cards=readSavedCandidateLibrary();
  expect(cards).toHaveLength(32);
  expect(cards[0]?.jobId).toContain("00000022");
  expect(cards.some(x=>x.jobId.startsWith("00000001"))).toBe(false);
 });
});


describe("Sprint 3.5 Agent recovery must not spend through ambiguous model calls",()=>{
 it("can resume exactly one ready saved model call when nothing is pending",()=>{
  expect(mayResumeSavedModel(["CURRENT_MODEL_READY"],2,false,"CODING")).toBe(true);
 });
 it("blocks ready response when a newer or older paid call remains unresolved",()=>{
  for(const unresolved of ["MODEL_PENDING","MODEL_UNCERTAIN"] as const){
   expect(mayResumeSavedModel(["CURRENT_MODEL_READY",unresolved],
    2,false,"CODING")).toBe(false);
   expect(mayResumeSavedModel([unresolved,"CURRENT_MODEL_READY"],
    2,false,"REPAIRING")).toBe(false);
  }
 });
 it("requires real step budget, exclusive ready call and nonterminal job state",()=>{
  expect(mayResumeSavedModel(["CURRENT_MODEL_READY"],0,false,"CODING")).toBe(false);
  expect(mayResumeSavedModel(["CURRENT_MODEL_READY"],5,true,"TESTING")).toBe(false);
  expect(mayResumeSavedModel(["CURRENT_MODEL_READY","CURRENT_MODEL_READY"],
   5,false,"CODING")).toBe(false);
  expect(mayResumeSavedModel(["CURRENT_MODEL_READY"],5,false,"READY")).toBe(false);
 });
});

describe("Sprint 3.5 saved Browser QA recovery without repeat charges",()=>{
 it("reports no prior QA when the journal has no row",()=>{
  expect(savedBrowserQaAttemptState(undefined)).toBe("NOT_RUN");
 });
 it("distinguishes ambiguous in-flight QA from a completed saved receipt",()=>{
  expect(savedBrowserQaAttemptState({status:"IN_FLIGHT",receipt_json:null}))
   .toBe("IN_FLIGHT");
  expect(savedBrowserQaAttemptState({status:"BLOCKED_UNCERTAIN",receipt_json:null}))
   .toBe("BLOCKED_UNCERTAIN");
  expect(savedBrowserQaAttemptState({status:"SUCCEEDED",receipt_json:{
   ready_for_review:true,packet:{sealed:"evidence"}}})).toBe("RESULT_RECORDED");
  expect(savedBrowserQaAttemptState({status:"SUCCEEDED",receipt_json:{
   ready_for_review:false,packet:null}})).toBe("RESULT_RECORDED");
 });
 it("never treats forged, incomplete or contradictory browser receipts as recorded",()=>{
  for(const receipt_json of [null,{},[],{ready_for_review:true,packet:null},
   {ready_for_review:false,packet:{}},{ready_for_review:"PASS",packet:{}},
   {ready_for_review:true,packet:[]}])
   expect(savedBrowserQaAttemptState({status:"SUCCEEDED",receipt_json}))
    .toBe("BLOCKED_UNCERTAIN");
 });
});

describe("Sprint 3.5 real browser paid model reconciliation after interrupted job",()=>{
 const call=(state:string)=>({model_call_key:"agent_first_12345678",state,
  tool:null,requires_container_consent:false});
 it("stops first paid planning when DB reports normalized uncertain/pending model",()=>{
  expect(paidAgentReconciliationRequired({
   next_action:"AWAIT_MODEL_RECONCILIATION",calls:[]})).toBe(true);
  expect(paidAgentReconciliationRequired({
   next_action:"SIGN_NEXT_SEQUENCE",calls:[call("MODEL_UNCERTAIN")]})).toBe(true);
  expect(paidAgentReconciliationRequired({
   next_action:"SIGN_NEXT_SEQUENCE",calls:[call("MODEL_PENDING")]})).toBe(true);
 });
 it("does not block a clean first plan or already proven saved result",()=>{
  expect(paidAgentReconciliationRequired({
   next_action:"NO_PROVEN_PENDING_MODEL",calls:[]})).toBe(false);
  expect(paidAgentReconciliationRequired({
   next_action:"SIGN_NEXT_SEQUENCE",calls:[call("CURRENT_MODEL_READY")]}))
   .toBe(false);
 });
});

describe("Sprint 3.5 saved Browser QA checks are real read-only progress",()=>{
 const good={status:"SUCCEEDED",receipt_json:{
  ready_for_review:false,packet:null,checks:[{
   criterion_id:"score_changes",category:"BROWSER",verdict:"FAIL",evidence_hash:null},{
   criterion_id:"button_click",category:"BROWSER",verdict:"PASS",
   evidence_hash:"sha256:"+"a".repeat(64)}]}};
 it("rehydrates failed and passed browser observations without another QA",()=>{
  expect(savedQaObservedChecks(good)).toEqual([
   {criterion_id:"score_changes",verdict:"FAIL",evidence_hash:null},
   {criterion_id:"button_click",verdict:"PASS",evidence_hash:"sha256:"+"a".repeat(64)}
  ]);
 });
 it("refuses unverifiable observations, malformed hashes or invented result IDs",()=>{
  expect(savedQaObservedChecks(undefined)).toEqual([]);
  expect(savedQaObservedChecks({...good,status:"IN_FLIGHT"})).toEqual([]);
  expect(savedQaObservedChecks({...good,receipt_json:{
   ...good.receipt_json,checks:[{criterion_id:"score_changes",
    category:"BROWSER",verdict:"PASS",evidence_hash:null}]}})).toEqual([]);
  expect(savedQaObservedChecks({...good,receipt_json:{
   ...good.receipt_json,checks:[{criterion_id:"score_changes",
    category:"BROWSER",verdict:"FAIL",evidence_hash:null},{
    criterion_id:"score_changes",category:"BROWSER",verdict:"FAIL",evidence_hash:null}]}}))
   .toEqual([]);
  expect(savedQaObservedChecks({...good,receipt_json:{
   ...good.receipt_json,checks:[{criterion_id:"<img>",
    category:"BROWSER",verdict:"FAIL",evidence_hash:null}]}})).toEqual([]);
 });
});

describe("Sprint 3.5 actual saved build may precede read-only tools",()=>{
 const build={state:"ALREADY_APPLIED",tool:"run_build",call_id:"call_build_1234"};
 it("selects verified build before an intervening inspect and latest test",()=>{
  const ids=["call_build_1234","call_inspect_9999","call_test_1234"];
  expect(provenPreviewBuildAndTest(ids,[build,{state:"ALREADY_APPLIED",
   tool:"inspect_project",call_id:"call_inspect_9999"}]))
   .toEqual({build:"call_build_1234",test:"call_test_1234"});
 });
 it("selects the most recent proven build, not an obsolete build",()=>{
  expect(provenPreviewBuildAndTest([
   "call_build_old","call_build_new","call_read_1234","call_test_1234"],[
   {...build,call_id:"call_build_old"},
   {...build,call_id:"call_build_new"}]))
   .toEqual({build:"call_build_new",test:"call_test_1234"});
 });
 it("supports ordinary adjacent build/test and refuses missing/out-of-order proof",()=>{
  expect(provenPreviewBuildAndTest(["call_build_1234","call_test_1234"],[]))
   .toEqual({build:"call_build_1234",test:"call_test_1234"});
  expect(provenPreviewBuildAndTest(["call_test_1234"],[build])).toBeNull();
  expect(provenPreviewBuildAndTest(["call_test_1234","call_build_1234"],[
   build])).toBeNull();
  expect(provenPreviewBuildAndTest([
   "call_build_1234","call_inspect_9999","call_test_1234"],[
   build,{state:"ALREADY_APPLIED",tool:"inspect_project",
    call_id:"call_inspect_9999"},
   {state:"ALREADY_APPLIED",tool:"run_build",
    call_id:"call_test_1234"}])).toBeNull();
 });
});

describe("Sprint 3.5 preview uses authoritative full-checkpoint server proof",()=>{
 const ids=["call_build_old","call_inspect_1","call_test_new"];
 const progress={revision:3,remaining_steps:2,can_resume:false,
  resume_model_call_key:null,next_action:"VERIFY_INDEPENDENT_QA",
  calls:[] as {model_call_key:string;state:string;tool:string|null;
   requires_container_consent:boolean}[]};
 it("uses signed server pair even when original build is absent from recent 8 calls",()=>{
  expect(savedPreviewPair({...progress,proven_preview_pair:{
   build_call_id:"call_build_old",test_call_id:"call_test_new"}},ids))
   .toEqual({build:"call_build_old",test:"call_test_new"});
 });
 it("fails closed when authoritative server explicitly denies provenance",()=>{
  expect(savedPreviewPair({...progress,proven_preview_pair:null},ids))
   .toBeNull();
 });
 it("rejects forged server pair outside immutable checkpoint",()=>{
  expect(savedPreviewPair({...progress,proven_preview_pair:{
   build_call_id:"call_other",test_call_id:"call_test_new"}},ids))
   .toBeNull();
 });
});
