/** GitHub OIDC-authorized free Docker + Chromium smoke evidence ONLY.
 * Never an original requirement QA PASS, a publication or a share grant.
 */
import {openFreeCiTicket} from "../platform/agent/free-ci-ticket.js";
import {canonicalArtifactJson,sha256CodeBytes}
 from "../platform/blueprint/code-artifact-v2.js";
import type {QaPlan} from "../platform/qa/requirement-contract.js";
import {verifiedLiveFreeCiOidcRunId} from "./free-ci-oidc.js";
import {WorkerPostgresExecutor} from "../platform/blueprint/worker-postgres-executor.js";
import type {AgentJobExecutor} from "../platform/agent/postgres-agent-jobs.js";
import type {Appf2WorkerEnv} from "./worker-composition.js";
export const FREE_CI_RESULT_ROUTE="/api/v1/internal/free-ci/result";
const SHA=/^sha256:[a-f0-9]{64}$/u;
const HEADERS={"Content-Type":"application/json; charset=utf-8",
 "Cache-Control":"private, no-store"};
const denied=()=>new Response(JSON.stringify({error:"FREE_CI_NOT_AUTHORIZED"}),
 {status:404,headers:HEADERS});
export type FreeCiSmoke={
 readonly version:"APPF2_FREE_CI_SMOKE_V1";
 readonly project_hash:string;readonly artifact_hash:string;
 readonly checks:{readonly locked_build:true;readonly chromium_render:true};
 readonly qa_plan_hash?:string;readonly qa_checks?:readonly FreeCiQaCheck[];
};
/** Authenticated failure evidence has NO build artifact and can NEVER be a QA PASS. */
export type FreeCiBuildFailure={
 readonly version:"APPF2_FREE_CI_BUILD_FAILURE_V1";
 readonly project_hash:string;readonly artifact_hash:string;
 readonly failure_stage:"BUILD"|"RENDER";
 readonly diagnostic_code:"FREE_CI_BUILD_FAILED"|"FREE_CI_CHROMIUM_RENDER_FAILED";
 readonly diagnostic_excerpt:string;readonly qa_plan_hash:string;
};
export type FreeCiReceipt=FreeCiSmoke|FreeCiBuildFailure;
export function validFreeCiBuildFailure(x:unknown):x is FreeCiBuildFailure{
 if(!exact(x,["version","project_hash","artifact_hash","failure_stage",
  "diagnostic_code","diagnostic_excerpt","qa_plan_hash"]))return false;
 return x.version==="APPF2_FREE_CI_BUILD_FAILURE_V1"&&
  typeof x.project_hash==="string"&&SHA.test(x.project_hash)&&
  typeof x.artifact_hash==="string"&&SHA.test(x.artifact_hash)&&
  typeof x.qa_plan_hash==="string"&&SHA.test(x.qa_plan_hash)&&
  ((x.failure_stage==="BUILD"&&x.diagnostic_code==="FREE_CI_BUILD_FAILED")||
   (x.failure_stage==="RENDER"&&x.diagnostic_code==="FREE_CI_CHROMIUM_RENDER_FAILED"))&&
  typeof x.diagnostic_excerpt==="string"&&x.diagnostic_excerpt.length>=1&&
  x.diagnostic_excerpt.length<=1200&&
  !/[\u0000-\u0008\u000e-\u001f]/u.test(x.diagnostic_excerpt);
}
export type FreeCiQaCheck={readonly criterion_id:string;
 readonly verdict:"PASS"|"FAIL"|"UNTESTED";readonly evidence_hash:string|null};
