/** Fresh owner-signed, opt-in cost/step authorization. No AI or Sandbox call. */
import {recoverAgentJob} from "../platform/agent/durable-agent-service.js";
import {extendApprovedAgentBudget} from "../platform/agent/postgres-agent-jobs.js";
import type {AgentJobExecutor} from "../platform/agent/postgres-agent-jobs.js";
export type ExtendBudgetInput={
 readonly anonymous_id:string;readonly expected_revision:number;
 readonly new_max_steps:number;readonly new_max_cost_cents:number;
 readonly explicit_budget_consent:true;
};
export type ExtendBudgetDeps={
 readonly db:AgentJobExecutor;readonly jobId:string;readonly owner:string;
 readonly ownerThumb:string;
};
export function validExtendBudgetBody(value:unknown):value is ExtendBudgetInput{
 if(typeof value!=="object"||value===null||Array.isArray(value))return false;
 const x=value as Record<string,unknown>;
 return Object.keys(x).sort().join(",")===
   "anonymous_id,expected_revision,explicit_budget_consent,new_max_cost_cents,new_max_steps"&&
  typeof x.anonymous_id==="string"&&
  Number.isSafeInteger(x.expected_revision)&&Number(x.expected_revision)>=0&&
  Number.isSafeInteger(x.new_max_steps)&&Number(x.new_max_steps)>=9&&
  Number(x.new_max_steps)<=512&&Number.isSafeInteger(x.new_max_cost_cents)&&
  Number(x.new_max_cost_cents)>=0&&Number(x.new_max_cost_cents)<=100&&
  x.explicit_budget_consent===true;
}
export async function extendSignedAgentBudget(input:ExtendBudgetInput,deps:ExtendBudgetDeps){
 if(!validExtendBudgetBody(input)||input.anonymous_id!==deps.owner)
  throw Error("AGENT_BUDGET_NOT_AUTHORIZED");
 const creator=(await deps.db.query<{job_id:string}>(`SELECT job_id::text
  FROM public.appf2_agent_job WHERE job_id=$1::uuid
  AND owner_anonymous_id=$2::uuid AND owner_key_thumbprint=$3::text LIMIT 1`,
  [deps.jobId,deps.owner,deps.ownerThumb])).rows[0];
 if(creator?.job_id!==deps.jobId)throw Error("AGENT_BUDGET_CREATOR_MISMATCH");
 const current=await recoverAgentJob(deps.db,deps.jobId,deps.owner);
 if(!current||current.job.revision!==input.expected_revision)
  throw Error("AGENT_BUDGET_REVISION_STALE");
 const saved=await extendApprovedAgentBudget(deps.db,current.job,deps.owner,
  input.new_max_steps,input.new_max_cost_cents);
 return {status:"BUDGET_EXTENDED" as const,revision:saved.revision,
  project_hash:saved.project_hash,job_state:saved.job_state,
  budget:saved.checkpoint.budget,step:saved.checkpoint.step,
  app_published:false};
}
