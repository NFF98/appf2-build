/**
 * Sprint 3.5 private candidate API — durable project create/reopen, NO AI spend.
 * Each mutation requires a fresh PoP signature and exact first-party Origin.
 * An anonymous_id alone is never an authentication credential.
 */
import {verifyMutationProof} from "./create-proof.js";
import {executeFirstAgentModelPlan,validModelPlanBody} from "./agent-model-plan.js";
import {applyStoredModelEdit,validApplyModelEditBody} from "./agent-model-apply.js";
import {executeAgentModelContinuation,validModelContinueBody} from "./agent-model-continue.js";
import {readAgentModelCallStatus,validModelStatusBody} from "./agent-model-status.js";
import {extendSignedAgentBudget,validExtendBudgetBody} from "./agent-budget-extend.js";
import {executeSignedSandboxTool,validSandboxRunBody,
 type SandboxRunDeps} from "./agent-sandbox-run.js";
import {runSignedAgentStep,validAutoStepBody} from "./agent-auto-step.js";
import {runSignedAgentSequence,validAgentSequenceBody} from "./agent-sequence.js";
import {inspectAgentProgress,validAgentProgressBody} from "./agent-progress.js";
import {reviewAgentQa,validQaReviewBody} from "./agent-qa-review.js";
import {runSignedIndependentBrowserQa,validBrowserQaRunBody} from "./agent-qa-run.js";
import {executeSignedQaRepair,validQaRepairBody} from "./agent-qa-repair.js";
import {freezeAgentQaPlan,validFreezeQaPlanBody} from "./agent-qa-plan.js";
import {readSignedPreviewAsset,validPreviewAssetBody} from "./agent-preview-asset.js";
import {generateAndFreezeOriginalQa,validGenerateQaBody} from "./agent-qa-generate.js";
import type {PaidModelTurnDeps} from "../platform/agent/journaled-model-gateway.js";
import {WorkerPostgresExecutor,type WorkerRequestDbContext}
 from "../platform/blueprint/worker-postgres-executor.js";
import {startDurableAgentJob,recoverAgentJob}
 from "../platform/agent/durable-agent-service.js";
import {createProjectSnapshot} from "../platform/agent/project-workspace.js";
import {sha256CodeBytes} from "../platform/blueprint/code-artifact-v2.js";
import type {AgentCheckpoint} from "../platform/agent/agent-contract.js";
import type {AgentJobExecutor} from "../platform/agent/postgres-agent-jobs.js";
import type {Appf2WorkerEnv} from "./worker-composition.js";

const CREATE="/api/v1/agent-jobs";
const MODEL_ITEM=/^\/api\/v1\/agent-jobs\/([0-9a-f-]{36})\/model-plan$/u;
const APPLY_ITEM=/^\/api\/v1\/agent-jobs\/([0-9a-f-]{36})\/apply-plan$/u;
const CONTINUE_ITEM=/^\/api\/v1\/agent-jobs\/([0-9a-f-]{36})\/model-continue$/u;
const STATUS_ITEM=/^\/api\/v1\/agent-jobs\/([0-9a-f-]{36})\/model-status$/u;
const SANDBOX_ITEM=/^\/api\/v1\/agent-jobs\/([0-9a-f-]{36})\/sandbox-run$/u;
const AUTOSTEP_ITEM=/^\/api\/v1\/agent-jobs\/([0-9a-f-]{36})\/auto-step$/u;
const SEQUENCE_ITEM=/^\/api\/v1\/agent-jobs\/([0-9a-f-]{36})\/agent-sequence$/u;
const PROGRESS_ITEM=/^\/api\/v1\/agent-jobs\/([0-9a-f-]{36})\/agent-progress$/u;
const BUDGET_ITEM=/^\/api\/v1\/agent-jobs\/([0-9a-f-]{36})\/extend-budget$/u;
const QA_REVIEW_ITEM=/^\/api\/v1\/agent-jobs\/([0-9a-f-]{36})\/qa-review$/u;
const QA_RUN_ITEM=/^\/api\/v1\/agent-jobs\/([0-9a-f-]{36})\/qa-run$/u;
const QA_REPAIR_ITEM=/^\/api\/v1\/agent-jobs\/([0-9a-f-]{36})\/qa-repair$/u;
const QA_PLAN_ITEM=/^\/api\/v1\/agent-jobs\/([0-9a-f-]{36})\/qa-plan$/u;
const PREVIEW_ITEM=/^\/api\/v1\/agent-jobs\/([0-9a-f-]{36})\/preview-asset$/u;
const QA_GENERATE_ITEM=/^\/api\/v1\/agent-jobs\/([0-9a-f-]{36})\/qa-generate$/u;
const ITEM=/^\/api\/v1\/agent-jobs\/([0-9a-f-]{36})$/u;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEY=/^[A-Za-z0-9_-]{8,128}$/u;
const HEADERS={"Content-Type":"application/json; charset=utf-8",
 "Cache-Control":"private, no-store"};
