/** Creator-authenticated read-only model status; never sends another paid call. */
import {getModelCall} from "../platform/agent/postgres-model-calls.js";
import type {AgentJobExecutor} from "../platform/agent/postgres-agent-jobs.js";
export type ModelStatusInput={
 readonly anonymous_id:string;readonly model_call_key:string;
};
const KEY=/^[A-Za-z0-9_-]{8,80}$/u;
export function validModelStatusBody(x:unknown):x is ModelStatusInput{
 if(typeof x!=="object"||x===null||Array.isArray(x))return false;
 const data=x as Record<string,unknown>;
 return Object.keys(data).sort().join(",")==="anonymous_id,model_call_key"&&
  typeof data.anonymous_id==="string"&&
  typeof data.model_call_key==="string"&&KEY.test(data.model_call_key);
}
export async function readAgentModelCallStatus(input:ModelStatusInput,ctx:{
 readonly db:AgentJobExecutor;readonly jobId:string;
 readonly owner:string;readonly ownerThumb:string;
}):Promise<{status:string;response_id:string|null;
 input_tokens:number|null;output_tokens:number|null;
 needs_reconciliation:boolean}>{
 if(!validModelStatusBody(input)||input.anonymous_id!==ctx.owner)
  throw Error("MODEL_STATUS_INVALID");
 const creator=(await ctx.db.query<{job_id:string}>(`SELECT job_id::text
  FROM public.appf2_agent_job WHERE job_id=$1::uuid
  AND owner_anonymous_id=$2::uuid AND owner_key_thumbprint=$3::text LIMIT 1`,
  [ctx.jobId,ctx.owner,ctx.ownerThumb])).rows[0];
 if(creator?.job_id!==ctx.jobId)throw Error("MODEL_STATUS_CREATOR_MISMATCH");
 const call=await getModelCall(ctx.db,ctx.jobId,ctx.owner,input.model_call_key);
 if(!call)throw Error("MODEL_STATUS_NOT_FOUND");
 return {
  status:call.status,response_id:call.status==="SUCCEEDED"?call.response_id:null,
  input_tokens:call.status==="SUCCEEDED"?call.input_tokens:null,
  output_tokens:call.status==="SUCCEEDED"?call.output_tokens:null,
  needs_reconciliation:call.status==="IN_FLIGHT"||call.status==="BLOCKED_UNCERTAIN"
 };
}
