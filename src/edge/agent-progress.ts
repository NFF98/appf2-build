/**
 * Owner-signed recovery inspection for a bounded list of model-call keys.
 * Read-only: NO model/container dispatch, raw code, logs or release admission.
 * After an interrupted batch, clients can sign a new step at the saved CAS head.
 */
import {recoverAgentJob,type RecoveredAgentJob}
 from "../platform/agent/durable-agent-service.js";
import {getModelCall,type ModelCallRow} from "../platform/agent/postgres-model-calls.js";
import {parseAgentResponsesBatch} from "../platform/agent/responses-api.js";
import type {AgentJobExecutor} from "../platform/agent/postgres-agent-jobs.js";

export type AgentProgressInput={readonly anonymous_id:string;
 readonly model_call_keys:readonly string[]};
type ProgressState="CURRENT_MODEL_READY"|"INDEPENDENT_QA_REQUIRED"|
 "ALREADY_APPLIED"|"MODEL_UNCERTAIN"|"MODEL_PENDING"|"STALE_MODEL"|
 "MODEL_MISSING"|"INVALID_MODEL_RESPONSE";
type CallProgress={readonly model_call_key:string;readonly state:ProgressState;
 readonly job_revision:number|null;readonly tool:string|null;
 readonly requires_container_consent:boolean;readonly response_id:string|null};
export type AgentProgress={
 readonly status:"RECOVERY_INSPECTED";readonly revision:number;
 readonly checkpoint_hash:string;readonly project_hash:string;
 readonly job_state:string;readonly completed_steps:number;
 readonly remaining_steps:number;readonly calls:readonly CallProgress[];
 readonly can_resume:boolean;readonly resume_model_call_key:string|null;
 readonly next_action:"SIGN_NEXT_SEQUENCE"|"AWAIT_MODEL_RECONCILIATION"|
  "VERIFY_INDEPENDENT_QA"|"NO_PROVEN_PENDING_MODEL"|
  "RECONCILE_AMBIGUOUS_HEAD";
 readonly scope:"SUBMITTED_KEYS_ONLY";readonly app_published:false;
};
const KEY=/^[A-Za-z0-9_-]{8,80}$/u;
export function validAgentProgressBody(raw:unknown):raw is AgentProgressInput{
 if(typeof raw!=="object"||raw===null||Array.isArray(raw))return false;
 const x=raw as Record<string,unknown>;
 return Object.keys(x).sort().join(",")==="anonymous_id,model_call_keys"&&
  typeof x.anonymous_id==="string"&&Array.isArray(x.model_call_keys)&&
  x.model_call_keys.length>=1&&x.model_call_keys.length<=8&&
  x.model_call_keys.every(v=>typeof v==="string"&&KEY.test(v))&&
  new Set(x.model_call_keys).size===x.model_call_keys.length;
}
function state(key:string,kind:ProgressState,rev:number|null=null,
 tool:string|null=null,responseId:string|null=null):CallProgress{
 return {model_call_key:key,state:kind,job_revision:rev,tool,
  requires_container_consent:tool==="run_build"||tool==="run_test",
  response_id:responseId};
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
 const parsed=parseAgentResponsesBatch(row.response_json,current.project.project_hash);
 if(!parsed||parsed.response_id!==row.response_id||parsed.calls.length>1)
  return state(key,"INVALID_MODEL_RESPONSE",row.job_revision);
 const tool=parsed.calls[0]?.name??null;
 const callId=parsed.calls[0]?.call_id;
 if(atHead){
  if(callId===undefined)
   return state(key,"INDEPENDENT_QA_REQUIRED",row.job_revision,null,row.response_id);
  if(!["read_file","write_file","write_files","delete_file",
   "run_build","run_test"].includes(tool??""))
   return state(key,"INVALID_MODEL_RESPONSE",row.job_revision);
  return state(key,"CURRENT_MODEL_READY",row.job_revision,tool,row.response_id);
 }
 if(row.job_revision<job.revision&&callId!==undefined&&
  job.checkpoint.completed_call_ids.includes(callId))
  return state(key,"ALREADY_APPLIED",row.job_revision,tool,row.response_id);
 return state(key,"STALE_MODEL",row.job_revision);
}
/** Independent PoP creator verification, even when the caller knows a job UUID. */
// eslint-disable-next-line complexity -- Distinguish charged-uncertain, QA, stale and fresh states.
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
 const rows=await Promise.all(input.model_call_keys.map(async key=>
  examine(current,await getModelCall(deps.db,deps.jobId,deps.owner,key),key)));
 const active=rows.filter(x=>x.state==="CURRENT_MODEL_READY");
 const uncertain=rows.some(x=>x.state==="MODEL_UNCERTAIN");
 const qa=rows.some(x=>x.state==="INDEPENDENT_QA_REQUIRED");
 const remaining=current.job.checkpoint.budget.max_steps-current.job.checkpoint.step;
 const can_resume=!uncertain&&!qa&&active.length===1&&remaining>0&&
  !["READY","FAILED","AWAITING_CONSENT"].includes(current.job.job_state);
 const next_action:AgentProgress["next_action"]=uncertain?
  "AWAIT_MODEL_RECONCILIATION":active.length>1?
   "RECONCILE_AMBIGUOUS_HEAD":qa?
    "VERIFY_INDEPENDENT_QA":can_resume?
     "SIGN_NEXT_SEQUENCE":"NO_PROVEN_PENDING_MODEL";
 return {status:"RECOVERY_INSPECTED",revision:current.job.revision,
  checkpoint_hash:current.job.checkpoint_hash,
  project_hash:current.project.project_hash,job_state:current.job.job_state,
  completed_steps:current.job.checkpoint.step,remaining_steps:remaining,
  calls:rows,can_resume,resume_model_call_key:can_resume?active[0].model_call_key:null,
  next_action,scope:"SUBMITTED_KEYS_ONLY",app_published:false};
}