type Db=AgentJobExecutor&{close:()=>Promise<void>};
export type AgentJobRouteDeps={
 readonly db?:(env:Appf2WorkerEnv,context:WorkerRequestDbContext)=>Db;
 readonly newJobId?:()=>string;
 readonly sendModel?:PaidModelTurnDeps["send"];
 readonly sendSandbox?:SandboxRunDeps["send"];
};
export type AgentJobRouteContext={
 readonly request:Request;readonly url:URL;readonly env:Appf2WorkerEnv;
 readonly nowMs:number;readonly deps?:AgentJobRouteDeps;
};
const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),
 {status,headers:HEADERS});
const denied=()=>json(404,{error:"AGENT_JOB_NOT_FOUND"});
function isObject(x:unknown):x is Record<string,unknown>{
 return typeof x==="object"&&x!==null&&!Array.isArray(x);
}
type VerifiedJobBody={anonymous_id:string;prompt?:string;max_cost_cents?:number;explicit_ai_consent?:boolean};
// eslint-disable-next-line complexity -- Explicit AI consent and zero-cost default must remain fail-closed.
function verifiedBody(raw:unknown,create:boolean):VerifiedJobBody|null{
 if(!isObject(raw)||!UUID.test(String(raw.anonymous_id)))return null;
 const fields=Object.keys(raw).sort().join(",");
 if(create){
  const permitted=fields==="anonymous_id,prompt"||
   fields==="anonymous_id,explicit_ai_consent,max_cost_cents,prompt";
  if(!permitted||typeof raw.prompt!=="string"||
   raw.prompt.trim().length<5||raw.prompt.length>800)return null;
  if(fields!=="anonymous_id,prompt"&&(
   raw.explicit_ai_consent!==true||typeof raw.max_cost_cents!=="number"||
   !Number.isSafeInteger(raw.max_cost_cents)||raw.max_cost_cents<1||
   raw.max_cost_cents>100))return null;
  return {anonymous_id:String(raw.anonymous_id),prompt:raw.prompt.trim(),
   ...(fields==="anonymous_id,prompt"?{}:
    {max_cost_cents:raw.max_cost_cents as number,explicit_ai_consent:true})};
 }
 return fields==="anonymous_id"?{anonymous_id:String(raw.anonymous_id)}:null;
}
function sameOrigin(request:Request,url:URL):boolean{
 const site=request.headers.get("Sec-Fetch-Site");
 return request.headers.get("Origin")===url.origin&&
  (site===null||site==="same-origin");
}
async function keyDigest(thumbprint:string):Promise<string>{
 const hash=await sha256CodeBytes(new TextEncoder().encode(
  "APPF2_AGENT_OWNER_P256_V1\u0000"+thumbprint));
 return hash.slice("sha256:".length);
}
async function requestHash(prompt:string):Promise<string>{
 return sha256CodeBytes(new TextEncoder().encode("APPF2_AGENT_REQUEST_V1\u0000"+prompt));
}
/** Safe initial source: no untrusted script interpolation, dependency downloads or execution. */
export async function createInitialAgentProject(prompt:string){
 const title=prompt.trim().slice(0,90);
 return createProjectSnapshot("VITE_WEB","index.html",[
  {path:"index.html",content:`<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>`},
  {path:"src/main.ts",content:`import "./style.css";const app=document.querySelector<HTMLDivElement>("#app");if(!app)throw Error("root missing");const h=document.createElement("h1");h.textContent="APPf2 候選專案";const p=document.createElement("p");p.textContent=${JSON.stringify(title)};const status=document.createElement("p");status.textContent="已保存初始專案；AI 生成尚未開始";app.replaceChildren(h,p,status);`},
  {path:"src/style.css",content:"body{font-family:system-ui,sans-serif;margin:0;padding:32px;background:#f8fafc;color:#172033}#app{max-width:720px;margin:auto;background:white;padding:32px;border-radius:18px;box-shadow:0 8px 30px #0001}"},
  {path:"package.json",content:JSON.stringify({name:"appf2-candidate",private:true,type:"module",scripts:{build:"vite build"},devDependencies:{vite:"^6.0.0",typescript:"^5.0.0"}})}
 ]);
}
// eslint-disable-next-line max-params -- DB, PoP-bound owner and input are separate trust boundaries.
async function create(db:Db,owner:string,thumb:string,key:string,
 input:VerifiedJobBody,newJobId:()=>string):Promise<Response>{
 const prompt=input.prompt??"";
 const project=await createInitialAgentProject(prompt);
 const jobId=newJobId();
 const checkpoint:AgentCheckpoint={
  version:"APPF2_AGENT_CHECKPOINT_V1",job_id:jobId,state:"CREATED",
  project_hash:project.project_hash,step:0,tokens_used:0,cost_cents:0,
  budget:{max_steps:8,max_tokens:8192,max_cost_cents:input.max_cost_cents??0},
  completed_call_ids:[],previous_checkpoint_id:null
 };
 const saved=await startDurableAgentJob(db,{job_id:jobId,owner,thumbprint:thumb,
  idempotency:key,request_hash:await requestHash(prompt),checkpoint,project});
 return json(201,{data:{job_id:saved.job.job_id,
  status:saved.job.job_state,revision:saved.job.revision,
  project_hash:saved.project.project_hash,
  files:saved.project.files.map(f=>({path:f.path,bytes:f.bytes})),
  ai_started:false,app_published:false,
  approved_max_cost_cents:checkpoint.budget.max_cost_cents}});
}
async function read(db:Db,owner:string,thumb:string,jobId:string):Promise<Response>{
 if(!UUID.test(jobId))return denied();
 // Independent identity assertion: anonymous UUID alone NEVER grants source access.
 const matches=await db.query<{job_id:string}>(`SELECT job_id::text
  FROM public.appf2_agent_job WHERE job_id=$1::uuid
  AND owner_anonymous_id=$2::uuid AND owner_key_thumbprint=$3::text LIMIT 1`,
  [jobId,owner,thumb]);
 if(matches.rows[0]?.job_id!==jobId)return denied();
 const recovered=await recoverAgentJob(db,jobId,owner);
 if(!recovered)return denied();
 return json(200,{data:{job_id:recovered.job.job_id,status:recovered.job.job_state,
  revision:recovered.job.revision,project_hash:recovered.project.project_hash,
  files:recovered.project.files,checkpoint:recovered.job.checkpoint,
  ai_started:recovered.job.checkpoint.step>0,app_published:false}});
}
/** Return undefined only if this is not one of our routes. */
// eslint-disable-next-line complexity, max-lines-per-function -- Independent origin, PoP, size, schema and owner gates must fail closed.
export async function routeAgentJobs(ctx:AgentJobRouteContext):Promise<Response|undefined>{
 const {request,url,env,nowMs}=ctx,match=ITEM.exec(url.pathname),modelMatch=MODEL_ITEM.exec(url.pathname),applyMatch=APPLY_ITEM.exec(url.pathname),continueMatch=CONTINUE_ITEM.exec(url.pathname),statusMatch=STATUS_ITEM.exec(url.pathname),sandboxMatch=SANDBOX_ITEM.exec(url.pathname),budgetMatch=BUDGET_ITEM.exec(url.pathname),autoMatch=AUTOSTEP_ITEM.exec(url.pathname),seqMatch=SEQUENCE_ITEM.exec(url.pathname),progressMatch=PROGRESS_ITEM.exec(url.pathname),qaMatch=QA_REVIEW_ITEM.exec(url.pathname),qaRunMatch=QA_RUN_ITEM.exec(url.pathname),qaRepairMatch=QA_REPAIR_ITEM.exec(url.pathname),qaPlanMatch=QA_PLAN_ITEM.exec(url.pathname),qaGenerateMatch=QA_GENERATE_ITEM.exec(url.pathname),previewMatch=PREVIEW_ITEM.exec(url.pathname);
 if(url.pathname!==CREATE&&!match&&!modelMatch&&!applyMatch&&!continueMatch&&!statusMatch&&!sandboxMatch&&!budgetMatch&&!autoMatch&&!seqMatch&&!progressMatch&&!qaMatch&&!qaRunMatch&&!qaRepairMatch&&!qaPlanMatch&&!qaGenerateMatch&&!previewMatch)return undefined;
 if(env.APPF2_AGENT_CANDIDATE_ENABLED!=="1")return denied();
 if(request.method!=="POST"||url.search||!sameOrigin(request,url)||
  request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase()!=="application/json")
  return denied();
 const key=request.headers.get("Idempotency-Key");
 if(!key||!KEY.test(key))return json(400,{error:"AGENT_JOB_KEY_INVALID"});
 // Bound request size before any database side effect.
 const maxBytes=qaMatch||qaRunMatch||qaRepairMatch||qaPlanMatch?24000:1400;
 if(Number(request.headers.get("Content-Length")??0)>maxBytes)return json(413,{error:"AGENT_JOB_TOO_LARGE"});
 const bytes=new Uint8Array(await request.arrayBuffer());
 if(bytes.byteLength>maxBytes)return json(413,{error:"AGENT_JOB_TOO_LARGE"});
 const proof=await verifyMutationProof({method:"POST",path:url.pathname,
  body:bytes,idempotencyKey:key,headers:request.headers},nowMs);
 if(!proof)return denied();
 let parsed:unknown;
 try{parsed=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}
 catch{return json(400,{error:"AGENT_JOB_BODY_INVALID"});}
 const isModel=Boolean(modelMatch||continueMatch||qaRepairMatch||qaGenerateMatch);
 if(isModel&&env.APPF2_AGENT_MODEL_EXECUTION_ENABLED!=="1")return denied();
 if(sandboxMatch&&env.APPF2_AGENT_SANDBOX_EXECUTION_ENABLED!=="1")return denied();
 if(qaRunMatch&&(env.APPF2_AGENT_QA_BROWSER_ENABLED!=="1"||
  !env.APPF2_QA_BROWSER_SERVICE||!env.APPF2_QA_PRIVATE_TOKEN||
  !env.APPF2_AGENT_QA_VERIFIER_SECRET))return denied();
 if(qaMatch&&(env.APPF2_AGENT_QA_REVIEW_ENABLED!=="1"||
  !env.APPF2_AGENT_QA_VERIFIER_SECRET))return denied();
 if((autoMatch||seqMatch)&&env.APPF2_AGENT_AUTOSTEP_ENABLED!=="1")return denied();
 const info=qaGenerateMatch?(validGenerateQaBody(parsed)?parsed:null):
  qaPlanMatch?(validFreezeQaPlanBody(parsed)?parsed:null):
  qaRepairMatch?(validQaRepairBody(parsed)?parsed:null):
  qaRunMatch?(validBrowserQaRunBody(parsed)?parsed:null):
  previewMatch?(validPreviewAssetBody(parsed)?parsed:null):
  qaMatch?(validQaReviewBody(parsed)?parsed:null):
  progressMatch?(validAgentProgressBody(parsed)?parsed:null):
  seqMatch?(validAgentSequenceBody(parsed)?parsed:null):
  autoMatch?(validAutoStepBody(parsed)?parsed:null):
  budgetMatch?(validExtendBudgetBody(parsed)?parsed:null):
  sandboxMatch?(validSandboxRunBody(parsed)?parsed:null):
  statusMatch?(validModelStatusBody(parsed)?parsed:null):
  continueMatch?(validModelContinueBody(parsed)?parsed:null):
  modelMatch?(validModelPlanBody(parsed)?parsed:null):
  applyMatch?(validApplyModelEditBody(parsed)?parsed:null):
  verifiedBody(parsed,url.pathname===CREATE);
 if(!info||!UUID.test(info.anonymous_id))return json(400,{error:"AGENT_JOB_BODY_INVALID"});
 const ownerThumb=await keyDigest(proof.keyThumbprint);
 const db=ctx.deps?.db?.(env,{anonymousId:info.anonymous_id,intentId:null})??
  new WorkerPostgresExecutor(env.HYPERDRIVE_FRESH,
   {anonymousId:info.anonymous_id,intentId:null});
 try{
  if(url.pathname===CREATE)return await create(db,info.anonymous_id,ownerThumb,
   key,info,ctx.deps?.newJobId??(()=>crypto.randomUUID()));
  if(budgetMatch){
   if(!validExtendBudgetBody(info))return denied();
   const result=await extendSignedAgentBudget(info,{db,
    jobId:budgetMatch[1]??"",owner:info.anonymous_id,ownerThumb});
   return json(200,{data:result});
  }
  if(qaGenerateMatch){
   if(!validGenerateQaBody(info)||!env.APPF2_OPENAI_AGENT_API_KEY)return denied();
   const result=await generateAndFreezeOriginalQa(info,{db,
    jobId:qaGenerateMatch[1]??"",owner:info.anonymous_id,ownerThumb,
    apiKey:env.APPF2_OPENAI_AGENT_API_KEY,send:ctx.deps?.sendModel});
   return json(200,{data:result});
  }
  if(qaPlanMatch){
   if(!validFreezeQaPlanBody(info))return denied();
   const result=await freezeAgentQaPlan(info,{db,
    jobId:qaPlanMatch[1]??"",owner:info.anonymous_id,ownerThumb});
   return json(200,{data:result});
  }
  if(qaRepairMatch){
   if(!validQaRepairBody(info)||!env.APPF2_OPENAI_AGENT_API_KEY)return denied();
   const result=await executeSignedQaRepair(info,{db,
    jobId:qaRepairMatch[1]??"",owner:info.anonymous_id,ownerThumb,
    apiKey:env.APPF2_OPENAI_AGENT_API_KEY,send:ctx.deps?.sendModel});
   return json(200,{data:result});
  }
  if(previewMatch){
   if(!validPreviewAssetBody(info))return denied();
   const result=await readSignedPreviewAsset(info,{db,
    jobId:previewMatch[1]??"",owner:info.anonymous_id,ownerThumb,
    brokerService:env.APPF2_SANDBOX_BROKER_SERVICE,
    brokerToken:env.APPF2_SANDBOX_BROKER_TOKEN??"",
    allowedJobId:env.APPF2_SANDBOX_ALLOWED_JOB_ID??""});
   return json(200,{data:result});
  }
  if(qaRunMatch){
   if(!validBrowserQaRunBody(info)||!env.APPF2_QA_BROWSER_SERVICE)return denied();
   const result=await runSignedIndependentBrowserQa(info,{db,
    jobId:qaRunMatch[1]??"",owner:info.anonymous_id,ownerThumb,
    service:env.APPF2_QA_BROWSER_SERVICE,
    privateToken:env.APPF2_QA_PRIVATE_TOKEN??"",
    verifierSecret:env.APPF2_AGENT_QA_VERIFIER_SECRET??""});
   return json(200,{data:result});
  }
  if(qaMatch){
   if(!validQaReviewBody(info))return denied();
   const result=await reviewAgentQa(info,{db,
    jobId:qaMatch[1]??"",owner:info.anonymous_id,ownerThumb,
    verifierSecret:env.APPF2_AGENT_QA_VERIFIER_SECRET??""});
   return json(200,{data:result});
  }
  if(progressMatch){
   if(!validAgentProgressBody(info))return denied();
   const result=await inspectAgentProgress(info,{db,
    jobId:progressMatch[1]??"",owner:info.anonymous_id,ownerThumb});
   return json(200,{data:result});
  }
  if(seqMatch){
   if(!validAgentSequenceBody(info))return denied();
   const result=await runSignedAgentSequence(info,{
    db,jobId:seqMatch[1]??"",owner:info.anonymous_id,ownerThumb,
    modelEnabled:env.APPF2_AGENT_MODEL_EXECUTION_ENABLED==="1",
    apiKey:env.APPF2_OPENAI_AGENT_API_KEY??"",
    brokerEnabled:env.APPF2_AGENT_SANDBOX_EXECUTION_ENABLED==="1",
    brokerUrl:env.APPF2_SANDBOX_BROKER_SERVICE?"":
     env.APPF2_SANDBOX_BROKER_URL??"",
    brokerService:env.APPF2_SANDBOX_BROKER_SERVICE,
    brokerToken:env.APPF2_SANDBOX_BROKER_TOKEN??"",
    allowedJobId:env.APPF2_SANDBOX_ALLOWED_JOB_ID??"",
    sendModel:ctx.deps?.sendModel,sendSandbox:ctx.deps?.sendSandbox
   });
   return json(200,{data:result});
  }
  if(autoMatch){
   if(!validAutoStepBody(info))return denied();
   const result=await runSignedAgentStep(info,{
    db,jobId:autoMatch[1]??"",owner:info.anonymous_id,ownerThumb,
    modelEnabled:env.APPF2_AGENT_MODEL_EXECUTION_ENABLED==="1",
    apiKey:env.APPF2_OPENAI_AGENT_API_KEY??"",
    brokerEnabled:env.APPF2_AGENT_SANDBOX_EXECUTION_ENABLED==="1",
    brokerUrl:env.APPF2_SANDBOX_BROKER_SERVICE?"":
     env.APPF2_SANDBOX_BROKER_URL??"",
    brokerService:env.APPF2_SANDBOX_BROKER_SERVICE,
    brokerToken:env.APPF2_SANDBOX_BROKER_TOKEN??"",
    allowedJobId:env.APPF2_SANDBOX_ALLOWED_JOB_ID??"",
    sendModel:ctx.deps?.sendModel,sendSandbox:ctx.deps?.sendSandbox
   });
   return json(200,{data:result});
  }
  if(sandboxMatch){
   if(!validSandboxRunBody(info))return denied();
   const result=await executeSignedSandboxTool(info,{
    db,jobId:sandboxMatch[1]??"",owner:info.anonymous_id,ownerThumb,
    brokerUrl:env.APPF2_SANDBOX_BROKER_SERVICE?"":
     env.APPF2_SANDBOX_BROKER_URL??"",
    brokerService:env.APPF2_SANDBOX_BROKER_SERVICE,
    brokerToken:env.APPF2_SANDBOX_BROKER_TOKEN??"",
    allowedJobId:env.APPF2_SANDBOX_ALLOWED_JOB_ID??"",
    send:ctx.deps?.sendSandbox
   });
   return json(200,{data:result});
  }
  if(statusMatch){
   if(!validModelStatusBody(info))return denied();
   const result=await readAgentModelCallStatus(info,{db,
    jobId:statusMatch[1]??"",owner:info.anonymous_id,ownerThumb});
   return json(200,{data:result});
  }
  if(continueMatch){
   if(!validModelContinueBody(info)||!env.APPF2_OPENAI_AGENT_API_KEY)return denied();
   const result=await executeAgentModelContinuation(info,{db,
    jobId:continueMatch[1]??"",owner:info.anonymous_id,
    ownerThumb,apiKey:env.APPF2_OPENAI_AGENT_API_KEY,
    send:ctx.deps?.sendModel});
   return json(200,{data:result});
  }
  if(modelMatch){
   if(!validModelPlanBody(info)||!env.APPF2_OPENAI_AGENT_API_KEY)
    return denied();
   const result=await executeFirstAgentModelPlan(info,{db,
    jobId:modelMatch?.[1]??"",owner:info.anonymous_id,
    ownerThumb,apiKey:env.APPF2_OPENAI_AGENT_API_KEY,
    send:ctx.deps?.sendModel});
   return json(200,{data:result});
  }
  if(applyMatch){
   if(!validApplyModelEditBody(info))return denied();
   const applied=await applyStoredModelEdit(info,{db,
    jobId:applyMatch[1]??"",owner:info.anonymous_id,ownerThumb});
   return json(200,{data:applied});
  }
  return await read(db,info.anonymous_id,ownerThumb,match?.[1]??"");
 }catch{
  return json(503,{error:"AGENT_JOB_UNAVAILABLE"});
 }finally{await db.close().catch(()=>undefined);}
}
