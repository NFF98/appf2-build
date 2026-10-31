/**
 * Private paid Responses continuation after an actual durable data-only edit.
 * Reconstruct a tool output from trusted checkpoint/source evidence, NOT model prose.
 * Never executes generated code, publishes a card or automatically spends money.
 */
import {recoverAgentJob} from "../platform/agent/durable-agent-service.js";
import {getModelCall,type ModelCallRow} from "../platform/agent/postgres-model-calls.js";
import {runJournaledPaidModelTurn,type PaidModelTurnDeps}
 from "../platform/agent/journaled-model-gateway.js";
import {parseAgentResponsesBatch,makeAgentToolOutputs}
 from "../platform/agent/responses-api.js";
import {sha256CodeBytes} from "../platform/blueprint/code-artifact-v2.js";
import {provenProjectRead} from "../platform/agent/verified-project-read.js";
import {provenProjectInspection} from "../platform/agent/verified-project-inspection.js";
import {readProvenSandboxToolResult} from "./agent-sandbox-run.js";
import type {RecoveredAgentJob} from "../platform/agent/durable-agent-service.js";
import type {AgentJobExecutor} from "../platform/agent/postgres-agent-jobs.js";

export type ModelContinueInput={
 readonly anonymous_id:string;
 readonly previous_model_call_key:string;
 readonly model_call_key:string;
 readonly expected_revision:number;
 readonly max_charge_cents:number;
 readonly max_output_tokens:number;
 readonly explicit_ai_consent:true;
};
export type ModelContinueDeps={
 readonly db:AgentJobExecutor;readonly owner:string;readonly jobId:string;
 readonly ownerThumb:string;readonly apiKey:string;
 readonly send?:PaidModelTurnDeps["send"];
};
const CALL=/^[A-Za-z0-9_-]{8,80}$/u;
// eslint-disable-next-line complexity -- Signed consent, bounds and call lineage are fail-closed.
export function validModelContinueBody(raw:unknown):raw is ModelContinueInput{
 if(typeof raw!=="object"||raw===null||Array.isArray(raw))return false;
 const x=raw as Record<string,unknown>;
 return Object.keys(x).sort().join(",")===
   "anonymous_id,expected_revision,explicit_ai_consent,max_charge_cents,max_output_tokens,model_call_key,previous_model_call_key"&&
   typeof x.anonymous_id==="string"&&typeof x.model_call_key==="string"&&
   typeof x.previous_model_call_key==="string"&&CALL.test(x.model_call_key)&&
   CALL.test(x.previous_model_call_key)&&x.model_call_key!==x.previous_model_call_key&&
   x.explicit_ai_consent===true&&Number.isSafeInteger(x.expected_revision)&&
   Number(x.expected_revision)>=2&&Number.isSafeInteger(x.max_charge_cents)&&
   Number(x.max_charge_cents)>=1&&Number(x.max_charge_cents)<=100&&
   Number.isSafeInteger(x.max_output_tokens)&&
   Number(x.max_output_tokens)>=512&&Number(x.max_output_tokens)<=4096;
}
async function creatorMatches(db:AgentJobExecutor,jobId:string,owner:string,
 thumb:string):Promise<boolean>{
 const row=(await db.query<{job_id:string}>(`SELECT job_id::text
  FROM public.appf2_agent_job WHERE job_id=$1::uuid
  AND owner_anonymous_id=$2::uuid AND owner_key_thumbprint=$3::text LIMIT 1`,
  [jobId,owner,thumb])).rows[0];
 return row?.job_id===jobId;
}
/** A model may continue only from the immediately previous saved tool result. */
// eslint-disable-next-line complexity -- Check every saved model, sandbox, checkpoint and source identity.
export async function verifiedContinuation(current:RecoveredAgentJob,
 previous:ModelCallRow,db?:AgentJobExecutor,modelCallKey?:string){
 const cp=current.job.checkpoint,project=current.project;
 if(cp.step>=cp.budget.max_steps||
  previous.status!=="SUCCEEDED"||previous.response_json===null||
  previous.job_id!==current.job.job_id||
  previous.owner_anonymous_id!==current.job.owner_anonymous_id||
  !(previous.job_revision===current.job.revision-1&&
    previous.checkpoint_hash===cp.previous_checkpoint_id||
    // Exactly one intervening owner-signed step-budget renewal is permitted.
    // Final completed_call_id and project evidence are still checked below.
    previous.job_revision===current.job.revision-2)||
  previous.response_id===null||cp.completed_call_ids.length===0)
  throw Error("AGENT_CONTINUATION_NOT_READY");
 // Edits create a new snapshot; successful or failed builds do not.
 const edit=project.parent_hash?
  parseAgentResponsesBatch(previous.response_json,project.parent_hash):null;
 if(edit?.response_id===previous.response_id&&edit.calls.length===1&&
  ["write_file","write_files","delete_file"].includes(edit.calls[0].name)&&
  cp.state==="CODING"&&cp.completed_call_ids.at(-1)===edit.calls[0].call_id)
  return editContinuation(project.project_hash,previous.response_id,edit.calls[0]);
 const parsed=parseAgentResponsesBatch(previous.response_json,project.project_hash);
 if(!parsed||parsed.response_id!==previous.response_id||parsed.calls.length!==1||
  cp.completed_call_ids.at(-1)!==parsed.calls[0].call_id)
  throw Error("AGENT_CONTINUATION_TOOL_NOT_PROVEN");
 const call=parsed.calls[0];
 if(["read_file","inspect_project"].includes(call.name)&&cp.state==="CODING"){
  const receipt=call.name==="read_file"?await provenProjectRead(project,call):
   await provenProjectInspection(project,call);
  return {outputs:makeAgentToolOutputs([call],[receipt]),
   previous_response_id:previous.response_id};
 }
 if(!["run_build","run_test"].includes(call.name)||!db||!modelCallKey)
  throw Error("AGENT_CONTINUATION_TOOL_NOT_PROVEN");
 const receipt=await readProvenSandboxToolResult(db,{
  jobId:current.job.job_id,owner:current.job.owner_anonymous_id,
  modelCallKey,jobRevision:previous.job_revision,
  checkpointHash:previous.checkpoint_hash,
  projectHash:project.project_hash,call
 });
 const passed=receipt.exit_code===0&&!receipt.timed_out;
 if(passed?(call.name==="run_build"?cp.state!=="BUILDING":
   cp.state!=="TESTING"):cp.state!=="REPAIRING")
  throw Error("AGENT_CONTINUATION_STATE_MISMATCH");
 return {outputs:makeAgentToolOutputs([call],[receipt]),
  previous_response_id:previous.response_id};
}
/** Ack a saved immutable edit without relying on model-authored success text. */
async function editContinuation(projectHash:string,responseId:string,
 call:import("../platform/agent/agent-contract.js").AgentToolCall){
 const detail="DATA_ONLY_FILE_EDIT_SAVED_TO:"+projectHash;
 const output_digest=await sha256CodeBytes(new TextEncoder().encode(
  "APPF2_AGENT_FILE_EDIT_ACK_V1\u0000"+responseId+"\u0000"+projectHash));
 const outputs=makeAgentToolOutputs([call],[{
  call_id:call.call_id,project_hash:call.project_hash,exit_code:0,
  timed_out:false,detail,output_digest,
  runner_attestation:"APPF2_DATA_ONLY_EDIT_CONFIRMED_V1"
 }]);
 return {outputs,previous_response_id:responseId};
}
/**
 * An owner must explicitly sign EACH bounded paid turn. If any checkpoint
 * mismatches, not even the model transport is contacted.
 */
