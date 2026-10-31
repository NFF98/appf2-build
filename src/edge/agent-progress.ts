/**
 * Owner-signed recovery inspection for a bounded list of model-call keys.
 * Read-only: NO model/container dispatch, raw code, logs or release admission.
 * After an interrupted batch, clients can sign a new step at the saved CAS head.
 */
import {recoverAgentJob,type RecoveredAgentJob}
 from "../platform/agent/durable-agent-service.js";
import {getModelCall,listRecentAgentModelCalls,type ModelCallRow}
 from "../platform/agent/postgres-model-calls.js";
import {parseAgentResponsesBatch} from "../platform/agent/responses-api.js";
import type {AgentJobExecutor} from "../platform/agent/postgres-agent-jobs.js";

export type AgentProgressInput={readonly anonymous_id:string;
 readonly model_call_keys?:readonly string[]};
type ProgressState="CURRENT_MODEL_READY"|"INDEPENDENT_QA_REQUIRED"|
 "ALREADY_APPLIED"|"MODEL_UNCERTAIN"|"MODEL_PENDING"|"STALE_MODEL"|
 "MODEL_MISSING"|"INVALID_MODEL_RESPONSE";
type CallProgress={readonly model_call_key:string;readonly state:ProgressState;
 readonly job_revision:number|null;readonly tool:string|null;
 readonly requires_container_consent:boolean;readonly response_id:string|null;
 readonly last_completed_tool:boolean};
export type AgentProgress={
 readonly status:"RECOVERY_INSPECTED";readonly revision:number;
 readonly checkpoint_hash:string;readonly project_hash:string;
 readonly job_state:string;readonly completed_steps:number;
 readonly remaining_steps:number;readonly calls:readonly CallProgress[];
 readonly can_resume:boolean;readonly resume_model_call_key:string|null;
 readonly can_continue_saved_tool_result:boolean;
 readonly resume_previous_model_call_key:string|null;
 readonly next_action:"SIGN_NEXT_SEQUENCE"|"AWAIT_MODEL_RECONCILIATION"|
  "VERIFY_INDEPENDENT_QA"|"BUDGET_RENEWAL_REQUIRED"|"CONTINUE_SAVED_TOOL_RESULT"|
  "NO_PROVEN_PENDING_MODEL"|
  "RECONCILE_AMBIGUOUS_HEAD"|"OWNER_APPROVED_QA_REPAIR_REQUIRED"|
  "REVIEW_SAVED_QA_EVIDENCE"|"AWAIT_QA_RECONCILIATION";
 readonly scope:"SUBMITTED_KEYS_ONLY"|"RECENT_EIGHT_STORED_CALLS";
 /** Read-only receipt state, NOT a pass certificate or permission to publish. */
 readonly qa_attempt_state:"NOT_RUN"|"IN_FLIGHT"|"BLOCKED_UNCERTAIN"|"RESULT_RECORDED";
 /** Observed browser outcomes only; NEVER a release or independent-review PASS. */
 readonly qa_observed_checks:readonly SavedQaCheck[];
 readonly app_published:false;
};
const KEY=/^[A-Za-z0-9_-]{8,80}$/u;
export function validAgentProgressBody(raw:unknown):raw is AgentProgressInput{
 if(typeof raw!=="object"||raw===null||Array.isArray(raw))return false;
 const x=raw as Record<string,unknown>;
 const fields=Object.keys(x).sort().join(",");
 if(typeof x.anonymous_id!=="string")return false;
 if(fields==="anonymous_id")return true;
 return fields==="anonymous_id,model_call_keys"&&Array.isArray(x.model_call_keys)&&
  x.model_call_keys.length>=1&&x.model_call_keys.length<=8&&
  x.model_call_keys.every(v=>typeof v==="string"&&KEY.test(v))&&
  new Set(x.model_call_keys).size===x.model_call_keys.length;
}
/** A pending or uncertain payment outcome blocks ALL model progress, even
 * if one older response looks individually ready. The next action must be
 * read-only reconciliation, never another charged tool/model dispatch.
 */
