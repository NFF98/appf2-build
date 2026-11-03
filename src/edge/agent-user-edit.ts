/** Sprint 3.5 persistent USER_EDIT: accepted head is NOT mutable Job head.
 * All methods require the creator's validated P-256 proof at the route.
 * Never executes paid AI, changes source, or infers QA success.
 */
import {recoverAgentJob} from "../platform/agent/durable-agent-service.js";
import {parseQaPlan,type QaPlan} from "../platform/qa/requirement-contract.js";
import {sha256CodeBytes} from "../platform/blueprint/code-artifact-v2.js";
import {frozenFreeCiPlanHash,readFreeCiSmoke} from "./free-ci-result.js";
import type {AgentJobExecutor} from "../platform/agent/postgres-agent-jobs.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HASH=/^sha256:[a-f0-9]{64}$/u;
type Ctx={readonly db:AgentJobExecutor;readonly jobId:string;readonly ownerThumb:string};
export type AcceptedRow={readonly project_hash:string;readonly project_revision:number;
 readonly generation:number;readonly requirements_text:string;
 readonly qa_plan:QaPlan;readonly qa_plan_hash:string};
export type UserEditRow={readonly edit_id:string;readonly base_project_hash:string;
 readonly base_generation:number;readonly user_request:string;readonly state:string;
 readonly new_qa_plan:QaPlan;readonly combined_qa_plan:QaPlan;
 readonly combined_qa_hash:string;readonly candidate_project_hash:string|null;
 readonly candidate_project_revision:number|null};
type Base={readonly anonymous_id:string};
export type InitializeEditInput=Base&{readonly original_prompt:string;
 readonly expected_project_hash:string;readonly expected_revision:number};
export type CreateUserEditInput=Base&{readonly expected_project_hash:string;
 readonly expected_revision:number;readonly expected_generation:number;
 readonly user_request:string;readonly new_qa_plan:QaPlan};
export type AcceptUserEditInput=Base&{readonly expected_accepted_hash:string;
 readonly expected_generation:number;readonly explicit_accept_consent:true};