export function validQaChecks(raw:unknown):raw is readonly FreeCiQaCheck[]{
 if(!Array.isArray(raw)||raw.length<1||raw.length>20)return false;
 return raw.every(x=>exact(x,["criterion_id","verdict","evidence_hash"])&&
  typeof x.criterion_id==="string"&&/^[a-z][a-z0-9_]{0,39}$/u.test(x.criterion_id)&&
  ["PASS","FAIL","UNTESTED"].includes(String(x.verdict))&&
  (x.verdict==="PASS"?typeof x.evidence_hash==="string"&&
   SHA.test(x.evidence_hash):x.evidence_hash===null));
}
export async function frozenFreeCiPlanHash(plan:QaPlan):Promise<string>{
 return sha256CodeBytes(new TextEncoder().encode(
  "APPF2_FREE_CI_FROZEN_PLAN_V1\u0000"+canonicalArtifactJson(plan)));
}
/** Only the immutable pre-coding QA plan can bind GitHub OIDC observations. */
export async function verifiedFreeCiChecks(result:FreeCiReceipt,plan:QaPlan|null){
 if(result.version==="APPF2_FREE_CI_BUILD_FAILURE_V1")
  return plan!==null&&result.qa_plan_hash===await frozenFreeCiPlanHash(plan);
 if(!plan)return result.qa_plan_hash===undefined&&result.qa_checks===undefined;
 if(!result.qa_checks||result.qa_plan_hash!==await frozenFreeCiPlanHash(plan)||
  result.qa_checks.length!==plan.criteria.length)return false;
 return plan.criteria.every((criterion,i)=>{
  const r=result.qa_checks?.[i];
  return r?.criterion_id===criterion.id&&(criterion.automatable||r.verdict!=="PASS");
 });
}
function exact(x:unknown,names:readonly string[]):x is Record<string,unknown>{
 return typeof x==="object"&&x!==null&&!Array.isArray(x)&&
  Object.keys(x).sort().join(",")===names.slice().sort().join(",");
}
export function validFreeCiSmoke(value:unknown):value is FreeCiSmoke{
 const plain=exact(value,["version","project_hash","artifact_hash","checks"]);
 const withQa=exact(value,["version","project_hash","artifact_hash","checks",
  "qa_plan_hash","qa_checks"]);
 if((!plain&&!withQa)||(withQa&&
  (typeof value.qa_plan_hash!=="string"||!SHA.test(value.qa_plan_hash)||
   !validQaChecks(value.qa_checks)))||
  value.version!=="APPF2_FREE_CI_SMOKE_V1"||
  typeof value.project_hash!=="string"||!SHA.test(value.project_hash)||
  typeof value.artifact_hash!=="string"||!SHA.test(value.artifact_hash)||
  !exact(value.checks,["locked_build","chromium_render"]))return false;
 return value.checks.locked_build===true&&value.checks.chromium_render===true;
}
export type FreeCiScope={readonly jobId:string;readonly owner:string;
 readonly projectHash:string;readonly runId:string};
type SavedReceipt={readonly run_id:string;readonly built_artifact_hash:string;
 readonly receipt_json?:unknown};