export async function executeAgentModelContinuation(input:ModelContinueInput,
 deps:ModelContinueDeps):Promise<{status:"MODEL_RESPONSE_SAVED";
 response_id:string;source:"PROVIDER"|"DURABLE_REPLAY";
 project_hash:string;revision:number}>{
 if(!validModelContinueBody(input)||input.anonymous_id!==deps.owner||
   deps.apiKey.length<16||
   !(await creatorMatches(deps.db,deps.jobId,deps.owner,deps.ownerThumb)))
  throw Error("AGENT_CONTINUATION_NOT_AUTHORIZED");
 const current=await recoverAgentJob(deps.db,deps.jobId,deps.owner);
 if(!current||current.job.revision!==input.expected_revision||
  current.job.checkpoint.budget.max_cost_cents<input.max_charge_cents)
  throw Error("AGENT_CONTINUATION_JOB_STALE");
 const previous=await getModelCall(deps.db,deps.jobId,deps.owner,
  input.previous_model_call_key);
 if(!previous)throw Error("AGENT_CONTINUATION_PREVIOUS_CALL_MISSING");
 const continuation=await verifiedContinuation(current,previous,deps.db,
  input.previous_model_call_key);
 const result=await runJournaledPaidModelTurn({
  owner:deps.owner,job:current.job,call_key:input.model_call_key,
  input:continuation.outputs,
  previous_response_id:continuation.previous_response_id,
  max_output_tokens:input.max_output_tokens,
  max_charge_cents:input.max_charge_cents,paid_consent:true,
  api_key:deps.apiKey
 },{db:deps.db,send:deps.send});
 const response=result.response as {id:string};
 return {status:"MODEL_RESPONSE_SAVED",response_id:response.id,
  source:result.source,project_hash:current.project.project_hash,
  revision:current.job.revision};
}
