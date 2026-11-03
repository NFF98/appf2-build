import {beforeEach,describe,expect,it,vi} from "vitest";
import {createProjectSnapshot,applyProjectEdits,verifyProjectSnapshot}
 from "../../src/platform/agent/project-workspace.js";
import {saveSafeStyleCandidate,safeStyleCss,validSafeStyleEditInput}
 from "../../src/edge/agent-safe-style-edit.js";
import {recoverAgentJob,advanceDurableAgentJob}
 from "../../src/platform/agent/durable-agent-service.js";
import {readFreeCiSmoke} from "../../src/edge/free-ci-result.js";
import type {AgentJobExecutor,AgentJobRow}
 from "../../src/platform/agent/postgres-agent-jobs.js";

vi.mock("../../src/platform/agent/durable-agent-service.js",()=>({
 recoverAgentJob:vi.fn(),advanceDurableAgentJob:vi.fn()
}));
vi.mock("../../src/edge/free-ci-result.js",()=>({
 readFreeCiSmoke:vi.fn(),
 frozenFreeCiPlanHash:vi.fn(async()=>"sha256:"+"a".repeat(64))
}));

const owner="a501ed0f-f0ab-46dc-b880-c0acb35291a0";
const jobId="b501ed0f-f0ab-46dc-b880-c0acb35291a0";
const hash="sha256:"+"a".repeat(64);
const frozen={version:"1",criteria:[{
 id:"inc",source_quote:"按新增",description:"計數增加",automatable:true,
 steps:[{action:"click",role:"button",name:"新增"}],
 assertions:[{kind:"text_appears",text:"計數：1"}]
}]};
const checked={status:"BUILD_BROWSER_SMOKE",run_id:"123",artifact_hash:hash,
 preview_ready:true,qa_plan_hash:hash,
 qa_checks:[{criterion_id:"inc",verdict:"PASS",evidence_hash:hash}],
 original_requirements_qa:false,app_published:false} as const;

async function setup(){
 const initial=await createProjectSnapshot("VITE_WEB","index.html",[
  {path:"index.html",content:"<main id='app'></main>"},
  {path:"src/style.css",content:"body{margin:0;background:white}"},
  {path:"src/main.ts",content:"document.querySelector('#app')"}
 ]);
 const job:AgentJobRow={
  job_id:jobId,owner_anonymous_id:owner,request_hash:hash,
  project_hash:project.project_hash,revision:2,checkpoint_hash:hash,
  job_state:"CODING",checkpoint:{
   version:"APPF2_AGENT_CHECKPOINT_V1",job_id:jobId,state:"CODING",
   project_hash:project.project_hash,step:2,tokens_used:80,cost_cents:20,
   budget:{max_steps:8,max_tokens:8192,max_cost_cents:60},
   completed_call_ids:[],previous_checkpoint_id:hash
  }
 };
 const db:AgentJobExecutor={query:async <T>(sql:string)=>{
  if(sql.includes("owner_key_thumbprint"))
   return {rows:[{job_id:jobId} as T]};
  if(sql.includes("appf2_agent_qa_plan"))
   return {rows:[{original_plan:frozen} as T]};
  return {rows:[]};
 }};
 vi.mocked(recoverAgentJob).mockResolvedValue({job,project});
 vi.mocked(readFreeCiSmoke).mockResolvedValue(checked);
 vi.mocked(advanceDurableAgentJob).mockImplementation(async(_db,prior,_owner,next,p)=>{
  if(!p||p.parent_hash!==prior.project_hash||
   next.cost_cents!==prior.checkpoint.cost_cents||
   next.tokens_used!==prior.checkpoint.tokens_used)
   throw Error("FAKE_CAS_INVALID");
  return {job:{...prior,revision:prior.revision+1,
   project_hash:p.project_hash,checkpoint:{...next}},project:p};
 });
 const input={anonymous_id:owner,expected_revision:2,
  expected_project_hash:project.project_hash,theme:"blue" as const};
 return {db,job,project,input};
}