/** Atomic current job/hash fence and immutable first receipt. */
// eslint-disable-next-line complexity -- Job, OIDC and original frozen QA plan are independent security gates.
export async function persistFreeCiSmoke(db:AgentJobExecutor,scope:FreeCiScope,
 result:FreeCiReceipt,plan:QaPlan|null=null):Promise<"RECORDED"|"REPLAYED">{
 if(!(validFreeCiSmoke(result)||validFreeCiBuildFailure(result))||
  result.project_hash!==scope.projectHash||
  !/^[0-9]{6,20}$/u.test(scope.runId)||
  !await verifiedFreeCiChecks(result,plan))throw Error("FREE_CI_RECEIPT_INVALID");
 const payload=JSON.stringify(result.version==="APPF2_FREE_CI_BUILD_FAILURE_V1"?
  {version:result.version,failure_stage:result.failure_stage,
   diagnostic_code:result.diagnostic_code,
   diagnostic_excerpt:result.diagnostic_excerpt,qa_plan_hash:result.qa_plan_hash,
   original_requirements_qa:false,app_published:false}:
  {version:result.version,checks:result.checks,
   ...(result.qa_checks?{qa_plan_hash:result.qa_plan_hash,
    qa_checks:result.qa_checks}:{}),
   original_requirements_qa:false,app_published:false});
 const inserted=await db.query<{job_id:string}>(`INSERT INTO public.appf2_agent_free_ci_receipt
 (job_id,owner_anonymous_id,project_hash,run_id,built_artifact_hash,receipt_json)
 SELECT j.job_id,j.owner_anonymous_id,j.project_hash,$4::text,$5::text,$6::jsonb
 FROM public.appf2_agent_job j
 WHERE j.job_id=$1::uuid AND j.owner_anonymous_id=$2::uuid
 AND j.project_hash=$3::text AND j.revision>=1 AND j.job_state<>'CREATED'
 ON CONFLICT(job_id,project_hash) DO NOTHING RETURNING job_id::text`,
 [scope.jobId,scope.owner,scope.projectHash,scope.runId,
  result.artifact_hash,payload]);
 if(inserted.rows[0]?.job_id===scope.jobId)return "RECORDED";
 const rows=await db.query<SavedReceipt>(
  "SELECT run_id,built_artifact_hash,receipt_json FROM public.appf2_agent_free_ci_receipt "+
  "WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid AND project_hash=$3::text",
  [scope.jobId,scope.owner,scope.projectHash]);
 if(rows.rows[0]?.run_id===scope.runId&&
  rows.rows[0]?.built_artifact_hash===result.artifact_hash&&
  rows.rows[0]?.receipt_json!==undefined&&
  canonicalArtifactJson(rows.rows[0].receipt_json)===
   canonicalArtifactJson(JSON.parse(payload)))return "REPLAYED";
 throw Error("FREE_CI_SOURCE_STALE_OR_RESULT_CONFLICT");
}
export async function readFreeCiSmoke(db:AgentJobExecutor,jobId:string,
 owner:string,projectHash:string){
 const found=await db.query<SavedReceipt>(
  "SELECT run_id,built_artifact_hash,receipt_json FROM public.appf2_agent_free_ci_receipt "+
  "WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid AND project_hash=$3::text",
  [jobId,owner,projectHash]);
 const row=found.rows[0];
 if(!row)return null;
 const raw=row.receipt_json as {version?:unknown;failure_stage?:unknown;
  diagnostic_code?:unknown;diagnostic_excerpt?:unknown}|null;
 if(raw?.version==="APPF2_FREE_CI_BUILD_FAILURE_V1")
  return {status:"BUILD_FAILED" as const,run_id:row.run_id,
   artifact_hash:row.built_artifact_hash,preview_ready:false as const,
   failure_stage:raw.failure_stage,diagnostic_code:raw.diagnostic_code,
   diagnostic_excerpt:raw.diagnostic_excerpt,
   original_requirements_qa:false as const,app_published:false as const};
 const preview=await db.query<{ready:boolean}>(
  "SELECT EXISTS(SELECT 1 FROM public.appf2_agent_free_ci_preview p "+
  "WHERE p.job_id=$1::uuid AND p.owner_anonymous_id=$2::uuid "+
  "AND p.project_hash=$3::text AND p.run_id=$4::text "+
  "AND p.artifact_hash=$5::text) AS ready",
  [jobId,owner,projectHash,row.run_id,row.built_artifact_hash]);
 const preview_ready=preview.rows[0]?.ready===true;
 const data=typeof row?.receipt_json==="object"&&row.receipt_json!==null?
  row.receipt_json as {qa_plan_hash?:unknown;qa_checks?:unknown}:null;
 const qa=data&&typeof data.qa_plan_hash==="string"&&
  SHA.test(data.qa_plan_hash)&&validQaChecks(data.qa_checks)?
   {qa_plan_hash:data.qa_plan_hash,qa_checks:data.qa_checks}:null;
 return {status:"BUILD_BROWSER_SMOKE" as const,run_id:row.run_id,
  artifact_hash:row.built_artifact_hash,preview_ready,...(qa??{}),
  original_requirements_qa:false as const,app_published:false as const};
}
/** OIDC identity + AES source ticket authenticate before owner-scoped DB write. */
// eslint-disable-next-line complexity -- Every token/claim and content boundary fails closed.
export async function routeFreeCiResult(request:Request,url:URL,
 env:Appf2WorkerEnv,nowMs:number):Promise<Response|undefined>{
 if(url.pathname!==FREE_CI_RESULT_ROUTE)return undefined;
 if(env.APPF2_AGENT_FREE_ONLY!=="1"||request.method!=="POST"||url.search||
  request.headers.get("Content-Type")?.split(";")[0]!=="application/json"||
  Number(request.headers.get("Content-Length")??0)>10000)return denied();
 const bearer=request.headers.get("Authorization")??"";
 if(!bearer.startsWith("Bearer ")||bearer.length>12020)return denied();
 const raw=await request.text();
 if(raw.length>10000)return denied();
 let parsed:unknown;
 try{parsed=JSON.parse(raw);}catch{return denied();}
 if(!exact(parsed,["ticket","result"])||typeof parsed.ticket!=="string"||
  !(validFreeCiSmoke(parsed.result)||
   validFreeCiBuildFailure(parsed.result)))return denied();
 const ticket=await openFreeCiTicket(parsed.ticket,
  env.APPF2_IDENTITY_COOKIE_SECRET,nowMs);
 if(!ticket||ticket.project_hash!==parsed.result.project_hash)return denied();
 const runId=await verifiedLiveFreeCiOidcRunId(bearer.slice(7),nowMs);
 if(!runId)return denied();
 const db=new WorkerPostgresExecutor(env.HYPERDRIVE_FRESH,
  {anonymousId:ticket.owner,intentId:null});
 try{
  const frozen=(await db.query<{original_plan:QaPlan}>(
   "SELECT original_plan FROM public.appf2_agent_qa_plan "+
   "WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid LIMIT 1",
   [ticket.job_id,ticket.owner])).rows[0]?.original_plan??null;
  const status=await persistFreeCiSmoke(db,{jobId:ticket.job_id,
   owner:ticket.owner,projectHash:ticket.project_hash,runId},parsed.result,frozen);
  return new Response(JSON.stringify({data:{status,job_id:ticket.job_id,
   project_hash:ticket.project_hash,app_published:false,
   original_requirements_qa:false}}),{status:200,headers:HEADERS});
 }catch{return denied();}
 finally{await db.close();}
}
