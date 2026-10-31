/** Immutable, owner-private free CI built web assets for zero-AI re-open.
 * An OIDC GitHub runner writes only after the same Job/hash smoke receipt.
 * NO F02 admission, public share or final original-requirements QA authority.
 */
import {openFreeCiTicket} from "../platform/agent/free-ci-ticket.js";
import {verifiedLiveFreeCiOidcRunId} from "./free-ci-oidc.js";
import {WorkerPostgresExecutor} from "../platform/blueprint/worker-postgres-executor.js";
import {recoverAgentJob} from "../platform/agent/durable-agent-service.js";
import {canonicalArtifactJson} from "../platform/blueprint/code-artifact-v2.js";
import type {AgentJobExecutor} from "../platform/agent/postgres-agent-jobs.js";
import type {Appf2WorkerEnv} from "./worker-composition.js";
const SHA=/^sha256:[a-f0-9]{64}$/u;
const RUN=/^[0-9]{6,20}$/u;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const FREE_CI_PRIVATE_PREVIEW="/api/v1/internal/free-ci/preview";
export const FREE_CI_OWNER_PREVIEW=/^\/api\/v1\/agent-jobs\/([0-9a-f-]{36})\/free-ci-preview$/u;
export type FreeCiBuiltPreview={readonly project_hash:string;
 readonly artifact_hash:string;readonly index_html:string;
 readonly javascript:string;readonly css:string};
function exact(v:unknown,fields:readonly string[]):v is Record<string,unknown>{
 return typeof v==="object"&&v!==null&&!Array.isArray(v)&&
  Object.keys(v).sort().join(",")===fields.slice().sort().join(",");
}
export function validFreeCiBuiltPreview(v:unknown):v is FreeCiBuiltPreview{
 if(!exact(v,["project_hash","artifact_hash","index_html","javascript","css"])||
  typeof v.project_hash!=="string"||!SHA.test(v.project_hash)||
  typeof v.artifact_hash!=="string"||!SHA.test(v.artifact_hash)||
  typeof v.index_html!=="string"||typeof v.javascript!=="string"||
  typeof v.css!=="string")return false;
 const total=new TextEncoder().encode(v.index_html+v.javascript+v.css).length;
 return v.index_html.length>=60&&v.index_html.length<=20000&&
  v.javascript.length>=1&&v.javascript.length<=300000&&
  v.css.length<=120000&&total<=380000;
}
type Stored={run_id:string;artifact_hash:string;preview_json:unknown};
export async function saveFreeCiBuiltPreview(db:AgentJobExecutor,
 scope:{jobId:string;owner:string;projectHash:string;runId:string},
 value:FreeCiBuiltPreview):Promise<"RECORDED"|"REPLAYED">{
 if(!validFreeCiBuiltPreview(value)||value.project_hash!==scope.projectHash||
  !RUN.test(scope.runId))throw Error("FREE_CI_PREVIEW_INVALID");
 const json=canonicalArtifactJson(value);
 const first=await db.query<{job_id:string}>(`INSERT INTO public.appf2_agent_free_ci_preview
 (job_id,owner_anonymous_id,project_hash,run_id,artifact_hash,preview_json)
 SELECT r.job_id,r.owner_anonymous_id,r.project_hash,$4::text,$5::text,$6::jsonb
 FROM public.appf2_agent_free_ci_receipt r
 WHERE r.job_id=$1::uuid AND r.owner_anonymous_id=$2::uuid
 AND r.project_hash=$3::text AND r.run_id=$4::text
 AND r.built_artifact_hash=$5::text
 ON CONFLICT(job_id,project_hash) DO NOTHING RETURNING job_id::text`,
 [scope.jobId,scope.owner,scope.projectHash,scope.runId,
  value.artifact_hash,json]);
 if(first.rows[0]?.job_id===scope.jobId)return "RECORDED";
 const row=(await db.query<Stored>(
  "SELECT run_id,artifact_hash,preview_json FROM public.appf2_agent_free_ci_preview "+
  "WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid AND project_hash=$3::text",
  [scope.jobId,scope.owner,scope.projectHash])).rows[0];
 if(row?.run_id===scope.runId&&row.artifact_hash===value.artifact_hash&&
  canonicalArtifactJson(row.preview_json)===json)return "REPLAYED";
 throw Error("FREE_CI_PREVIEW_CONFLICT");
}
export type FreeCiPrivateSource={readonly project_hash:string;readonly index_html:string;
 readonly javascript:string;readonly css:string;readonly app_published:false};
