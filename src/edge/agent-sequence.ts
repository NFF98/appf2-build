/**
 * Owner-signed bounded autonomous Coding Agent sequence.
 * A SINGLE P-256 signature names EVERY step's prior model call, next model
 * idempotency key, charge caps and consent. No implicit approval is inherited.
 *
 * A failed/pending/uncertain step stops the sequence. After partial commit,
 * callers must recover the durable job and submit a NEW signed sequence from
 * its actual revision; replay never re-dispatches a cloud operation.
 */
import {runSignedAgentStep,validAutoStepBody,
 type AutoStepInput,type AutoStepDeps} from "./agent-auto-step.js";
export type AgentSequenceInput={readonly anonymous_id:string;
 readonly steps:readonly AutoStepInput[]};
export type AgentSequenceResult={
 readonly status:"SEQUENCE_STOPPED"|"SEQUENCE_LIMIT_REACHED";
 readonly completed_steps:number;readonly revision:number;
 readonly project_hash:string;readonly job_state:string;readonly next_action:string;
 readonly app_published:false;
 readonly results:readonly Awaited<ReturnType<typeof runSignedAgentStep>>[];
};
const MAX_SEQUENCE_STEPS=3;
/** Require every future AI step to be backed by an explicitly authorized
 * predecessor response, not by a guessed job revision or arbitrary call ID.
 */
// eslint-disable-next-line complexity -- Complete bounded authorization graph and cumulative limits.
export function validAgentSequenceBody(raw:unknown):raw is AgentSequenceInput{
 if(typeof raw!=="object"||raw===null||Array.isArray(raw))return false;
 const x=raw as Record<string,unknown>;
 if(Object.keys(x).sort().join(",")!=="anonymous_id,steps"||
  typeof x.anonymous_id!=="string"||!Array.isArray(x.steps)||
  x.steps.length<1||x.steps.length>MAX_SEQUENCE_STEPS)return false;
 const seen=new Set<string>();
 let cents=0;
 for(let i=0;i<x.steps.length;i++){
  const step=x.steps[i];
  if(!validAutoStepBody(step)||step.anonymous_id!==x.anonymous_id||
   seen.has(step.model_call_key))return false;
  seen.add(step.model_call_key);
  cents+=(step.max_ai_charge_cents??0)+(step.max_container_charge_cents??0);
  if(cents>100)return false;
  if(i>0){
   const prior=x.steps[i-1] as AutoStepInput;
   if(prior.explicit_ai_consent!==true||
    prior.next_model_call_key!==step.model_call_key||
    prior.expected_revision+1!==step.expected_revision)return false;
  }
 }
 return true;
}
/** One bounded request may move through edit -> build -> repair; no publication.
 * Each leg uses the existing durable model and Sandbox journals.
 */
export async function runSignedAgentSequence(input:AgentSequenceInput,
 deps:AutoStepDeps):Promise<AgentSequenceResult>{
 if(!validAgentSequenceBody(input)||input.anonymous_id!==deps.owner)
  throw Error("AGENT_SEQUENCE_NOT_AUTHORIZED");
 const results:Awaited<ReturnType<typeof runSignedAgentStep>>[]=[];
 for(const step of input.steps){
  const next=await runSignedAgentStep(step,deps);
  results.push(next);
  if(next.status!=="MODEL_RESPONSE_SAVED"&&
   results.length<input.steps.length)break;
 }
 const last=results.at(-1);
 if(!last)throw Error("AGENT_SEQUENCE_EMPTY");
 return {status:results.length===input.steps.length?
   "SEQUENCE_LIMIT_REACHED":"SEQUENCE_STOPPED",
  completed_steps:results.length,revision:last.revision,
  project_hash:last.project_hash,job_state:last.job_state,
  next_action:last.action,app_published:false,results};
}
