/** Sprint3.5 first-party paid AI→free CI. At-most-once per Job+phase.
 * Price is bounded by the owner-signed Job budget; no paid Sandbox/Browser.
 * A model response can NEVER authorize QA PASS or public publication.
 */
import {recoverAgentJob,advanceDurableAgentJob}
 from "../platform/agent/durable-agent-service.js";
import {applyProjectEdits} from "../platform/agent/project-workspace.js";
import {freezeAgentQaPlan} from "./agent-qa-plan.js";
import {parseQaPlan,type QaPlan} from "../platform/qa/requirement-contract.js";
import {getModelCall,reserveModelCall,claimModelCall,completeModelCall,
 markModelCallUncertain} from "../platform/agent/postgres-model-calls.js";
import {sha256CodeBytes} from "../platform/blueprint/code-artifact-v2.js";
import {readFreeCiSmoke} from "./free-ci-result.js";
import {dispatchFreeCiJob} from "./free-ci-dispatch.js";
import type {AgentJobExecutor} from "../platform/agent/postgres-agent-jobs.js";
const SHA=/^sha256:[a-f0-9]{64}$/u;
const AMOUNTS={QA:8,CODE:20,REPAIR:16} as const;
type Phase=keyof typeof AMOUNTS;
type Input={readonly anonymous_id:string;readonly original_prompt:string;
 readonly expected_project_hash:string;readonly stage:Phase;
 readonly explicit_ai_consent:true;readonly explicit_free_ci_consent:true};
type ModelResult={readonly response:unknown;readonly inputTokens:number;
 readonly outputTokens:number};
export function validFreeAiCodeInput(x:unknown):x is Input{
 if(typeof x!=="object"||x===null||Array.isArray(x))return false;
 const v=x as Record<string,unknown>;
 return Object.keys(v).sort().join(",")===
  "anonymous_id,expected_project_hash,explicit_ai_consent,explicit_free_ci_consent,original_prompt,stage"&&
  typeof v.anonymous_id==="string"&&
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(v.anonymous_id)&&
  typeof v.original_prompt==="string"&&v.original_prompt.length>=5&&
  v.original_prompt.length<=800&&
  typeof v.expected_project_hash==="string"&&SHA.test(v.expected_project_hash)&&
  (v.stage==="QA"||v.stage==="CODE"||v.stage==="REPAIR")&&
  v.explicit_ai_consent===true&&v.explicit_free_ci_consent===true;
}
const qaSchema={type:"object",additionalProperties:false,required:["criteria"],
 properties:{criteria:{type:"array",items:{type:"object",
  additionalProperties:false,required:["id","source_quote","description",
   "automatable","action","role","name","expected_text"],
  properties:{id:{type:"string"},source_quote:{type:"string"},
   description:{type:"string"},automatable:{type:"boolean"},
   action:{type:"string"},role:{type:"string"},name:{type:"string"},
   expected_text:{type:"string"}}}}}} as const;
const codeSchema={type:"object",additionalProperties:false,
 required:["main_ts","style_css"],
 properties:{main_ts:{type:"string"},style_css:{type:"string"}}} as const;
