/** Creator-signed immutable original QA plan, saved BEFORE model coding.
 * No AI costs or generated source are involved. Publication always disabled.
 */
import {recoverAgentJob} from "../platform/agent/durable-agent-service.js";
import {sha256CodeBytes,canonicalArtifactJson}
 from "../platform/blueprint/code-artifact-v2.js";
import {parseQaPlan,type QaPlan} from "../platform/qa/requirement-contract.js";
import type {AgentJobExecutor} from "../platform/agent/postgres-agent-jobs.js";
export type QaPlanInput={readonly anonymous_id:string;readonly expected_revision:0;
 readonly original_prompt:string;readonly original_plan:QaPlan};
export function validFreezeQaPlanBody(raw:unknown):raw is QaPlanInput{
 if(typeof raw!=="object"||raw===null||Array.isArray(raw))return false;
 const x=raw as Record<string,unknown>;
 return Object.keys(x).sort().join(",")===
  "anonymous_id,expected_revision,original_plan,original_prompt"&&
  typeof x.anonymous_id==="string"&&x.expected_revision===0&&
  typeof x.original_prompt==="string"&&
  x.original_prompt.trim().length>=5&&x.original_prompt.length<=800&&
  parseQaPlan(x.original_plan,x.original_prompt)!==null;
}
export async function verifyFrozenQaPlan(db:AgentJobExecutor,
 jobId:string,owner:string,prompt:string,plan:QaPlan):Promise<boolean>{
 const found=(await db.query<{original_plan:unknown}>(
  "SELECT original_plan FROM public.appf2_agent_qa_plan WHERE job_id=$1::uuid "+
  "AND owner_anonymous_id=$2::uuid LIMIT 1",[jobId,owner])).rows[0];
 if(!found)return false;
 const saved=parseQaPlan(found.original_plan,prompt);
 return saved!==null&&canonicalArtifactJson(saved)===canonicalArtifactJson(plan);
}
export async function freezeAgentQaPlan(input:QaPlanInput,deps:{
 readonly db:AgentJobExecutor;readonly jobId:string;readonly owner:string;
 readonly ownerThumb:string}){
 if(!validFreezeQaPlanBody(input)||input.anonymous_id!==deps.owner)
  throw Error("QA_PLAN_INVALID");
 const creator=(await deps.db.query<{job_id:string}>(
  "SELECT job_id::text\n FROM public.appf2_agent_job WHERE job_id=$1::uuid "+
  "AND owner_anonymous_id=$2::uuid AND owner_key_thumbprint=$3::text LIMIT 1",
  [deps.jobId,deps.owner,deps.ownerThumb])).rows[0];
 if(creator?.job_id!==deps.jobId)throw Error("QA_PLAN_OWNER_MISMATCH");
 const current=await recoverAgentJob(deps.db,deps.jobId,deps.owner);
 if(!current||current.job.revision!==0||current.job.job_state!=="CREATED")
  throw Error("QA_PLAN_MUST_PRECEDE_AI");
 const digest=await sha256CodeBytes(new TextEncoder().encode(
  "APPF2_AGENT_REQUEST_V1\u0000"+input.original_prompt.trim()));
 if(digest!==current.job.request_hash)throw Error("QA_PLAN_PROMPT_MISMATCH");
 const frozen=await deps.db.query<{job_id:string}>(
  "INSERT INTO public.appf2_agent_qa_plan"+
  "(job_id,owner_anonymous_id,original_prompt_hash,original_plan) "+
  "VALUES($1::uuid,$2::uuid,$3::text,$4::jsonb) "+
  "ON CONFLICT (job_id) DO NOTHING RETURNING job_id::text",
  [deps.jobId,deps.owner,digest,JSON.stringify(input.original_plan)]);
 if(frozen.rows.length!==1&&
  !await verifyFrozenQaPlan(deps.db,deps.jobId,deps.owner,
   input.original_prompt,input.original_plan))
  throw Error("QA_PLAN_ALREADY_FROZEN");
 return {status:"QA_ORIGINAL_PLAN_FROZEN" as const,
  criteria_count:input.original_plan.criteria.length,
  project_hash:current.project.project_hash,
  revision:0,app_published:false as const};
}
