import {describe,it,expect,vi} from "vitest";
import {createProjectSnapshot,applyProjectEdits} from "../../src/platform/agent/project-workspace.js";
import {sha256CodeBytes} from "../../src/platform/blueprint/code-artifact-v2.js";
import {frozenFreeCiPlanHash} from "../../src/edge/free-ci-result.js";
import type {QaPlan} from "../../src/platform/qa/requirement-contract.js";
import type {AgentJobExecutor,AgentJobRow} from "../../src/platform/agent/postgres-agent-jobs.js";
import type {ModelCallRow} from "../../src/platform/agent/postgres-model-calls.js";

const fake=vi.hoisted(()=>({
 recover:vi.fn(),advance:vi.fn(),receipt:vi.fn(),dispatch:vi.fn()
}));
vi.mock("../../src/platform/agent/durable-agent-service.js",()=>({
 recoverAgentJob:fake.recover,advanceDurableAgentJob:fake.advance
}));
vi.mock("../../src/edge/free-ci-result.js",async importOriginal=>{
 const original=await importOriginal<typeof import("../../src/edge/free-ci-result.js")>();
 return {...original,readFreeCiSmoke:fake.receipt};
});
vi.mock("../../src/edge/free-ci-dispatch.js",()=>({
 dispatchFreeCiJob:fake.dispatch
}));
import {runFreeCiAiStage} from "../../src/edge/free-ci-ai-code.js";

const id="5e004598-0e72-4ab3-9987-0704926578c8";
const owner="927d0a33-48c0-4a2f-9ea4-2761db716273";
const oldHash="sha256:"+"a".repeat(64);
const halfHash="sha256:"+"b".repeat(64);
const prompt="請建立計分 App，按「加一」顯示「分數：1」。";
const plan:QaPlan={version:"1",criteria:[{
 id:"score",source_quote:"加一",description:"加一後顯示分數",
 automatable:true,steps:[{action:"click",role:"button",name:"加一"}],
 assertions:[{kind:"text_appears",text:"分數：1"}]
}]};

