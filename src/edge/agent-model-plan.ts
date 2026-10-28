/**
 * Private opt-in first Responses planning call. It is intentionally NOT a
 * public app compiler: it persists one model response and no model source is
 * executed or published. The model API key is server-only.
 */
import {recoverAgentJob,advanceDurableAgentJob}
 from "../platform/agent/durable-agent-service.js";
import {runJournaledPaidModelTurn,type PaidModelTurnDeps}
 from "../platform/agent/journaled-model-gateway.js";
import {sha256CodeBytes} from "../platform/blueprint/code-artifact-v2.js";
import type {AgentJobExecutor} from "../platform/agent/postgres-agent-jobs.js";
export type ModelPlanInput={
 readonly anonymous_id:string;readonly prompt:string;
 readonly model_call_key:string;readonly max_charge_cents:number;
 readonly max_output_tokens:number;readonly explicit_ai_consent:true;
};
export type ModelPlanDeps={
 readonly db:AgentJobExecutor;readonly jobId:string;readonly owner:string;
 readonly ownerThumb:string;readonly apiKey:string;
 readonly send?:PaidModelTurnDeps["send"];
};
const HASH=/^sha256:[a-f0-9]{64}$/u;
const CALL=/^[A-Za-z0-9_-]{8,80}$/u;
export function validModelPlanBody(input:unknown):input is ModelPlanInput{
 if(typeof input!=="object"||input===null||Array.isArray(input))return false;
 const x=input as Record<string,unknown>;
 if(Object.keys(x).sort().join(",")!=="anonymous_id,explicit_ai_consent,max_charge_cents,max_output_tokens,model_call_key,prompt")
  return false;
 return typeof x.anonymous_id==="string"&&typeof x.prompt==="string"&&
   x.prompt.trim().length>=5&&x.prompt.length<=800&&
   typeof x.model_call_key==="string"&&CALL.test(x.model_call_key)&&
   x.explicit_ai_consent===true&&Number.isSafeInteger(x.max_charge_cents)&&
   Number(x.max_charge_cents)>=1&&Number(x.max_charge_cents)<=100&&
   Number.isSafeInteger(x.max_output_tokens)&&
   Number(x.max_output_tokens)>=512&&Number(x.max_output_tokens)<=4096;
}
async function promptDigest(prompt:string):Promise<string>{
 return sha256CodeBytes(new TextEncoder().encode("APPF2_AGENT_REQUEST_V1\u0000"+prompt.trim()));
}
async function verifyCreator(db:AgentJobExecutor,id:string,owner:string,
 thumb:string):Promise<boolean>{
 const matches=await db.query<{job_id:string}>(`SELECT job_id::text
  FROM public.appf2_agent_job WHERE job_id=$1::uuid
  AND owner_anonymous_id=$2::uuid AND owner_key_thumbprint=$3::text LIMIT 1`,
 [id,owner,thumb]);
 return matches.rows[0]?.job_id===id;
}
/** No provider dispatch unless all identity, source, budget and stage checks pass. */
export async function executeFirstAgentModelPlan(input:ModelPlanInput,
 deps:ModelPlanDeps):Promise<{response_id:string;source:"PROVIDER"|"DURABLE_REPLAY";
 status:"MODEL_RESPONSE_SAVED";project_hash:string}>{
 if(!validModelPlanBody(input)||input.anonymous_id!==deps.owner||
   deps.apiKey.length<16||!HASH.test(await promptDigest(input.prompt))||
   !(await verifyCreator(deps.db,deps.jobId,deps.owner,deps.ownerThumb)))
  throw Error("AGENT_MODEL_NOT_AUTHORIZED");
 let current=await recoverAgentJob(deps.db,deps.jobId,deps.owner);
 if(!current||current.job.request_hash!==await promptDigest(input.prompt)||
   current.job.checkpoint.budget.max_cost_cents<input.max_charge_cents||
   current.job.checkpoint.budget.max_steps<2)
  throw Error("AGENT_MODEL_JOB_OR_BUDGET_INVALID");
 if(current.job.job_state==="CREATED"){
  const next={...current.job.checkpoint,state:"PLANNING" as const,
   step:current.job.checkpoint.step+1,
   previous_checkpoint_id:current.job.checkpoint_hash};
  current=await advanceDurableAgentJob(deps.db,current.job,deps.owner,next);
 }
 if(current.job.job_state!=="PLANNING"||current.job.checkpoint.step!==1)
  throw Error("AGENT_MODEL_NOT_IN_PLANNING");
 const result=await runJournaledPaidModelTurn({
  owner:deps.owner,job:current.job,call_key:input.model_call_key,
  input:input.prompt.trim(),previous_response_id:null,
  max_output_tokens:input.max_output_tokens,
  max_charge_cents:input.max_charge_cents,paid_consent:true,
  api_key:deps.apiKey
 },{db:deps.db,send:deps.send});
 const r=result.response as {id:string};
 return {response_id:r.id,source:result.source,status:"MODEL_RESPONSE_SAVED",
  project_hash:current.project.project_hash};
}
