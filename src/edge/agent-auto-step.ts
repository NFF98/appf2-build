/**
 * Signed, resumable one-tool agent controller. At most one already-journaled
 * tool result and one separately consented next model call per HTTP request.
 * No publication authority or cloud entitlement is granted by this endpoint.
 */
import {recoverAgentJob} from "../platform/agent/durable-agent-service.js";
import {getModelCall} from "../platform/agent/postgres-model-calls.js";
import {parseAgentResponsesBatch} from "../platform/agent/responses-api.js";
import {applyStoredModelEdit} from "./agent-model-apply.js";
import {executeSignedSandboxTool,type SandboxRunDeps} from "./agent-sandbox-run.js";
import {executeAgentModelContinuation} from "./agent-model-continue.js";
import type {PaidModelTurnDeps} from "../platform/agent/journaled-model-gateway.js";
import type {AgentJobExecutor} from "../platform/agent/postgres-agent-jobs.js";

type Base={readonly anonymous_id:string;readonly model_call_key:string;
 readonly expected_revision:number};
type Ai={readonly explicit_ai_consent:true;readonly next_model_call_key:string;
 readonly max_ai_charge_cents:number;readonly max_output_tokens:number};
type Container={readonly explicit_container_consent:true;
 readonly max_container_charge_cents:number};
export type AutoStepInput=Base&Partial<Ai>&Partial<Container>;
export type AutoStepDeps={
 readonly db:AgentJobExecutor;readonly jobId:string;readonly owner:string;
 readonly ownerThumb:string;readonly modelEnabled:boolean;readonly apiKey:string;
 readonly brokerEnabled:boolean;readonly brokerUrl:string;readonly brokerToken:string;
 readonly brokerService?:SandboxRunDeps["brokerService"];
 readonly allowedJobId:string;readonly sendModel?:PaidModelTurnDeps["send"];
 readonly sendSandbox?:SandboxRunDeps["send"];
};
const KEY=/^[A-Za-z0-9_-]{8,80}$/u;
const BASIC=["anonymous_id","model_call_key","expected_revision"];
const AI=["explicit_ai_consent","next_model_call_key","max_ai_charge_cents","max_output_tokens"];
const CONTAINER=["explicit_container_consent","max_container_charge_cents"];
function exact(raw:Record<string,unknown>,fields:readonly string[]):boolean{
 return Object.keys(raw).sort().join(",")===fields.slice().sort().join(",");
}
// eslint-disable-next-line complexity -- Fail closed for both independently approved paid capabilities.
export function validAutoStepBody(raw:unknown):raw is AutoStepInput{
 if(typeof raw!=="object"||raw===null||Array.isArray(raw))return false;
 const x=raw as Record<string,unknown>;
 const ai=AI.some(f=>f in x),container=CONTAINER.some(f=>f in x);
 if(!exact(x,[...BASIC,...(ai?AI:[]),...(container?CONTAINER:[])]))return false;
 if(typeof x.anonymous_id!=="string"||typeof x.model_call_key!=="string"||
  !KEY.test(x.model_call_key)||!Number.isSafeInteger(x.expected_revision)||
  Number(x.expected_revision)<1)return false;
 if(ai&&(x.explicit_ai_consent!==true||
  typeof x.next_model_call_key!=="string"||!KEY.test(x.next_model_call_key)||
  x.next_model_call_key===x.model_call_key||
  !Number.isSafeInteger(x.max_ai_charge_cents)||
  Number(x.max_ai_charge_cents)<1||Number(x.max_ai_charge_cents)>100||
  !Number.isSafeInteger(x.max_output_tokens)||
  Number(x.max_output_tokens)<512||Number(x.max_output_tokens)>4096))return false;
 return !container||(x.explicit_container_consent===true&&
  Number.isSafeInteger(x.max_container_charge_cents)&&
  Number(x.max_container_charge_cents)>=1&&Number(x.max_container_charge_cents)<=100);
}
type Result={readonly status:"STEP_APPLIED"|"AWAITING_CONTAINER_CONSENT"|
 "MODEL_RESPONSE_SAVED"|"INDEPENDENT_QA_REQUIRED";readonly action:string;
 readonly revision:number;readonly project_hash:string;readonly job_state:string;
 readonly app_published:false;
 readonly model_response_id?:string;readonly model_source?:"PROVIDER"|"DURABLE_REPLAY"};
