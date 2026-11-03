/** 
 * At-most-once paid Responses dispatch with durable DB fencing.
 * No public route invokes this. User cost consent is required per call.
 * An unknown provider result is NOT retried, even after a Worker crash.
 */
import {makeAgentResponsesRequest,sendAgentResponse,type FunctionOutput}
 from "./responses-api.js";
import {sha256CodeBytes} from "../blueprint/code-artifact-v2.js";
import {type AgentJobExecutor,type AgentJobRow} from "./postgres-agent-jobs.js";
import {getModelCall,reserveModelCall,claimModelCall,completeModelCall,
 markModelCallUncertain,type ModelReservation} from "./postgres-model-calls.js";
export type AgentModelRequest=ReturnType<typeof makeAgentResponsesRequest>;
export type PaidModelTurn={
 readonly owner:string;readonly job:AgentJobRow;
 readonly call_key:string;
 readonly input:string|readonly FunctionOutput[];
 readonly previous_response_id:string|null;
 readonly max_output_tokens:number;
 readonly max_charge_cents:number;
 readonly paid_consent:boolean;
 readonly api_key:string;
};
export interface PaidModelTurnDeps{
 readonly db:AgentJobExecutor;
 readonly send?:(input:{api_key:string;request:AgentModelRequest})=>Promise<unknown>;
}
export type PaidModelResult={
 readonly response:unknown;
 readonly source:"PROVIDER"|"DURABLE_REPLAY";
 readonly request_hash:string;
};
type ValidResponse={id:string;status:"completed";usage:{
 input_tokens:number;output_tokens:number}};
function validResponse(input:unknown):input is ValidResponse{
 if(typeof input!=="object"||input===null)return false;
 const data=input as Record<string,unknown>,u=data.usage;
 const usage=typeof u==="object"&&u!==null?u as Record<string,unknown>:null;
 return typeof data.id==="string"&&/^resp_[A-Za-z0-9_-]{6,160}$/u.test(data.id)&&
  data.status==="completed"&&usage!==null&&
  Number.isSafeInteger(usage.input_tokens)&&
  Number(usage.input_tokens)>=0&&
  Number.isSafeInteger(usage.output_tokens)&&Number(usage.output_tokens)>=0;
}
/** No implicit provider retries, fallback, sampling upgrade or plan change. */
// eslint-disable-next-line complexity -- Cost, consent, recovery, and dispatch gates are explicit.
export async function runJournaledPaidModelTurn(input:PaidModelTurn,
 deps:PaidModelTurnDeps):Promise<PaidModelResult>{
 if(!input.paid_consent||input.max_charge_cents<1||
  !Number.isSafeInteger(input.max_charge_cents)||
  input.job.owner_anonymous_id!==input.owner||
  input.job.checkpoint.budget.max_cost_cents===0||
  input.job.job_state==="READY"||input.job.job_state==="FAILED"||
  input.job.job_state==="AWAITING_CONSENT")
  throw Error("PAID_AGENT_NOT_AUTHORIZED");
 const request=makeAgentResponsesRequest({
  model:"gpt-6.1-sol",input:input.input,
  previous_response_id:input.previous_response_id,
  max_output_tokens:input.max_output_tokens,consent:input.paid_consent
 });
 const request_hash=await sha256CodeBytes(new TextEncoder().encode(
  "APPF2_PAID_MODEL_REQUEST_V1\u0000"+JSON.stringify(request)));
 const reservation:ModelReservation={call_key:input.call_key,
  request_hash,model:"gpt-6.1-sol",max_charge_cents:input.max_charge_cents};
 // An existing SUCCEEDED journal is the only safe result replay.
 const existing=await getModelCall(deps.db,input.job.job_id,input.owner,input.call_key);
 if(existing&&existing.status!=="RESERVED"&&existing.status!=="SUCCEEDED")
  throw Error("PAID_AGENT_OUTCOME_UNCERTAIN_NO_RETRY");
 const row=await reserveModelCall(deps.db,input.job,input.owner,reservation);
 if(row.status==="SUCCEEDED"){
  if(row.response_json===null)throw Error("PAID_AGENT_SAVED_RESPONSE_MISSING");
  return {response:row.response_json,source:"DURABLE_REPLAY",request_hash};
 }
 if(row.status!=="RESERVED")throw Error("PAID_AGENT_OUTCOME_UNCERTAIN_NO_RETRY");
 // An atomic DB transition BEFORE fetch fences all concurrent Worker attempts.
 await claimModelCall(deps.db,row);
 let response:unknown;
 try{
  response=await (deps.send??sendAgentResponse)({api_key:input.api_key,request});
  if(!validResponse(response))throw Error("PAID_AGENT_RESPONSE_NOT_PROVEN");
  await completeModelCall(deps.db,row,response,response.id,
   response.usage.input_tokens,response.usage.output_tokens);
 }catch{
  // Connection timeout might have incurred a real charge. Never re-dispatch.
  await markModelCallUncertain(deps.db,row).catch(()=>undefined);
  throw Error("PAID_AGENT_OUTCOME_UNCERTAIN_NO_RETRY");
 }
 return {response,source:"PROVIDER",request_hash};
}
