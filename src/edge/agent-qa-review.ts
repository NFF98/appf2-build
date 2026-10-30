/** P-256 owner-signed independent QA review: NO model, sandbox, or publication. */
import {recoverAgentJob} from "../platform/agent/durable-agent-service.js";
import {validAgentQaPacket,verifyAgentQaPacket,type AgentQaPacket}
 from "../platform/agent/qa-packet.js";
import type {AgentJobExecutor} from "../platform/agent/postgres-agent-jobs.js";
export type QaReviewInput={readonly anonymous_id:string;readonly packet:AgentQaPacket};
export function validQaReviewBody(x:unknown):x is QaReviewInput{
 if(typeof x!=="object"||x===null||Array.isArray(x))return false;
 const v=x as Record<string,unknown>;
 return Object.keys(v).sort().join(",")==="anonymous_id,packet"&&
  typeof v.anonymous_id==="string"&&validAgentQaPacket(v.packet);
}
type SavedRun={readonly status:string;readonly receipt_json:unknown;
 readonly job_id:string;readonly owner_anonymous_id:string;
 readonly call_id:string;readonly project_hash:string};
function passedRun(row:SavedRun|undefined,callId:string,
 jobId:string,owner:string,hash:string):boolean{
 if(!row||row.job_id!==jobId||row.owner_anonymous_id!==owner||
  row.call_id!==callId||row.project_hash!==hash||
  row.status!=="SUCCEEDED")return false;
 const r=row.receipt_json;
 if(typeof r!=="object"||r===null||Array.isArray(r))return false;
 const e=r as Record<string,unknown>;
 return e.call_id===callId&&e.project_hash===hash&&
  e.exit_code===0&&e.timed_out===false&&
  e.runner_attestation==="APPF2_ISOLATED_CLOUDFLARE_CONTAINER_V1";
}
export async function reviewAgentQa(input:QaReviewInput,deps:{
 readonly db:AgentJobExecutor;readonly jobId:string;
 readonly owner:string;readonly ownerThumb:string;readonly verifierSecret:string;
}){
 if(!validQaReviewBody(input)||input.anonymous_id!==deps.owner)
  throw Error("QA_REVIEW_INVALID");
 const creator=(await deps.db.query<{job_id:string}>(
  "SELECT job_id::text\n FROM public.appf2_agent_job WHERE job_id=$1::uuid "+
  "AND owner_anonymous_id=$2::uuid AND owner_key_thumbprint=$3::text LIMIT 1",
  [deps.jobId,deps.owner,deps.ownerThumb])).rows[0];
 if(creator?.job_id!==deps.jobId)throw Error("QA_REVIEW_NOT_CREATOR");
 const current=await recoverAgentJob(deps.db,deps.jobId,deps.owner);
 if(!current)throw Error("QA_REVIEW_JOB_MISSING");
 const last=current.job.checkpoint.completed_call_ids.at(-1)??"";
 const rows=await deps.db.query<SavedRun>(String.raw`SELECT job_id::text,owner_anonymous_id::text,call_id,
 model_call_key,job_revision,
 checkpoint_hash,project_hash,call_hash,max_charge_cents,status,receipt_json
 FROM public.appf2_agent_sandbox_call
 WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid
 AND call_id=$3::text LIMIT 1`,[deps.jobId,deps.owner,last]);
 const failures:string[]=[];
 if(current.job.job_state!=="TESTING")failures.push("QA_JOB_NOT_TESTED");
 if(!passedRun(rows.rows[0],last,deps.jobId,deps.owner,
  current.project.project_hash))failures.push("QA_NO_PASSED_SANDBOX_RUN");
 const check=await verifyAgentQaPacket(input.packet,{
  job_id:deps.jobId,original_prompt_hash:current.job.request_hash,
  project_hash:current.project.project_hash,sandbox_execution_id:last
 },deps.verifierSecret);
 return {status:"INDEPENDENT_QA_REVIEWED" as const,
  ready_for_review:failures.length===0&&check.ready_for_review,
  failures:[...failures,...check.failures],
  revision:current.job.revision,project_hash:current.project.project_hash,
  app_published:false as const,publication_authorized:false as const};
}