describe("SP35 signed existing-App safe edit without paid model",()=>{
 beforeEach(()=>{vi.clearAllMocks();});
 it("accepts only exact colour-only signed bodies",async()=>{
  const x=(await setup()).input;
  expect(validSafeStyleEditInput(x)).toBe(true);
  expect(validSafeStyleEditInput({...x,theme:"https://evil.invalid"})).toBe(false);
  expect(validSafeStyleEditInput({...x,prompt:"rewrite all"})).toBe(false);
  expect(validSafeStyleEditInput({...x,expected_revision:-1})).toBe(false);
 });
 it("appends bounded CSS once and rejects duplicate, oversized and forged markers",()=>{
  const original="body{margin:0}";
  const blue=safeStyleCss(original,"blue");
  expect(blue).toContain("background-color: #e8f1ff");
  expect(()=>safeStyleCss(blue,"blue")).toThrow("SP35_STYLE_NO_CHANGE_OR_OVERSIZE");
  expect(safeStyleCss(blue,"green")).toContain("background-color: #e7f7ed");
  expect(()=>safeStyleCss(original+"/* APPF2_SAFE_STYLE_V1_BEGIN */","blue"))
   .toThrow("SP35_STYLE_MARKER_CORRUPTED");
  expect(()=>safeStyleCss("x".repeat(128001),"blue")).toThrow();
 });
 it("preserves original source, CAS lineage and charging; candidate is never published",async()=>{
  const {db,project,input}=await setup();
  const oldFile=project.files.find(f=>f.path==="src/style.css")!.content;
  const result=await saveSafeStyleCandidate(input,{db,jobId,ownerThumb:"f".repeat(64)});
  expect(result.status).toBe("STYLE_CANDIDATE_SAVED_QA_REQUIRED");
  expect(result.paid_ai_calls).toBe(0);
  expect(result.app_published).toBe(false);
  expect(result.previous_project_hash).toBe(project.project_hash);
  expect(result.project_hash).not.toBe(project.project_hash);
  expect(project.files.find(f=>f.path==="src/style.css")!.content).toBe(oldFile);
  const saved=vi.mocked(advanceDurableAgentJob).mock.calls[0]?.[4];
  expect(saved?.parent_hash).toBe(project.project_hash);
  expect(await verifyProjectSnapshot(saved)).toBe(true);
 });
 it("rejects wrong owner and stale expected revision before modifying source",async()=>{
  const {db,input,job}=await setup();
  await expect(saveSafeStyleCandidate(input,{db,jobId:"c501ed0f-f0ab-46dc-b880-c0acb35291a0",
   ownerThumb:"f".repeat(64)})).rejects.toThrow("SP35_STYLE_NOT_CREATOR");
  vi.mocked(recoverAgentJob).mockResolvedValue({job:{...job,revision:4},
   project:(await recoverAgentJob(db,jobId,owner))!.project});
  await expect(saveSafeStyleCandidate(input,{db,jobId,
   ownerThumb:"f".repeat(64)})).rejects.toThrow("SP35_STYLE_STALE_OR_NOT_ELIGIBLE");
  expect(advanceDurableAgentJob).not.toHaveBeenCalled();
 });
 it("fails closed on missing original QA or a regression in the old version",async()=>{
  const {db,input}=await setup();
  vi.mocked(readFreeCiSmoke).mockResolvedValue({...checked,
   qa_checks:[{criterion_id:"inc",verdict:"FAIL",evidence_hash:null}]});
  await expect(saveSafeStyleCandidate(input,{db,jobId,
   ownerThumb:"f".repeat(64)})).rejects.toThrow("SP35_STYLE_BASELINE_QA_NOT_PASS");
  expect(advanceDurableAgentJob).not.toHaveBeenCalled();
 });
});