export function mayResumeSavedModel(states:readonly ProgressState[],
 remaining:number,qaRequired:boolean,jobState:string):boolean{
 return remaining>0&&!qaRequired&&
  !states.some(x=>x==="MODEL_PENDING"||x==="MODEL_UNCERTAIN")&&
  states.filter(x=>x==="CURRENT_MODEL_READY").length===1&&
  !["READY","FAILED","AWAITING_CONSENT"].includes(jobState);
}
type SavedBrowserQaAttempt={readonly status:string;readonly receipt_json:unknown};
export type SavedQaCheck={readonly criterion_id:string;
 readonly verdict:"PASS"|"FAIL"|"UNTESTED";
 readonly evidence_hash:string|null};
/** Only owner-scoped, already-journaled Chromium observations are shown.
 * The broker validated the original frozen criteria at the time of dispatch;
 * this read-only projection checks structure again and grants no PASS.
 */
export function savedQaObservedChecks(row:SavedBrowserQaAttempt|undefined):
 readonly SavedQaCheck[]{
 if(row?.status!=="SUCCEEDED")return [];
 const receipt=row.receipt_json;
 if(typeof receipt!=="object"||receipt===null||Array.isArray(receipt))
  return [];
 const raw=(receipt as Record<string,unknown>).checks;
 if(!Array.isArray(raw)||raw.length<1||raw.length>10)return [];
 const observed:SavedQaCheck[]=[];
 const seen=new Set<string>();
 for(const check of raw){
  if(typeof check!=="object"||check===null||Array.isArray(check))
   return [];
  const x=check as Record<string,unknown>;
  const id=x.criterion_id;
  if(Object.keys(x).sort().join(",")!==
   "category,criterion_id,evidence_hash,verdict"||
   x.category!=="BROWSER"||typeof id!=="string"||
   !/^[A-Za-z0-9_-]{1,80}$/u.test(id)||seen.has(id)||
   !["PASS","FAIL","UNTESTED"].includes(String(x.verdict))||
   (x.verdict==="PASS"?
    !/^sha256:[a-f0-9]{64}$/u.test(String(x.evidence_hash)):
    x.evidence_hash!==null))return [];
  seen.add(id);
  observed.push({criterion_id:id,verdict:x.verdict as SavedQaCheck["verdict"],
   evidence_hash:x.evidence_hash as string|null});
 }
 return observed;
}

/** A saved receipt is only evidence of a completed QA dispatch, not a
 * cryptographically reviewed PASS. Never authorize publication from it.
 */
