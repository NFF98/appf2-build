/** Owner-P256-publication of a fully browser-tested free CI App bundle.
 * Never substitutes smoke for QA, and never auto-opt-ins to public sharing.
 */
import {recoverAgentJob} from "../platform/agent/durable-agent-service.js";
import {parseQaPlan} from "../platform/qa/requirement-contract.js";
import {makePrototypeCodeArtifact,verifyPrototypeCodeArtifact,sha256CodeBytes}
 from "../platform/blueprint/code-artifact-v2.js";
import {validFreeCiBuiltPreview} from "./free-ci-preview.js";
import {validQaChecks} from "./free-ci-result.js";
import type {AgentJobExecutor} from "../platform/agent/postgres-agent-jobs.js";
const HASH=/^sha256:[a-f0-9]{64}$/u;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export type PublishOwnerAppBody={readonly anonymous_id:string;
 readonly expected_project_hash:string;readonly original_prompt:string;
 readonly title:string;readonly explicit_public_share_consent:true};
export function validPublishOwnerAppBody(x:unknown):x is PublishOwnerAppBody{
 if(typeof x!=="object"||x===null||Array.isArray(x))return false;
 const v=x as Record<string,unknown>;
 return Object.keys(v).sort().join(",")===
  "anonymous_id,expected_project_hash,explicit_public_share_consent,original_prompt,title"&&
  typeof v.anonymous_id==="string"&&UUID.test(v.anonymous_id)&&
  typeof v.expected_project_hash==="string"&&HASH.test(v.expected_project_hash)&&
  typeof v.original_prompt==="string"&&v.original_prompt.length>=5&&
  v.original_prompt.length<=800&&typeof v.title==="string"&&
  v.title.trim().length>=1&&v.title.trim().length<=80&&
  !/[\u0000-\u001f]/u.test(v.title)&&v.explicit_public_share_consent===true;
}
type Evidence={readonly run_id:string;readonly built_artifact_hash:string;
 readonly receipt_json:unknown;readonly preview_json:unknown;
 readonly original_plan:unknown};
type Prior={share_id:string;status:string;blueprint_hash:string|null};
const EXISTING="SELECT share_id::text,status,blueprint_hash FROM public.appf2_code_app "+
 "WHERE creator_anonymous_id=$1::uuid AND creator_key_thumbprint=$2::text "+
 "AND idempotency_key=$3::text LIMIT 1";
const INSERT="INSERT INTO public.appf2_code_app "+
 "(share_id,creator_anonymous_id,creator_key_thumbprint,idempotency_key,title,prompt,public_opt_in) "+
 "VALUES($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,true) "+
 "ON CONFLICT(creator_key_thumbprint,idempotency_key) DO NOTHING RETURNING share_id::text";
const FINISH="UPDATE public.appf2_code_app SET status='ACTIVE',title=$2,blueprint_hash=$3,artifact=$4::jsonb "+
 "WHERE share_id=$1::uuid AND status='BUILDING' AND creator_anonymous_id=$5::uuid "+
 "RETURNING share_id::text";