export function validFreeCiOwnerPreviewInput(raw:unknown):raw is {
 readonly anonymous_id:string;readonly expected_project_hash:string}{
 return exact(raw,["anonymous_id","expected_project_hash"])&&
  typeof raw.anonymous_id==="string"&&UUID.test(raw.anonymous_id)&&
  typeof raw.expected_project_hash==="string"&&SHA.test(raw.expected_project_hash);
}
export async function readSignedFreeCiBuiltPreview(db:AgentJobExecutor,input:{
 readonly anonymous_id:string;readonly expected_project_hash:string;
},scope:{jobId:string;ownerThumb:string}):Promise<FreeCiPrivateSource>{
 if(!UUID.test(input.anonymous_id)||!SHA.test(input.expected_project_hash))
  throw Error("FREE_CI_PREVIEW_INVALID");
 const owner=await db.query<{job_id:string}>(
  "SELECT job_id::text FROM public.appf2_agent_job WHERE job_id=$1::uuid "+
  "AND owner_anonymous_id=$2::uuid AND owner_key_thumbprint=$3::text LIMIT 1",
  [scope.jobId,input.anonymous_id,scope.ownerThumb]);
 if(owner.rows[0]?.job_id!==scope.jobId)throw Error("FREE_CI_PREVIEW_NOT_OWNER");
 const saved=await recoverAgentJob(db,scope.jobId,input.anonymous_id);
 if(!saved||saved.project.project_hash!==input.expected_project_hash)
  throw Error("FREE_CI_PREVIEW_STALE_SOURCE");
 const rows=await db.query<{preview_json:unknown;artifact_hash:string}>(
  "SELECT p.preview_json,p.artifact_hash FROM public.appf2_agent_free_ci_preview p "+
  "JOIN public.appf2_agent_free_ci_receipt r ON "+
  "r.job_id=p.job_id AND r.project_hash=p.project_hash "+
  "WHERE p.job_id=$1::uuid AND p.owner_anonymous_id=$2::uuid "+
  "AND p.project_hash=$3::text AND p.run_id=r.run_id "+
  "AND p.artifact_hash=r.built_artifact_hash",
  [scope.jobId,input.anonymous_id,input.expected_project_hash]);
 const data=rows.rows[0]?.preview_json;
 if(!validFreeCiBuiltPreview(data)||
  data.project_hash!==input.expected_project_hash||
  data.artifact_hash!==rows.rows[0]?.artifact_hash)
  throw Error("FREE_CI_PREVIEW_NOT_VERIFIED");
 return {project_hash:data.project_hash,index_html:data.index_html,
  javascript:data.javascript,css:data.css,app_published:false};
}
const H={"Content-Type":"application/json; charset=utf-8","Cache-Control":"private, no-store"};
const denied=()=>new Response(JSON.stringify({error:"FREE_CI_NOT_AUTHORIZED"}),
 {status:404,headers:H});
/** Authenticated private runner callback only; never accept owner-supplied code. */
// eslint-disable-next-line complexity -- Independent OIDC, AES, bytes, hash and DB fences.
export async function routePrivateFreeCiPreview(request:Request,url:URL,
 env:Appf2WorkerEnv,nowMs:number):Promise<Response|undefined>{
 if(url.pathname!==FREE_CI_PRIVATE_PREVIEW)return undefined;
 if(env.APPF2_AGENT_FREE_ONLY!=="1"||request.method!=="POST"||url.search||
  request.headers.get("Content-Type")?.split(";")[0]!=="application/json"||
  Number(request.headers.get("Content-Length")??0)>500000)return denied();
 const authorization=request.headers.get("Authorization")??"";
 if(!authorization.startsWith("Bearer ")||authorization.length>12020)return denied();
 const body=await request.text();
 if(body.length>500000)return denied();
 let parsed:unknown;
 try{parsed=JSON.parse(body);}catch{return denied();}
 if(!exact(parsed,["ticket","preview"])||typeof parsed.ticket!=="string"||
  !validFreeCiBuiltPreview(parsed.preview))return denied();
 const ticket=await openFreeCiTicket(parsed.ticket,
  env.APPF2_IDENTITY_COOKIE_SECRET,nowMs);
 if(!ticket||ticket.project_hash!==parsed.preview.project_hash)return denied();
 const runId=await verifiedLiveFreeCiOidcRunId(authorization.slice(7),nowMs);
 if(!runId)return denied();
 const db=new WorkerPostgresExecutor(env.HYPERDRIVE_FRESH,
  {anonymousId:ticket.owner,intentId:null});
 try{
  const state=await saveFreeCiBuiltPreview(db,{jobId:ticket.job_id,
   owner:ticket.owner,projectHash:ticket.project_hash,runId},parsed.preview);
  return new Response(JSON.stringify({data:{status:state,
   project_hash:ticket.project_hash,app_published:false}}),
   {status:200,headers:H});
 }catch{return denied();}
 finally{await db.close();}
}