export function savedBrowserQaAttemptState(row:SavedBrowserQaAttempt|undefined):
 AgentProgress["qa_attempt_state"]{
 if(!row)return "NOT_RUN";
 if(row.status==="IN_FLIGHT")return "IN_FLIGHT";
 if(row.status!=="SUCCEEDED")return "BLOCKED_UNCERTAIN";
 const data=row.receipt_json;
 if(typeof data!=="object"||data===null||Array.isArray(data))
  return "BLOCKED_UNCERTAIN";
 const value=data as Record<string,unknown>;
 if(typeof value.ready_for_review!=="boolean"||
  (value.ready_for_review&&
   (typeof value.packet!=="object"||value.packet===null||
    Array.isArray(value.packet)))||
  (!value.ready_for_review&&value.packet!==null))
  return "BLOCKED_UNCERTAIN";
 return "RESULT_RECORDED";
}
function state(key:string,kind:ProgressState,rev:number|null=null,
 tool:string|null=null,responseId:string|null=null):CallProgress{
 return {model_call_key:key,state:kind,job_revision:rev,tool,
  requires_container_consent:tool==="run_build"||tool==="run_test",
  response_id:responseId,last_completed_tool:false};
}
/** Only a saved response matching the exact source and checkpoint is resumable. */
// eslint-disable-next-line complexity -- Source, CAS, replay, charge and QA boundaries.
function examine(current:RecoveredAgentJob,row:ModelCallRow|null,
 key:string):CallProgress{
 if(!row)return state(key,"MODEL_MISSING");
 if(row.status==="IN_FLIGHT"||row.status==="BLOCKED_UNCERTAIN")
  return state(key,"MODEL_UNCERTAIN",row.job_revision);
 if(row.status!=="SUCCEEDED"||!row.response_json||!row.response_id)
  return state(key,"MODEL_PENDING",row.job_revision);
 const job=current.job;
 const atHead=row.job_revision===job.revision&&
  row.checkpoint_hash===job.checkpoint_hash;
 // Only the immediately prior snapshot may be used to prove a completed
 // edit; older revisions are never reconstructed from untrusted model prose.
 const parsed=parseAgentResponsesBatch(row.response_json,current.project.project_hash)??
  (current.project.parent_hash&&row.job_revision>=job.revision-2?
   parseAgentResponsesBatch(row.response_json,current.project.parent_hash):null);
 if(!parsed||parsed.response_id!==row.response_id||parsed.calls.length>1)
  return state(key,"INVALID_MODEL_RESPONSE",row.job_revision);
 const tool=parsed.calls[0]?.name??null;
 const callId=parsed.calls[0]?.call_id;
 const renewedHead=row.job_revision===job.revision-1&&
  row.checkpoint_hash===job.checkpoint.previous_checkpoint_id&&
  !job.checkpoint.completed_call_ids.includes(callId??"");
 if(atHead||renewedHead){
  if(callId===undefined)
   return state(key,"INDEPENDENT_QA_REQUIRED",row.job_revision,null,row.response_id);
  if(!["read_file","inspect_project","write_file","write_files","delete_file",
   "run_build","run_test"].includes(tool??""))
   return state(key,"INVALID_MODEL_RESPONSE",row.job_revision);
  return state(key,"CURRENT_MODEL_READY",row.job_revision,tool,row.response_id);
 }
 if(row.job_revision<job.revision&&callId!==undefined&&
  job.checkpoint.completed_call_ids.includes(callId))
  return {...state(key,"ALREADY_APPLIED",row.job_revision,tool,row.response_id),
   last_completed_tool:callId===job.checkpoint.completed_call_ids.at(-1)&&
    row.job_revision>=job.revision-2};
 return state(key,"STALE_MODEL",row.job_revision);
}
/** Independent PoP creator verification, even when the caller knows a job UUID. */