export function validInitializeEdit(x:unknown):x is InitializeEditInput{
 if(!x||typeof x!=="object"||Array.isArray(x))return false;
 const v=x as Record<string,unknown>;
 return Object.keys(v).sort().join(",")===
  "anonymous_id,expected_project_hash,expected_revision,original_prompt"&&
  typeof v.anonymous_id==="string"&&UUID.test(v.anonymous_id)&&
  typeof v.expected_project_hash==="string"&&HASH.test(v.expected_project_hash)&&
  Number.isSafeInteger(v.expected_revision)&&Number(v.expected_revision)>=2&&
  typeof v.original_prompt==="string"&&v.original_prompt.trim().length>=5&&
  v.original_prompt.length<=800;
}
// eslint-disable-next-line complexity -- Exact owner, version and QA contract fields.
export function validCreateUserEdit(x:unknown):x is CreateUserEditInput{
 if(!x||typeof x!=="object"||Array.isArray(x))return false;
 const v=x as Record<string,unknown>;
 return Object.keys(v).sort().join(",")===
  "anonymous_id,expected_generation,expected_project_hash,expected_revision,new_qa_plan,user_request"&&
  typeof v.anonymous_id==="string"&&UUID.test(v.anonymous_id)&&
  typeof v.expected_project_hash==="string"&&HASH.test(v.expected_project_hash)&&
  Number.isSafeInteger(v.expected_revision)&&Number(v.expected_revision)>=2&&
  Number.isSafeInteger(v.expected_generation)&&Number(v.expected_generation)>=0&&
  typeof v.user_request==="string"&&v.user_request.trim().length>=5&&
  v.user_request.length<=800&&parseQaPlan(v.new_qa_plan,v.user_request)!==null;
}
export function validAcceptUserEdit(x:unknown):x is AcceptUserEditInput{
 if(!x||typeof x!=="object"||Array.isArray(x))return false;
 const v=x as Record<string,unknown>;
 return Object.keys(v).sort().join(",")===
  "anonymous_id,expected_accepted_hash,expected_generation,explicit_accept_consent"&&
  typeof v.anonymous_id==="string"&&UUID.test(v.anonymous_id)&&
  typeof v.expected_accepted_hash==="string"&&HASH.test(v.expected_accepted_hash)&&
  Number.isSafeInteger(v.expected_generation)&&Number(v.expected_generation)>=0&&
  v.explicit_accept_consent===true;
}
export async function assertEditOwner(owner:string,ctx:Ctx):Promise<void>{
 const row=(await ctx.db.query<{job_id:string}>(
  "SELECT job_id::text FROM public.appf2_agent_job "+
  "WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid "+
  "AND owner_key_thumbprint=$3::text LIMIT 1",
  [ctx.jobId,owner,ctx.ownerThumb])).rows[0];
 if(row?.job_id!==ctx.jobId)throw Error("SP35_USER_EDIT_NOT_CREATOR");
}
export async function readAccepted(db:AgentJobExecutor,jobId:string,
 owner:string):Promise<AcceptedRow|null>{
 return (await db.query<AcceptedRow>(
  "SELECT project_hash,project_revision,generation,requirements_text,qa_plan,qa_plan_hash "+
  "FROM public.appf2_agent_accepted_version "+
  "WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid LIMIT 1",
  [jobId,owner])).rows[0]??null;
}
export async function readUserEdit(db:AgentJobExecutor,jobId:string,
 owner:string,editId:string):Promise<UserEditRow|null>{
 return (await db.query<UserEditRow>(
  "SELECT edit_id::text,base_project_hash,base_generation,user_request,state,new_qa_plan,"+
  "combined_qa_plan,combined_qa_hash,candidate_project_hash,candidate_project_revision "+
  "FROM public.appf2_agent_user_edit WHERE job_id=$1::uuid "+
  "AND owner_anonymous_id=$2::uuid AND edit_id=$3::uuid LIMIT 1",
  [jobId,owner,editId])).rows[0]??null;
}
export async function effectiveEditQaPlan(db:AgentJobExecutor,jobId:string,
 owner:string,projectHash:string):Promise<QaPlan|null>{
 const edit=(await db.query<{combined_qa_plan:QaPlan}>(
  "SELECT combined_qa_plan FROM public.appf2_agent_user_edit "+
  "WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid "+
  "AND candidate_project_hash=$3::text AND state IN ('QA_REQUIRED','QA_FAILED','ACCEPTED') LIMIT 1",
  [jobId,owner,projectHash])).rows[0];
 if(edit)return edit.combined_qa_plan;
 const accepted=await readAccepted(db,jobId,owner);
 if(accepted?.project_hash===projectHash)return accepted.qa_plan;
 return null;
}
/** Idempotent one-time promotion of a *previously independently tested* baseline. */
// eslint-disable-next-line complexity -- Must verify old owner, source, immutable QA and real receipt before accepting.
export async function initializeAcceptedVersion(input:InitializeEditInput,ctx:Ctx){
 if(!validInitializeEdit(input))throw Error("SP35_USER_EDIT_INIT_INPUT");
 await assertEditOwner(input.anonymous_id,ctx);
 const current=await recoverAgentJob(ctx.db,ctx.jobId,input.anonymous_id);
 const digest=await sha256CodeBytes(new TextEncoder().encode(
  "APPF2_AGENT_REQUEST_V1\u0000"+input.original_prompt.trim()));
 if(!current||current.job.request_hash!==digest||
  current.project.project_hash!==input.expected_project_hash||
  current.job.revision!==input.expected_revision||
  current.project.revision<2||current.job.job_state!=="CODING")
  throw Error("SP35_USER_EDIT_INIT_STALE_OR_NOT_TESTED");
 const planRow=(await ctx.db.query<{original_plan:unknown}>(
  "SELECT original_plan FROM public.appf2_agent_qa_plan "+
  "WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid LIMIT 1",
  [ctx.jobId,input.anonymous_id])).rows[0];
 const plan=parseQaPlan(planRow?.original_plan,input.original_prompt);
 const qa=await readFreeCiSmoke(ctx.db,ctx.jobId,input.anonymous_id,
  current.project.project_hash);
 if(!plan||!qa||qa.status!=="BUILD_BROWSER_SMOKE"||
  !qa.preview_ready||qa.qa_plan_hash!==await frozenFreeCiPlanHash(plan)||
  qa.qa_checks?.length!==plan.criteria.length||
  !plan.criteria.every((c,i)=>c.automatable&&
   qa.qa_checks?.[i]?.criterion_id===c.id&&qa.qa_checks?.[i]?.verdict==="PASS"))
  throw Error("SP35_USER_EDIT_ORIGINAL_QA_NOT_ALL_PASS");
 const hash=await frozenFreeCiPlanHash(plan);
 await ctx.db.query(
  "INSERT INTO public.appf2_agent_accepted_version "+
  "(job_id,owner_anonymous_id,project_hash,project_revision,requirements_text,qa_plan,qa_plan_hash) "+
  "VALUES($1::uuid,$2::uuid,$3::text,$4::integer,$5::text,$6::jsonb,$7::text) "+
  "ON CONFLICT(job_id) DO NOTHING",
  [ctx.jobId,input.anonymous_id,input.expected_project_hash,
   current.project.revision,input.original_prompt.trim(),JSON.stringify(plan),hash]);
 const accepted=await readAccepted(ctx.db,ctx.jobId,input.anonymous_id);
 if(accepted?.project_hash!==input.expected_project_hash)
  throw Error("SP35_USER_EDIT_ACCEPTED_ALREADY_DIFFERENT");
 return {status:"ACCEPTED_BASELINE_CONFIRMED" as const,accepted,paid_ai_calls:0};
}
export async function createUserEdit(input:CreateUserEditInput,ctx:Ctx){
 if(!validCreateUserEdit(input))throw Error("SP35_USER_EDIT_INVALID_QA");
 await assertEditOwner(input.anonymous_id,ctx);
 const current=await recoverAgentJob(ctx.db,ctx.jobId,input.anonymous_id);
 const accepted=await readAccepted(ctx.db,ctx.jobId,input.anonymous_id);
 if(!current||!accepted||accepted.project_hash!==input.expected_project_hash||
  accepted.generation!==input.expected_generation||
  current.job.revision!==input.expected_revision||
  current.project.project_hash!==accepted.project_hash||
  current.job.job_state!=="CODING")
  throw Error("SP35_USER_EDIT_BASE_CAS_CONFLICT");
 const criteria=[...accepted.qa_plan.criteria,...input.new_qa_plan.criteria];
 const combined={version:"1" as const,criteria};
 if(criteria.length>20||!parseQaPlan(combined,
  accepted.requirements_text+"\n"+input.user_request))
  throw Error("SP35_USER_EDIT_QA_CANNOT_ACCUMULATE");
 const hash=await frozenFreeCiPlanHash(combined),editId=crypto.randomUUID();
 const added=(await ctx.db.query<{edit_id:string}>(
  "INSERT INTO public.appf2_agent_user_edit "+
  "(edit_id,job_id,owner_anonymous_id,base_project_hash,base_generation,"+
  "user_request,new_qa_plan,combined_qa_plan,combined_qa_hash,state) "+
  "SELECT $1::uuid,$2::uuid,$3::uuid,$4::text,$5::integer,$6::text,$7::jsonb,"+
  "$8::jsonb,$9::text,'DRAFT' FROM public.appf2_agent_accepted_version a "+
  "WHERE a.job_id=$2::uuid AND a.owner_anonymous_id=$3::uuid "+
  "AND a.project_hash=$4::text AND a.generation=$5::integer "+
  "ON CONFLICT DO NOTHING RETURNING edit_id::text",
  [editId,ctx.jobId,input.anonymous_id,input.expected_project_hash,
   input.expected_generation,input.user_request.trim(),JSON.stringify(input.new_qa_plan),
   JSON.stringify(combined),hash])).rows[0];
 if(added?.edit_id!==editId)throw Error("SP35_USER_EDIT_CONCURRENT_OR_DUPLICATE");
 return {status:"USER_EDIT_DRAFT_SAVED_NO_AI" as const,edit_id:editId,
  accepted_project_hash:accepted.project_hash,combined_qa_hash:hash,paid_ai_calls:0};
}
export async function inspectUserEditState(owner:string,ctx:Ctx){
 await assertEditOwner(owner,ctx);
 const accepted=await readAccepted(ctx.db,ctx.jobId,owner);
 const edits=(await ctx.db.query<UserEditRow>(
  "SELECT edit_id::text,base_project_hash,base_generation,user_request,state,"+
  "new_qa_plan,combined_qa_plan,combined_qa_hash,candidate_project_hash,candidate_project_revision "+
  "FROM public.appf2_agent_user_edit WHERE job_id=$1::uuid "+
  "AND owner_anonymous_id=$2::uuid ORDER BY created_at DESC LIMIT 12",
  [ctx.jobId,owner])).rows;
 return {accepted,edits,paid_ai_calls:0};
}
export async function acceptUserEdit(input:AcceptUserEditInput,editId:string,ctx:Ctx){
 if(!validAcceptUserEdit(input)||!UUID.test(editId))
  throw Error("SP35_USER_EDIT_ACCEPT_INVALID");
 await assertEditOwner(input.anonymous_id,ctx);
 const edit=await readUserEdit(ctx.db,ctx.jobId,input.anonymous_id,editId);
 const accepted=await readAccepted(ctx.db,ctx.jobId,input.anonymous_id);
 if(!edit||!accepted||edit.state!=="QA_REQUIRED"||
  edit.base_project_hash!==input.expected_accepted_hash||
  accepted.project_hash!==input.expected_accepted_hash||
  accepted.generation!==input.expected_generation)
  throw Error("SP35_USER_EDIT_ACCEPTED_STALE_OR_UNTESTED");
 const updated=(await ctx.db.query<{generation:number}>(
  "SELECT appf2_internal.accept_user_edit($1::uuid,$2::uuid,$3::uuid,$4::text,$5::integer) AS generation",
  [ctx.jobId,editId,input.anonymous_id,input.expected_accepted_hash,
   input.expected_generation])).rows[0];
 if(updated?.generation!==input.expected_generation+1)
  throw Error("SP35_USER_EDIT_ACCEPT_COMMIT_UNCERTAIN");
 const next=await readAccepted(ctx.db,ctx.jobId,input.anonymous_id);
 return {status:"USER_EDIT_ACCEPTED" as const,accepted:next,paid_ai_calls:0};
}