export async function publishVerifiedPrivateApp(input:PublishOwnerAppBody,ctx:{
 readonly db:AgentJobExecutor;readonly jobId:string;
 readonly ownerThumb:string;readonly creatorKeyThumbprint:string;
}):Promise<{share_id:string;url:string;status:"ACTIVE";blueprint_hash:string}>{
 if(!validPublishOwnerAppBody(input)||ctx.creatorKeyThumbprint.length!==43)
  throw Error("SP35_SHARE_INPUT_INVALID");
 const creator=(await ctx.db.query<{job_id:string}>(
  "SELECT job_id::text FROM public.appf2_agent_job "+
  "WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid AND owner_key_thumbprint=$3::text LIMIT 1",
  [ctx.jobId,input.anonymous_id,ctx.ownerThumb])).rows[0];
 if(creator?.job_id!==ctx.jobId)throw Error("SP35_SHARE_NOT_CREATOR");
 const current=await recoverAgentJob(ctx.db,ctx.jobId,input.anonymous_id);
 const digest=await sha256CodeBytes(new TextEncoder().encode(
  "APPF2_AGENT_REQUEST_V1\u0000"+input.original_prompt.trim()));
 if(!current||current.job.request_hash!==digest||
  current.project.project_hash!==input.expected_project_hash||
  current.project.revision<2)throw Error("SP35_SHARE_STALE_OR_WRONG_PROMPT");
 const receipt=(await ctx.db.query<Evidence>(
  "SELECT r.run_id,r.built_artifact_hash,r.receipt_json,p.preview_json,q.original_plan "+
  "FROM public.appf2_agent_free_ci_receipt r "+
  "JOIN public.appf2_agent_free_ci_preview p ON p.job_id=r.job_id "+
  "AND p.project_hash=r.project_hash AND p.run_id=r.run_id "+
  "AND p.artifact_hash=r.built_artifact_hash "+
  "JOIN public.appf2_agent_qa_plan q ON q.job_id=r.job_id "+
  "AND q.owner_anonymous_id=r.owner_anonymous_id "+
  "WHERE r.job_id=$1::uuid AND r.owner_anonymous_id=$2::uuid "+
  "AND r.project_hash=$3::text LIMIT 1",
  [ctx.jobId,input.anonymous_id,input.expected_project_hash])).rows[0];
 const plan=parseQaPlan(receipt?.original_plan,input.original_prompt);
 const evidence=receipt?.receipt_json as {qa_checks?:unknown;qa_plan_hash?:unknown;
  original_requirements_qa?:unknown;app_published?:unknown}|null;
 if(!receipt||!plan||!evidence||!validQaChecks(evidence.qa_checks)||
  !plan.criteria.every((c,i)=>c.automatable&&
   evidence.qa_checks?.[i]?.criterion_id===c.id&&
   evidence.qa_checks?.[i]?.verdict==="PASS"&&
   typeof evidence.qa_checks?.[i]?.evidence_hash==="string")||
  evidence.original_requirements_qa!==false||evidence.app_published!==false)
  throw Error("SP35_SHARE_ORIGINAL_QA_NOT_ALL_PASS");
 const asset=receipt.preview_json;
 if(!validFreeCiBuiltPreview(asset)||
  asset.project_hash!==input.expected_project_hash||
  asset.artifact_hash!==receipt.built_artifact_hash)
  throw Error("SP35_SHARE_BUILD_NOT_VERIFIED");
 // The original JS is already a Vite bundle. Inline its separately saved CSS
 // within the network-disabled card while preserving exact saved source bytes.
 const compiled="(()=>{const style=document.createElement('style');"+
  "style.textContent="+JSON.stringify(asset.css)+";"+
  "document.head.appendChild(style);})();\n"+asset.javascript;
 const pack=await makePrototypeCodeArtifact(input.title.trim(),compiled);
 const accepted=await verifyPrototypeCodeArtifact(pack);
 if(!accepted.ok)throw Error("SP35_SHARE_ARTIFACT_ADMISSION_FAILED");
 const idempotency="sp35_"+(await sha256CodeBytes(new TextEncoder().encode(
  "SP35_PUBLIC_OWNER_CONSENT_V1\u0000"+ctx.jobId+"\u0000"+
  input.expected_project_hash))).slice(7,39);
 const prior=(await ctx.db.query<Prior>(EXISTING,
  [input.anonymous_id,ctx.creatorKeyThumbprint,idempotency])).rows[0];
 if(prior){
  if(prior.status!=="ACTIVE"||prior.blueprint_hash!==accepted.blueprint_hash)
   throw Error("SP35_SHARE_PREVIOUS_UNCERTAIN_NO_RETRY");
  return {share_id:prior.share_id,url:"/code/"+prior.share_id,
   status:"ACTIVE",blueprint_hash:accepted.blueprint_hash};
 }
 const shareId=crypto.randomUUID();
 const inserted=(await ctx.db.query<{share_id:string}>(INSERT,[
  shareId,input.anonymous_id,ctx.creatorKeyThumbprint,idempotency,
  input.title.trim(),input.original_prompt.trim()])).rows[0];
 if(inserted?.share_id!==shareId)throw Error("SP35_SHARE_CONCURRENT_INSERT");
 const done=(await ctx.db.query<{share_id:string}>(FINISH,[
  shareId,input.title.trim(),accepted.blueprint_hash,JSON.stringify(pack),
  input.anonymous_id])).rows[0];
 if(done?.share_id!==shareId)throw Error("SP35_SHARE_SAVE_UNCERTAIN");
 return {share_id:shareId,url:"/code/"+shareId,
  status:"ACTIVE",blueprint_hash:accepted.blueprint_hash};
}
