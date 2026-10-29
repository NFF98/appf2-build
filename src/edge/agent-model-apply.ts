/**
 * Apply exactly one durable model-authored data-only file edit.
 * The model response must already be stored in the private paid-call journal.
 * Never runs generated source, package scripts or OS commands in the Worker.
 */
import {recoverAgentJob,advanceDurableAgentJob}
 from "../platform/agent/durable-agent-service.js";
import {getModelCall} from "../platform/agent/postgres-model-calls.js";
import {executeAgentTurn} from "../platform/agent/agent-turn.js";
import {parseAgentResponsesBatch} from "../platform/agent/responses-api.js";
import {sha256CodeBytes} from "../platform/blueprint/code-artifact-v2.js";
import {provenProjectRead} from "../platform/agent/verified-project-read.js";
import type {AgentJobExecutor} from "../platform/agent/postgres-agent-jobs.js";
export type ApplyModelEditInput={
 readonly anonymous_id:string;readonly model_call_key:string;
 readonly expected_revision:number;
};
export type ApplyModelEditDeps={
 readonly db:AgentJobExecutor;readonly jobId:string;readonly owner:string;
 readonly ownerThumb:string;
};
const KEY=/^[A-Za-z0-9_-]{8,80}$/u;
export function validApplyModelEditBody(x:unknown):x is ApplyModelEditInput{
 if(typeof x!=="object"||x===null||Array.isArray(x))return false;
 const obj=x as Record<string,unknown>;
 return Object.keys(obj).sort().join(",")==="anonymous_id,expected_revision,model_call_key"&&
  typeof obj.anonymous_id==="string"&&typeof obj.model_call_key==="string"&&
  KEY.test(obj.model_call_key)&&Number.isSafeInteger(obj.expected_revision)&&
  Number(obj.expected_revision)>=0;
}
// eslint-disable-next-line complexity -- Immutable source, model journal and replay checks protect stored project.
export async function applyStoredModelEdit(input:ApplyModelEditInput,
 deps:ApplyModelEditDeps):Promise<{status:"FILE_EDIT_SAVED"|"FILE_READ_SAVED"|"ALREADY_APPLIED";
 project_hash:string;revision:number}>{
 if(!validApplyModelEditBody(input)||input.anonymous_id!==deps.owner)
  throw Error("AGENT_EDIT_NOT_AUTHORIZED");
 const result=await deps.db.query<{job_id:string}>(`SELECT job_id::text
  FROM public.appf2_agent_job WHERE job_id=$1::uuid
  AND owner_anonymous_id=$2::uuid AND owner_key_thumbprint=$3::text LIMIT 1`,
  [deps.jobId,deps.owner,deps.ownerThumb]);
 if(result.rows[0]?.job_id!==deps.jobId)throw Error("AGENT_EDIT_CREATOR_MISMATCH");
 const current=await recoverAgentJob(deps.db,deps.jobId,deps.owner);
 if(!current)throw Error("AGENT_EDIT_JOB_MISSING");
 const record=await getModelCall(deps.db,deps.jobId,deps.owner,input.model_call_key);
 if(!record||record.status!=="SUCCEEDED"||record.response_json===null)
  throw Error("AGENT_EDIT_RESPONSE_NOT_DURABLE");
 const currentParsed=parseAgentResponsesBatch(record.response_json,current.project.project_hash);
 const raw=record.response_json as {output?:unknown[]};
 const first=Array.isArray(raw.output)?
  raw.output.find(x=>typeof x==="object"&&x!==null&&
   (x as {type?:unknown}).type==="function_call") as {call_id?:unknown}|undefined:undefined;
 const callId=typeof first?.call_id==="string"?first.call_id:"";
 if(current.job.revision>input.expected_revision&&
   current.job.checkpoint.completed_call_ids.includes(callId)&&
   record.job_revision===input.expected_revision)
  return {status:"ALREADY_APPLIED",project_hash:current.project.project_hash,
   revision:current.job.revision};
 if(current.job.revision!==input.expected_revision||!currentParsed||
   currentParsed.calls.length!==1)return failEdit();
 if(record.job_revision!==current.job.revision||
   record.checkpoint_hash!==current.job.checkpoint_hash)
  return failEdit();
 const call=currentParsed.calls[0];
 if(call.name!=="write_file"&&call.name!=="delete_file"&&call.name!=="read_file")
  return failEdit();
 const edit=await executeAgentTurn(current,record.response_json,{
  broker:async(_project,requested)=>{
   if(requested.call_id!==call.call_id||requested.name!==call.name)
    throw Error("AGENT_EDIT_CALL_MISMATCH");
   if(requested.name==="read_file")return provenProjectRead(current.project,requested);
   const detail="DATA_ONLY_EDIT_ADMITTED_NO_EXECUTION";
   return {call_id:call.call_id,project_hash:current.project.project_hash,
    exit_code:0,timed_out:false,detail,
    output_digest:await sha256CodeBytes(new TextEncoder().encode(detail)),
    runner_attestation:"APPF2_DATA_ONLY_FILE_EDIT_V1"};
  },
  persist:(previous,next,project)=>advanceDurableAgentJob(deps.db,
   previous.job,deps.owner,next,project)
 });
 return {status:call.name==="read_file"?"FILE_READ_SAVED":"FILE_EDIT_SAVED",
  project_hash:edit.saved.project.project_hash,
  revision:edit.saved.job.revision};
}
function failEdit():never{throw Error("AGENT_EDIT_STALE_OR_UNSUPPORTED");}