// eslint-disable-next-line complexity -- Independently verify creator, journal, source, budget and QA state.
export async function inspectAgentProgress(input:AgentProgressInput,deps:{
 readonly db:AgentJobExecutor;readonly jobId:string;
 readonly owner:string;readonly ownerThumb:string;
}):Promise<AgentProgress>{
 if(!validAgentProgressBody(input)||input.anonymous_id!==deps.owner)
  throw Error("AGENT_PROGRESS_INVALID");
 const creator=(await deps.db.query<{job_id:string}>(
  "SELECT job_id::text\n  FROM public.appf2_agent_job WHERE job_id=$1::uuid\n"+
  "  AND owner_anonymous_id=$2::uuid AND owner_key_thumbprint=$3::text LIMIT 1",
  [deps.jobId,deps.owner,deps.ownerThumb])).rows[0];
 if(creator?.job_id!==deps.jobId)throw Error("AGENT_PROGRESS_CREATOR_MISMATCH");
 const current=await recoverAgentJob(deps.db,deps.jobId,deps.owner);
 if(!current)throw Error("AGENT_PROGRESS_JOB_NOT_FOUND");
 const rows=input.model_call_keys===undefined?
  (await listRecentAgentModelCalls(deps.db,deps.jobId,deps.owner))
   .map(row=>examine(current,row,row.call_key)):
  await Promise.all(input.model_call_keys.map(async key=>
   examine(current,await getModelCall(deps.db,deps.jobId,deps.owner,key),key)));
 // A successful test followed by failed INDEPENDENT Browser QA must not
 // be resumed as an ordinary tool result. The owner must explicitly approve
 // the separate, journaled QA-repair model call. Query only the immutable
 // owner-scoped QA receipt; no user-supplied verdict is trusted.
 let failedIndependentQa=false;
 let qaAttemptState:AgentProgress["qa_attempt_state"]="NOT_RUN";
 let qaObservedChecks:readonly SavedQaCheck[]=[];
 if(["TESTING","REPAIRING"].includes(current.job.job_state)){
  const receipts=(await deps.db.query<SavedBrowserQaAttempt>(
   "SELECT status,receipt_json FROM public.appf2_agent_browser_qa_attempt "+
   "WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid "+
   "AND project_hash=$3::text LIMIT 1",
   [deps.jobId,deps.owner,current.project.project_hash])).rows;
  if(receipts.length>1)throw Error("AGENT_QA_PROGRESS_AMBIGUOUS");
  const qaReceipt=receipts[0];
  qaAttemptState=savedBrowserQaAttemptState(qaReceipt);
  qaObservedChecks=savedQaObservedChecks(qaReceipt);
  if(current.job.job_state==="REPAIRING"){
   if(qaAttemptState==="IN_FLIGHT"||
    qaAttemptState==="BLOCKED_UNCERTAIN")
    throw Error("AGENT_QA_PROGRESS_UNCERTAIN");
   if(qaReceipt?.status==="SUCCEEDED"){
    const data=qaReceipt.receipt_json as Record<string,unknown>;
    if(qaAttemptState!=="RESULT_RECORDED"||
     data.ready_for_review!==false||data.packet!==null)
     throw Error("AGENT_QA_PROGRESS_RECEIPT_INVALID");
    failedIndependentQa=true;
   }
  }
 }
 const active=rows.filter(x=>x.state==="CURRENT_MODEL_READY");
 const uncertain=rows.some(x=>x.state==="MODEL_UNCERTAIN");
 const pending=rows.some(x=>x.state==="MODEL_PENDING");
 const qa=rows.some(x=>x.state==="INDEPENDENT_QA_REQUIRED")||
  // A successful run_test enters TESTING: only independent QA may admit it.
  (current.job.job_state==="TESTING"&&rows.some(x=>
   x.last_completed_tool&&x.tool==="run_test"));
 const last=rows.filter(x=>x.state==="ALREADY_APPLIED"&&x.last_completed_tool);
 const remaining=current.job.checkpoint.budget.max_steps-current.job.checkpoint.step;
 const eligible=!failedIndependentQa&&!uncertain&&!pending&&!qa&&
  active.length===0&&last.length===1&&
  remaining>0&&["CODING","REPAIRING","BUILDING"].includes(current.job.job_state);

 const can_resume=mayResumeSavedModel(rows.map(x=>x.state),
  remaining,qa,current.job.job_state);
 const next_action:AgentProgress["next_action"]=uncertain||pending?
  "AWAIT_MODEL_RECONCILIATION":active.length>1||last.length>1?
   "RECONCILE_AMBIGUOUS_HEAD":failedIndependentQa&&active.length===0?
   "OWNER_APPROVED_QA_REPAIR_REQUIRED":
   current.job.job_state==="TESTING"&&qaAttemptState==="RESULT_RECORDED"?
    "REVIEW_SAVED_QA_EVIDENCE":
   current.job.job_state==="TESTING"&&qaAttemptState!=="NOT_RUN"?
    "AWAIT_QA_RECONCILIATION":qa?
    "VERIFY_INDEPENDENT_QA":remaining===0&&(active.length===1||last.length===1)?
     "BUDGET_RENEWAL_REQUIRED":can_resume?
      "SIGN_NEXT_SEQUENCE":eligible?
       "CONTINUE_SAVED_TOOL_RESULT":"NO_PROVEN_PENDING_MODEL";
 return {status:"RECOVERY_INSPECTED",revision:current.job.revision,
  checkpoint_hash:current.job.checkpoint_hash,
  project_hash:current.project.project_hash,job_state:current.job.job_state,
  completed_steps:current.job.checkpoint.step,remaining_steps:remaining,
  calls:rows,can_resume,resume_model_call_key:can_resume?active[0].model_call_key:null,
  can_continue_saved_tool_result:eligible,
  resume_previous_model_call_key:eligible?last[0].model_call_key:null,
  next_action,scope:input.model_call_keys===undefined?
   "RECENT_EIGHT_STORED_CALLS":"SUBMITTED_KEYS_ONLY",
  qa_attempt_state:qaAttemptState,qa_observed_checks:qaObservedChecks,
  app_published:false};
}
