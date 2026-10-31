/** GitHub OIDC-authorized free Docker + Chromium smoke evidence ONLY.
 * Never an original requirement QA PASS, a publication or a share grant.
 */
import {openFreeCiTicket} from "../platform/agent/free-ci-ticket.js";
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
};
function exact(x:unknown,names:readonly string[]):x is Record<string,unknown>{
 return typeof x==="object"&&x!==null&&!Array.isArray(x)&&
  Object.keys(x).sort().join(",")===names.slice().sort().join(",");
}
export function validFreeCiSmoke(value:unknown):value is FreeCiSmoke{
 if(!exact(value,["version","project_hash","artifact_hash","checks"])||
  value.version!=="APPF2_FREE_CI_SMOKE_V1"||
  typeof value.project_hash!=="string"||!SHA.test(value.project_hash)||
  typeof value.artifact_hash!=="string"||!SHA.test(value.artifact_hash)||
  !exact(value.checks,["locked_build","chromium_render"]))return false;
 return value.checks.locked_build===true&&value.checks.chromium_render===true;
}
export type FreeCiScope={readonly jobId:string;readonly owner:string;
 readonly projectHash:string;readonly runId:string};
type SavedReceipt={readonly run_id:string;readonly built_artifact_hash:string};
/** Atomic current job/hash fence and immutable first receipt. */
export async function persistFreeCiSmoke(db:AgentJobExecutor,scope:FreeCiScope,
 result:FreeCiSmoke):Promise<"RECORDED"|"REPLAYED">{
 if(!validFreeCiSmoke(result)||result.project_hash!==scope.projectHash||
  !/^[0-9]{6,20}$/u.test(scope.runId))throw Error("FREE_CI_RECEIPT_INVALID");
 const payload=JSON.stringify({version:result.version,checks:result.checks,
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
  "SELECT run_id,built_artifact_hash FROM public.appf2_agent_free_ci_receipt "+
  "WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid AND project_hash=$3::text",
  [scope.jobId,scope.owner,scope.projectHash]);
 if(rows.rows[0]?.run_id===scope.runId&&
  rows.rows[0]?.built_artifact_hash===result.artifact_hash)return "REPLAYED";
 throw Error("FREE_CI_SOURCE_STALE_OR_RESULT_CONFLICT");
}
export async function readFreeCiSmoke(db:AgentJobExecutor,jobId:string,
 owner:string,projectHash:string){
 const found=await db.query<SavedReceipt>(
  "SELECT run_id,built_artifact_hash FROM public.appf2_agent_free_ci_receipt "+
  "WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid AND project_hash=$3::text",
  [jobId,owner,projectHash]);
 const row=found.rows[0];
 return row?{status:"BUILD_BROWSER_SMOKE" as const,run_id:row.run_id,
  artifact_hash:row.built_artifact_hash,
  original_requirements_qa:false as const,app_published:false as const}:null;
}
/** OIDC identity + AES source ticket authenticate before owner-scoped DB write. */
// eslint-disable-next-line complexity -- Every token/claim and content boundary fails closed.
export async function routeFreeCiResult(request:Request,url:URL,
 env:Appf2WorkerEnv,nowMs:number):Promise<Response|undefined>{
 if(url.pathname!==FREE_CI_RESULT_ROUTE)return undefined;
 if(env.APPF2_AGENT_FREE_ONLY!=="1"||request.method!=="POST"||url.search||
  request.headers.get("Content-Type")?.split(";")[0]!=="application/json"||
  Number(request.headers.get("Content-Length")??0)>2000)return denied();
 const bearer=request.headers.get("Authorization")??"";
 if(!bearer.startsWith("Bearer ")||bearer.length>12020)return denied();
 const raw=await request.text();
 if(raw.length>2000)return denied();
 let parsed:unknown;
 try{parsed=JSON.parse(raw);}catch{return denied();}
 if(!exact(parsed,["ticket","result"])||typeof parsed.ticket!=="string"||
  !validFreeCiSmoke(parsed.result))return denied();
 const ticket=await openFreeCiTicket(parsed.ticket,
  env.APPF2_IDENTITY_COOKIE_SECRET,nowMs);
 if(!ticket||ticket.project_hash!==parsed.result.project_hash)return denied();
 const runId=await verifiedLiveFreeCiOidcRunId(bearer.slice(7),nowMs);
 if(!runId)return denied();
 const db=new WorkerPostgresExecutor(env.HYPERDRIVE_FRESH,
  {anonymousId:ticket.owner,intentId:null});
 try{
  const status=await persistFreeCiSmoke(db,{jobId:ticket.job_id,
   owner:ticket.owner,projectHash:ticket.project_hash,runId},parsed.result);
  return new Response(JSON.stringify({data:{status,job_id:ticket.job_id,
   project_hash:ticket.project_hash,app_published:false,
   original_requirements_qa:false}}),{status:200,headers:HEADERS});
 }catch{return denied();}
 finally{await db.close();}
}