function modelPrompt(phase:Phase,prompt:string,plan:QaPlan|null,
 files:readonly {path:string;content:string}[],failed:string):string{
 if(phase==="QA")return [
  "You are an independent PRE-CODE acceptance planner. You have NOT seen any generated code.",
  "Reply ONLY with JSON matching the schema, 1-6 criteria. No markdown.",
  "source_quote MUST be an EXACT substring of the original natural language request, length 2-180.",
  "If a requirement can be checked by clicking a button and checking newly appearing text:",
  "set automatable=true,action=click,role=button, exact name and expected_text.",
  "Otherwise set automatable=false,action=none,role=none,name=none,expected_text=none.",
  "Never fabricate tests for missing requirements. No special claims of QA success.",
  "ORIGINAL_USER_PROMPT_JSON: "+JSON.stringify(prompt)
 ].join("\n");
 return [
  "You are APPf2 AI code builder. Reply ONLY valid JSON matching schema, no markdown.",
  phase==="REPAIR"?"Repair the CURRENT real project based on the frozen failure evidence.":
   "Create a working interactive App from the natural-language prompt.",
  "Implement the user's entire requirements, do not hardcode a template.",
  "Return complete src/main.ts and src/style.css, no external dependencies or URLs.",
  "Use native browser DOM and CSS; existing index.html has #app and imports src/main.ts.",
  "Do not change package.json or use network. Preserve exact expected accessible button names.",
  "Frozen original QA contract (never alter): "+JSON.stringify(plan),
  "Original request: "+JSON.stringify(prompt),
  ...(phase==="REPAIR"?["Failure evidence: "+failed,
   "Current saved source files (repair them, do not start over): "+JSON.stringify(files)]:[])
 ].join("\n");
}
function parsedOutput(raw:unknown):unknown{
 if(typeof raw!=="object"||raw===null)return null;
 const r=raw as {status?:unknown;output?:unknown};
 if(r.status!=="completed"||!Array.isArray(r.output))return null;
 const text=r.output.filter((x:unknown)=>typeof x==="object"&&x!==null&&
  (x as {type?:unknown}).type==="message").flatMap(x=>
  Array.isArray((x as {content?:unknown}).content)?
   (x as {content:unknown[]}).content:[]).filter(x=>
    typeof x==="object"&&x!==null&&(x as {type?:unknown}).type==="output_text")
  .map(x=>(x as {text?:unknown}).text).filter(x=>typeof x==="string").join("");
 if(text.length<10||text.length>100000)return null;
 try{return JSON.parse(text) as unknown;}catch{return null;}
}
function parsePlan(raw:unknown,prompt:string):QaPlan|null{
 if(typeof raw!=="object"||raw===null||Array.isArray(raw))return null;
 const values=(raw as {criteria?:unknown}).criteria;
 if(!Array.isArray(values)||values.length<1||values.length>6)return null;
 const criteria=values.map((entry:unknown)=>{
  if(typeof entry!=="object"||entry===null)return null;
  const x=entry as Record<string,unknown>;
  return {id:x.id,source_quote:x.source_quote,description:x.description,
   automatable:x.automatable,
   steps:x.automatable?[{action:x.action,role:x.role,name:x.name}]:[],
   assertions:x.automatable?[{kind:"text_appears",text:x.expected_text}]:[]};
 });
 return parseQaPlan({version:"1",criteria},prompt);
}
function parseFiles(raw:unknown):readonly {path:string;content:string}[]|null{
 if(typeof raw!=="object"||raw===null||Array.isArray(raw))return null;
 const x=raw as Record<string,unknown>;
 if(Object.keys(x).sort().join(",")!=="main_ts,style_css")return null;
 if(typeof x.main_ts!=="string"||typeof x.style_css!=="string")return null;
 const files=[{path:"src/main.ts",content:x.main_ts},
  {path:"src/style.css",content:x.style_css}];
 if(files.some(f=>f.content.length<20||f.content.length>65000||
  /https?:\/\/|import\s*\(['"]https?:/u.test(f.content)||
  f.content.includes("</script")||f.content.includes("\u0000")))
  return null;
 return files;
}
async function paidModelTurn(db:AgentJobExecutor,job:Awaited<ReturnType<
 typeof recoverAgentJob>> & {},owner:string,phase:Phase,request:unknown,
 key:string):Promise<ModelResult>{
 const modelKey="sp35_free_ai_"+phase.toLowerCase()+"_v1";
 const json=JSON.stringify(request);
 const digest=await sha256CodeBytes(new TextEncoder().encode(
  "APPF2_SP35_FREE_AI_REQUEST_V1\u0000"+json));
 const existing=await getModelCall(db,job.job.job_id,owner,modelKey);
 if(existing?.status==="SUCCEEDED"&&existing.request_hash===digest&&
  existing.response_json!==null)
  return {response:existing.response_json,
   inputTokens:existing.input_tokens??0,outputTokens:existing.output_tokens??0};
 if(existing&&existing.status!=="RESERVED")
  throw Error("SP35_PAID_AI_UNCERTAIN_NO_RECHARGE");
 const row=await reserveModelCall(db,job.job,owner,{
  call_key:modelKey,request_hash:digest,model:"gpt-4.1-mini",
  max_charge_cents:AMOUNTS[phase]});
 if(row.status!=="RESERVED")throw Error("SP35_PAID_AI_UNCERTAIN_NO_RECHARGE");
 await claimModelCall(db,row);
 let data:unknown;
 try{
  const response=await fetch("https://api.openai.com/v1/responses",{
   method:"POST",headers:{"Authorization":"Bearer "+key,
    "Content-Type":"application/json"},body:json,
   signal:AbortSignal.timeout(85000),redirect:"error"});
  data=await response.json().catch(()=>null);
  const r=data as {status?:unknown;id?:unknown;usage?:{
   input_tokens?:unknown;output_tokens?:unknown}}|null;
  if(response.status!==200||r?.status!=="completed"||
   typeof r.id!=="string"||
   !Number.isSafeInteger(r.usage?.input_tokens)||
   !Number.isSafeInteger(r.usage?.output_tokens))
   throw Error("SP35_MODEL_HTTP_OR_RESPONSE_NOT_PROVEN");
  await completeModelCall(db,row,data,r.id,
   Number(r.usage?.input_tokens),Number(r.usage?.output_tokens));
  return {response:data,inputTokens:Number(r.usage?.input_tokens),
   outputTokens:Number(r.usage?.output_tokens)};
 }catch{
  await markModelCallUncertain(db,row).catch(()=>undefined);
  throw Error("SP35_PAID_AI_OUTCOME_UNCERTAIN_NO_RECHARGE");
 }
}
type Context={db:AgentJobExecutor;jobId:string;ownerThumb:string;
 modelKey:string;githubToken:string;ticketSecret:string;nowMs:number};
async function frozenPlan(db:AgentJobExecutor,id:string,owner:string,prompt:string){
 const row=(await db.query<{original_plan:unknown}>(
  "SELECT original_plan FROM public.appf2_agent_qa_plan "+
  "WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid LIMIT 1",
  [id,owner])).rows[0];
 return parseQaPlan(row?.original_plan,prompt);
}
/** Paid consent is per phase; at most 8c plan, 20c code, 16c repair.
 * All model charges are journaled BEFORE network access.
 */
// eslint-disable-next-line complexity -- Independent budget, PoP, journal, QA and revision fences.
export async function runFreeCiAiStage(input:Input,ctx:Context){
 if(!validFreeAiCodeInput(input)||ctx.modelKey.length<16||
  ctx.githubToken.length<20)throw Error("SP35_PAID_AI_NOT_CONFIGURED");
 const owns=(await ctx.db.query<{job_id:string}>(
  "SELECT job_id::text FROM public.appf2_agent_job "+
  "WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid "+
  "AND owner_key_thumbprint=$3::text LIMIT 1",
  [ctx.jobId,input.anonymous_id,ctx.ownerThumb])).rows[0];
 if(owns?.job_id!==ctx.jobId)throw Error("SP35_PAID_AI_NOT_CREATOR");
 const job=await recoverAgentJob(ctx.db,ctx.jobId,input.anonymous_id);
 const digest=await sha256CodeBytes(new TextEncoder().encode(
  "APPF2_AGENT_REQUEST_V1\u0000"+input.original_prompt.trim()));
 if(!job||job.job.request_hash!==digest||
  job.project.project_hash!==input.expected_project_hash||
  job.job.checkpoint.budget.max_cost_cents<44)
  throw Error("SP35_PAID_AI_JOB_OR_BUDGET_INVALID");
 const plan=await frozenPlan(ctx.db,ctx.jobId,input.anonymous_id,input.original_prompt);
 if(input.stage==="QA"){
  if(job.job.revision!==0||job.job.job_state!=="CREATED")
   throw Error("SP35_QA_MUST_PRECEDE_CODE");
  if(plan)return {status:"QA_ALREADY_FROZEN" as const,
   original_plan:plan,app_published:false as const};
  const req={model:"gpt-4.1-mini",
   input:modelPrompt("QA",input.original_prompt,null,[],""),
   max_output_tokens:1400,store:false,text:{format:{type:"json_schema",
    name:"appf2_precode_qa",strict:true,schema:qaSchema}}};
  const data=await paidModelTurn(ctx.db,job,input.anonymous_id,"QA",req,ctx.modelKey);
  const parsed=parsePlan(parsedOutput(data.response),input.original_prompt);
  if(!parsed)throw Error("SP35_PAID_QA_SCHEMA_FAILED_NO_RECHARGE");
  await freezeAgentQaPlan({anonymous_id:input.anonymous_id,expected_revision:0,
   original_prompt:input.original_prompt,original_plan:parsed},{
    db:ctx.db,jobId:ctx.jobId,owner:input.anonymous_id,ownerThumb:ctx.ownerThumb});
  return {status:"QA_FROZEN_BEFORE_AI_CODE" as const,
   original_plan:parsed,app_published:false as const};
 }
 if(!plan)throw Error("SP35_PAID_AI_REQUIRES_PRECODE_QA");
 const repairing=input.stage==="REPAIR";
 if(!repairing&&(job.job.revision!==0||job.job.job_state!=="CREATED"))
  throw Error("SP35_CODE_WRONG_STATE");
 if(repairing&&(job.job.job_state!=="CODING"||job.project.revision<2||
  job.job.checkpoint.step>4))throw Error("SP35_REPAIR_NOT_ELIGIBLE");
 const receipt=repairing?await readFreeCiSmoke(ctx.db,ctx.jobId,
  input.anonymous_id,job.project.project_hash):null;
 if(repairing&&(!receipt||!receipt.qa_checks?.some(c=>c.verdict==="FAIL")||
  receipt.qa_checks.some(c=>c.verdict==="UNTESTED")))
  throw Error("SP35_REPAIR_NO_PROVEN_AUTOMATABLE_FAILURE");
 const failure=receipt?.qa_checks?.map(c=>c.criterion_id+":"+c.verdict).join(",")??"";
 const req={model:"gpt-4.1-mini",input:modelPrompt(input.stage,
  input.original_prompt,plan,repairing?job.project.files:[],failure),
  max_output_tokens:3200,store:false,text:{format:{type:"json_schema",
   name:"appf2_free_ci_source",strict:true,schema:codeSchema}}};
 const turn=await paidModelTurn(ctx.db,job,input.anonymous_id,
  input.stage,req,ctx.modelKey);
 const files=parseFiles(parsedOutput(turn.response));
 if(!files)throw Error("SP35_PAID_CODE_INVALID_NO_RECHARGE");
 let current=job;
 const qaCall=await getModelCall(ctx.db,ctx.jobId,input.anonymous_id,
  "sp35_free_ai_qa_v1");
 const usedTokens=Math.min(job.job.checkpoint.budget.max_tokens,
  (qaCall?.input_tokens??0)+(qaCall?.output_tokens??0)+
  turn.inputTokens+turn.outputTokens);
 const estimatedCost=repairing?44:28; // Reservation caps, NOT provider invoice.
 const next={...current.job.checkpoint,
  state:repairing?"REPAIRING" as const:"PLANNING" as const,
  step:current.job.checkpoint.step+1,
  cost_cents:repairing?current.job.checkpoint.cost_cents:
   Math.max(current.job.checkpoint.cost_cents,8),
  previous_checkpoint_id:current.job.checkpoint_hash};
 current=await advanceDurableAgentJob(ctx.db,current.job,input.anonymous_id,next);
 const prior=new Map(current.project.files.map(f=>[f.path,f]));
 const edits=files.map(f=>{
  const before=prior.get(f.path);
  return before?{operation:"replace" as const,path:f.path,
   previous_hash:before.hash,content:f.content}:
   {operation:"add" as const,path:f.path,content:f.content};
 });
 const updated=await applyProjectEdits(current.project,
  current.project.project_hash,edits);
 const changed={...current.job.checkpoint,state:"CODING" as const,
  step:current.job.checkpoint.step+1,project_hash:updated.project_hash,
  tokens_used:Math.max(current.job.checkpoint.tokens_used,usedTokens),
  cost_cents:Math.max(current.job.checkpoint.cost_cents,estimatedCost),
  previous_checkpoint_id:current.job.checkpoint_hash};
 const saved=await advanceDurableAgentJob(ctx.db,current.job,input.anonymous_id,
  changed,updated);
 let queued=false;
 try{
  await dispatchFreeCiJob({anonymous_id:input.anonymous_id,
   explicit_free_ci_consent:true},{db:ctx.db,jobId:ctx.jobId,
    ownerThumb:ctx.ownerThumb,nowMs:ctx.nowMs,
    token:ctx.githubToken,ticketSecret:ctx.ticketSecret});
  queued=true;
 }catch{ /* Source is durable. Do not retry paid model or invent QA. */ }
 return {status:queued?"AI_SOURCE_SAVED_FREE_CI_QUEUED" as const:
  "AI_SOURCE_SAVED_CI_DISPATCH_UNCONFIRMED" as const,
  project_hash:saved.project.project_hash,revision:saved.job.revision,
  app_published:false as const,paid_model_call_saved:true as const};
}