describe("C4 paid GPT-6 saved answer real source-write path after half committed Job CAS",()=>{
 it("writes recovered answer on original Job once without a second model reservation or POST",async()=>{
  vi.clearAllMocks();
  const initial=await createProjectSnapshot("VITE_WEB","index.html",[
   {path:"index.html",content:"<html><body><div id='app'></div></body></html>"},
   {path:"src/main.ts",content:"document.querySelector('#app')!.textContent='Bad';"},
   {path:"src/style.css",content:"body { color: black; }"}
  ]);
  const previous=initial.files.find(f=>f.path==="src/main.ts")!;
  const project=await applyProjectEdits(initial,initial.project_hash,[
   {operation:"replace",path:"src/main.ts",previous_hash:previous.hash,
    content:"document.querySelector('#app')!.textContent='Wrong';"}
  ]);
  const requestHash=await sha256CodeBytes(new TextEncoder().encode(
   "APPF2_AGENT_REQUEST_V1\u0000"+prompt));
  const checkpoint={version:"APPF2_AGENT_CHECKPOINT_V1" as const,
   job_id:id,state:"REPAIRING" as const,project_hash:project.project_hash,
   step:3,tokens_used:40,cost_cents:28,
   budget:{max_steps:8,max_tokens:8192,max_cost_cents:76},
   completed_call_ids:[] as string[],previous_checkpoint_id:oldHash};
  const half:AgentJobRow={
   job_id:id,owner_anonymous_id:owner,request_hash:requestHash,
   project_hash:project.project_hash,revision:3,
   checkpoint_hash:halfHash,checkpoint,job_state:"REPAIRING"
  };
  const goodMain="import './style.css'; const root = document.querySelector('#app'); if (root) {root.textContent='分數：1';}";
  const goodCss="body { color: navy; margin: 10px; }";
  const saved:ModelCallRow={
   job_id:id,owner_anonymous_id:owner,
   call_key:"sp35_free_ai_repair_v1",job_revision:2,
   checkpoint_hash:oldHash,request_hash:oldHash,
   model:"gpt-6.1-sol",max_charge_cents:16,status:"SUCCEEDED",
   response_json:{status:"completed",output:[{
    type:"message",content:[{type:"output_text",
     text:JSON.stringify({main_ts:goodMain,style_css:goodCss})}]
   }]},response_id:"resp_existing",input_tokens:200,output_tokens:400
  };
  const history=[{
   project_hash:project.project_hash,
   project_revision:project.revision,
   parent_hash:project.parent_hash,
   receipt_json:{version:"APPF2_FREE_CI_SMOKE_V1",
    qa_plan_hash:await frozenFreeCiPlanHash(plan),
    qa_checks:[{criterion_id:"score",verdict:"FAIL",
     evidence_hash:null,failure_code:"ASSERTION_FAILED"}],
    original_requirements_qa:false,app_published:false}
  }];
  const db={query:vi.fn(async(sql:string,params:readonly unknown[]=[])=>{
   if(sql.includes("owner_key_thumbprint"))
    return {rows:[{job_id:id}]};
   if(sql.includes("FROM public.appf2_agent_qa_plan"))
    return {rows:[{original_plan:plan}]};
   if(sql.includes("FROM public.appf2_agent_free_ci_receipt r"))
    return {rows:history};
   if(sql.includes("FROM public.appf2_agent_model_call"))
    return {rows:params[2]==="sp35_free_ai_repair_v1"?[saved]:[]};
   throw Error("UNEXPECTED_C4_DB_QUERY");
  })} as unknown as AgentJobExecutor;
  fake.recover.mockResolvedValue({job:half,project});
  fake.receipt.mockResolvedValue({status:"BUILD_BROWSER_SMOKE",
   qa_checks:history[0]!.receipt_json.qa_checks});
  fake.advance.mockImplementation(async(_db:unknown,prev:AgentJobRow,
   _owner:string,next:typeof checkpoint,source:typeof project)=>{
   return {job:{...prev,revision:4,job_state:"CODING" as const,
    checkpoint_hash:"sha256:"+"c".repeat(64),
    checkpoint:next,project_hash:source.project_hash},project:source};
  });
  fake.dispatch.mockResolvedValue({status:"FREE_CI_QUEUED"});
  const modelFetch=vi.spyOn(globalThis,"fetch").mockRejectedValue(
   Error("SECOND_MODEL_POST_IS_FORBIDDEN"));
  try{
   const result=await runFreeCiAiStage({
    anonymous_id:owner,original_prompt:prompt,
    expected_project_hash:project.project_hash,stage:"REPAIR",
    explicit_ai_consent:true,explicit_free_ci_consent:true
   },{db,jobId:id,ownerThumb:"stored-original-owner",
    modelKey:"sk-existing-server-only",githubToken:"github-token-strong-enough",
    ticketSecret:"existing-secret",nowMs:Date.now()});
   expect(result).toMatchObject({
    status:"AI_SOURCE_SAVED_FREE_CI_QUEUED",
    revision:4,repair_round:1,strategy_mode:"FIX_FAILED_CHECKS",
    paid_model_call_saved:true,app_published:false
   });
   expect(fake.advance).toHaveBeenCalledTimes(1);
   const call=fake.advance.mock.calls[0]!;
   expect(call[3]).toMatchObject({
    state:"CODING",step:4,cost_cents:44,
    previous_checkpoint_id:halfHash});
   expect(call[4].revision).toBe(3);
   expect(call[4].files.find((file:{path:string})=>
    file.path==="src/main.ts").content).toBe(goodMain);
   expect(fake.dispatch).toHaveBeenCalledTimes(1);
   expect(modelFetch).not.toHaveBeenCalled();
   expect(db.query).not.toHaveBeenCalledWith(
    expect.stringContaining("reserve_agent_model_call"),expect.anything());
  }finally{modelFetch.mockRestore();}
 });

});
describe("C4 initial CODE saved response after half checkpoint",()=>{
 it("resumes first saved paid CODE from PLANNING to a new source without a second charge",async()=>{
  vi.clearAllMocks();
  const project=await createProjectSnapshot("VITE_WEB","index.html",[
   {path:"index.html",content:"<html><body><div id='app'></div></body></html>"},
   {path:"src/main.ts",content:"document.querySelector('#app')!.textContent='Waiting';"},
   {path:"src/style.css",content:"body { color: black; }"}
  ]);
  const requestHash=await sha256CodeBytes(new TextEncoder().encode(
   "APPF2_AGENT_REQUEST_V1\u0000"+prompt));
  const half:AgentJobRow={job_id:id,owner_anonymous_id:owner,
   request_hash:requestHash,project_hash:project.project_hash,
   revision:1,job_state:"PLANNING",checkpoint_hash:halfHash,
   checkpoint:{version:"APPF2_AGENT_CHECKPOINT_V1",job_id:id,
    state:"PLANNING",project_hash:project.project_hash,
    step:1,tokens_used:100,cost_cents:8,
    budget:{max_steps:8,max_tokens:8192,max_cost_cents:76},
    completed_call_ids:[],previous_checkpoint_id:oldHash}
  };
  const goodMain="import './style.css'; const root=document.querySelector('#app'); if (root) root.textContent='分數：1';";
  const goodCss="body { font-size: 16px; }";
  const saved:ModelCallRow={job_id:id,owner_anonymous_id:owner,
   call_key:"sp35_free_ai_code_v1",job_revision:0,
   checkpoint_hash:oldHash,request_hash:oldHash,
   model:"gpt-6.1-sol",max_charge_cents:20,status:"SUCCEEDED",
   response_json:{status:"completed",output:[{type:"message",
    content:[{type:"output_text",
     text:JSON.stringify({main_ts:goodMain,style_css:goodCss})}]}]},
   response_id:"resp_paid_saved_code",input_tokens:200,output_tokens:300
  };
  const db={query:vi.fn(async(sql:string,params:readonly unknown[]=[])=>{
   if(sql.includes("owner_key_thumbprint"))return {rows:[{job_id:id}]};
   if(sql.includes("FROM public.appf2_agent_qa_plan"))
    return {rows:[{original_plan:plan}]};
   if(sql.includes("FROM public.appf2_agent_model_call"))
    return {rows:params[2]==="sp35_free_ai_code_v1"?[saved]:[]};
   throw Error("UNEXPECTED_INITIAL_CODE_DB_QUERY");
  })} as unknown as AgentJobExecutor;
  fake.recover.mockResolvedValue({job:half,project});
  fake.advance.mockImplementation(async(_db:unknown,prev:AgentJobRow,
   _owner:string,next:AgentJobRow["checkpoint"],
   source:typeof project)=>({
    job:{...prev,revision:2,job_state:"CODING" as const,
     checkpoint_hash:"sha256:"+"c".repeat(64),
     checkpoint:next,project_hash:source.project_hash},
    project:source
   }));
  fake.dispatch.mockResolvedValue({status:"FREE_CI_QUEUED"});
  const modelFetch=vi.spyOn(globalThis,"fetch").mockRejectedValue(
   Error("SECOND_PAID_AI_POST_IS_FORBIDDEN"));
  try{
   const result=await runFreeCiAiStage({
    anonymous_id:owner,original_prompt:prompt,
    expected_project_hash:project.project_hash,stage:"CODE",
    explicit_ai_consent:true,explicit_free_ci_consent:true
   },{db,jobId:id,ownerThumb:"stored-original-owner",
    modelKey:"sk-existing-server-only",githubToken:"github-token-strong-enough",
    ticketSecret:"existing-secret",nowMs:Date.now()});
   expect(result).toMatchObject({status:"AI_SOURCE_SAVED_FREE_CI_QUEUED",
    revision:2,paid_model_call_saved:true,app_published:false});
   expect(fake.advance).toHaveBeenCalledTimes(1);
   const call=fake.advance.mock.calls[0]!;
   expect(call[3]).toMatchObject({state:"CODING",step:2,
    cost_cents:28,previous_checkpoint_id:halfHash});
   expect(call[4].revision).toBe(2);
   expect(call[4].files.find((v:{path:string})=>
    v.path==="src/main.ts").content).toBe(goodMain);
   expect(modelFetch).not.toHaveBeenCalled();
   expect(db.query).not.toHaveBeenCalledWith(
    expect.stringContaining("reserve_agent_model_call"),expect.anything());
   expect(fake.dispatch).toHaveBeenCalledTimes(1);
  }finally{modelFetch.mockRestore();}
 });
});