function result(status:Result["status"],action:string,revision:number,
 project_hash:string,job_state:string):Result{
 return {status,action,revision,project_hash,job_state,app_published:false};
}
/** Every request is P-256 owner-bound before looking up model/source journal. */
// eslint-disable-next-line complexity -- Source, consent, independent model/runner gates.
export async function runSignedAgentStep(input:AutoStepInput,deps:AutoStepDeps):Promise<Result>{
 if(!validAutoStepBody(input)||input.anonymous_id!==deps.owner)
  throw Error("AGENT_STEP_NOT_AUTHORIZED");
 const verified=await deps.db.query<{job_id:string}>(
  "SELECT job_id::text\n  FROM public.appf2_agent_job WHERE job_id=$1::uuid "+
  "AND owner_anonymous_id=$2::uuid AND owner_key_thumbprint=$3::text LIMIT 1",
  [deps.jobId,deps.owner,deps.ownerThumb]);
 if(verified.rows[0]?.job_id!==deps.jobId)
  throw Error("AGENT_STEP_CREATOR_MISMATCH");
 const current=await recoverAgentJob(deps.db,deps.jobId,deps.owner);
 if(!current||current.job.revision!==input.expected_revision)
  throw Error("AGENT_STEP_STALE");
 const prev=await getModelCall(deps.db,deps.jobId,deps.owner,input.model_call_key);
 const sameHead=prev?.job_revision===current.job.revision&&
  prev.checkpoint_hash===current.job.checkpoint_hash;
 const signedBudgetHead=prev?.job_revision===current.job.revision-1&&
  prev.checkpoint_hash===current.job.checkpoint.previous_checkpoint_id;
 if(!prev||prev.status!=="SUCCEEDED"||prev.response_json===null||
  (!sameHead&&!signedBudgetHead))
  throw Error("AGENT_STEP_PREVIOUS_MODEL_UNPROVEN");
 const batch=parseAgentResponsesBatch(prev.response_json,current.project.project_hash);
 if(!batch||batch.response_id!==prev.response_id||batch.calls.length>1)
  throw Error("AGENT_STEP_BAD_MODEL_RESPONSE");
 if(batch.calls.length===0)return result("INDEPENDENT_QA_REQUIRED",
  "VERIFY_ORIGINAL_REQUIREMENTS",current.job.revision,
  current.project.project_hash,current.job.job_state);
 const call=batch.calls[0];
 if(current.job.checkpoint.completed_call_ids.includes(call.call_id))
  throw Error("AGENT_STEP_PREVIOUS_TOOL_ALREADY_APPLIED");
 const sandbox=call.name==="run_build"||call.name==="run_test";
 if(!sandbox&&!["write_file","write_files","delete_file","read_file"].includes(call.name))
  throw Error("AGENT_STEP_TOOL_UNSUPPORTED");
 if(sandbox&&input.explicit_container_consent!==true)
  return result("AWAITING_CONTAINER_CONSENT","SIGNED_CONTAINER_APPROVAL_REQUIRED",
   current.job.revision,current.project.project_hash,current.job.job_state);
 if(sandbox&&!deps.brokerEnabled)throw Error("AGENT_STEP_SANDBOX_OFF");
 if(input.explicit_ai_consent===true&&(!deps.modelEnabled||deps.apiKey.length<16))
  throw Error("AGENT_STEP_MODEL_OFF");
 const done=sandbox?
  await executeSignedSandboxTool({
   anonymous_id:input.anonymous_id,model_call_key:input.model_call_key,
   expected_revision:input.expected_revision,explicit_container_consent:true,
   max_charge_cents:input.max_container_charge_cents!
  },{db:deps.db,jobId:deps.jobId,owner:deps.owner,ownerThumb:deps.ownerThumb,
   brokerUrl:deps.brokerUrl,brokerToken:deps.brokerToken,
   brokerService:deps.brokerService,
   allowedJobId:deps.allowedJobId,send:deps.sendSandbox}):
  await applyStoredModelEdit({
   anonymous_id:input.anonymous_id,model_call_key:input.model_call_key,
   expected_revision:input.expected_revision
  },{db:deps.db,jobId:deps.jobId,owner:deps.owner,ownerThumb:deps.ownerThumb});
 if(done.status==="ALREADY_APPLIED")throw Error("AGENT_STEP_ALREADY_APPLIED");
 const jobState=sandbox&&"job_state" in done?done.job_state:"CODING";
 const qaPending=sandbox&&call.name==="run_test"&&
  "exit_code" in done&&done.exit_code===0;
 if(qaPending||input.explicit_ai_consent!==true)
  return result(qaPending?"INDEPENDENT_QA_REQUIRED":"STEP_APPLIED",
   qaPending?"VERIFY_ORIGINAL_REQUIREMENTS":"NEXT_MODEL_NEEDS_SIGNED_CONSENT",
   done.revision,done.project_hash,jobState);
 const next=await executeAgentModelContinuation({
  anonymous_id:input.anonymous_id,previous_model_call_key:input.model_call_key,
  model_call_key:input.next_model_call_key!,expected_revision:done.revision,
  max_charge_cents:input.max_ai_charge_cents!,max_output_tokens:input.max_output_tokens!,
  explicit_ai_consent:true
 },{db:deps.db,jobId:deps.jobId,owner:deps.owner,ownerThumb:deps.ownerThumb,
  apiKey:deps.apiKey,send:deps.sendModel});
 return {...result("MODEL_RESPONSE_SAVED","PROCESS_SAVED_MODEL",next.revision,
  next.project_hash,jobState),model_response_id:next.response_id,model_source:next.source};
}
