/**
 * Transactional paid-model journal. The owner identity MUST be bound by the
 * trusted Worker Postgres executor after creator PoP verification.
 * No model key/source is stored in this table. The complete response is
 * private, bounded, and never directly readable through public APIs.
 */
import {type AgentJobRow,type AgentJobExecutor} from "./postgres-agent-jobs.js";
const HASH=/^sha256:[a-f0-9]{64}$/u;
const KEY=/^[A-Za-z0-9_-]{8,80}$/u;
export type ModelCallStatus="RESERVED"|"IN_FLIGHT"|"SUCCEEDED"|"BLOCKED_UNCERTAIN"|"REJECTED_PRE_SEND";
export type ModelCallRow={
 readonly job_id:string;readonly owner_anonymous_id:string;
 readonly call_key:string;readonly job_revision:number;
 readonly checkpoint_hash:string;readonly request_hash:string;
 readonly model:string;readonly max_charge_cents:number;
 readonly status:ModelCallStatus;readonly response_json:unknown|null;
 readonly response_id:string|null;readonly input_tokens:number|null;
 readonly output_tokens:number|null;
};
export type ModelReservation={
 readonly call_key:string;readonly request_hash:string;
 readonly model:"gpt-6.1-sol";readonly max_charge_cents:number;
};
const GET=`SELECT job_id::text,owner_anonymous_id::text,call_key,job_revision,
 checkpoint_hash,request_hash,model,max_charge_cents,status,response_json,
 response_id,input_tokens,output_tokens
 FROM public.appf2_agent_model_call
 WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid AND call_key=$3::text LIMIT 1`;
const RESERVE=`SELECT appf2_internal.reserve_agent_model_call(
 $1::uuid,$2::text,$3::integer,$4::text,$5::text,$6::text,$7::integer) AS status`;
const CLAIM=`UPDATE public.appf2_agent_model_call SET status='IN_FLIGHT'
 WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid AND call_key=$3::text
 AND status='RESERVED' AND request_hash=$4::text
 AND checkpoint_hash=$5::text AND job_revision=$6::integer
 RETURNING call_key`;
const COMPLETE=`UPDATE public.appf2_agent_model_call
 SET status='SUCCEEDED',response_json=$4::jsonb,response_id=$5::text,
  input_tokens=$6::integer,output_tokens=$7::integer
 WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid AND call_key=$3::text
 AND status='IN_FLIGHT' RETURNING call_key`;
const UNCERTAIN=`UPDATE public.appf2_agent_model_call
 SET status='BLOCKED_UNCERTAIN'
 WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid AND call_key=$3::text
 AND status='IN_FLIGHT' RETURNING call_key`;
export function validReservation(input:ModelReservation):boolean{
 return KEY.test(input.call_key)&&HASH.test(input.request_hash)&&
  input.model==="gpt-6.1-sol"&&
  Number.isSafeInteger(input.max_charge_cents)&&input.max_charge_cents>0&&
  input.max_charge_cents<=1000000;
}
export async function getModelCall(db:AgentJobExecutor,jobId:string,owner:string,
 callKey:string):Promise<ModelCallRow|null>{
 if(!KEY.test(callKey))throw Error("MODEL_CALL_KEY_INVALID");
 const r=(await db.query<ModelCallRow>(GET,[jobId,owner,callKey])).rows[0];
 if(!r)return null;
 if(r.job_id!==jobId||r.owner_anonymous_id!==owner||
  r.call_key!==callKey)throw Error("MODEL_CALL_OWNER_MISMATCH");
 return r;
}
function matchRequest(row:ModelCallRow,job:AgentJobRow,input:ModelReservation):void{
 if(row.request_hash!==input.request_hash||row.model!==input.model||
  row.job_revision!==job.revision||
  row.checkpoint_hash!==job.checkpoint_hash||
  row.max_charge_cents!==input.max_charge_cents)
  throw Error("MODEL_CALL_REPLAY_MISMATCH");
}
export async function reserveModelCall(db:AgentJobExecutor,job:AgentJobRow,
 owner:string,input:ModelReservation):Promise<ModelCallRow>{
 if(!validReservation(input)||job.owner_anonymous_id!==owner||
  job.checkpoint.budget.max_cost_cents<=0)
  throw Error("MODEL_CALL_NO_APPROVED_BUDGET");
 const prior=await getModelCall(db,job.job_id,owner,input.call_key);
 if(prior){matchRequest(prior,job,input);return prior;}
 const response=(await db.query<{status:string}>(RESERVE,[job.job_id,input.call_key,
  job.revision,job.checkpoint_hash,input.request_hash,input.model,
  input.max_charge_cents])).rows[0];
 if(response?.status!=="RESERVED")throw Error("MODEL_CALL_RESERVATION_REJECTED");
 const row=await getModelCall(db,job.job_id,owner,input.call_key);
 if(!row)throw Error("MODEL_CALL_RESERVATION_NOT_DURABLE");
 matchRequest(row,job,input);
 return row;
}
/** Committing IN_FLIGHT BEFORE HTTP is essential: no automatic retry on crash. */
export async function claimModelCall(db:AgentJobExecutor,row:ModelCallRow):Promise<void>{
 if(row.status!=="RESERVED")throw Error("MODEL_CALL_ALREADY_CLAIMED");
 const r=await db.query<{call_key:string}>(CLAIM,[row.job_id,row.owner_anonymous_id,
  row.call_key,row.request_hash,row.checkpoint_hash,row.job_revision]);
 if(r.rows.length!==1)throw Error("MODEL_CALL_CLAIM_CONFLICT");
}
export async function completeModelCall(db:AgentJobExecutor,row:ModelCallRow,
 response:unknown,id:string,inputTokens:number,outputTokens:number):Promise<void>{
 if(row.status!=="RESERVED"||!/^resp_[A-Za-z0-9_-]{6,160}$/u.test(id)||
  !Number.isSafeInteger(inputTokens)||inputTokens<0||
  !Number.isSafeInteger(outputTokens)||outputTokens<0)
  throw Error("MODEL_CALL_COMPLETION_INVALID");
 const encoded=JSON.stringify(response);
 if(encoded===undefined||new TextEncoder().encode(encoded).length>450000)
  throw Error("MODEL_CALL_RESPONSE_TOO_LARGE");
 const r=await db.query<{call_key:string}>(COMPLETE,[row.job_id,
  row.owner_anonymous_id,row.call_key,encoded,id,inputTokens,outputTokens]);
 if(r.rows.length!==1)throw Error("MODEL_CALL_COMPLETION_NOT_DURABLE");
}
export async function markModelCallUncertain(db:AgentJobExecutor,row:ModelCallRow):Promise<void>{
 const r=await db.query<{call_key:string}>(UNCERTAIN,[row.job_id,
  row.owner_anonymous_id,row.call_key]);
 if(r.rows.length!==1)throw Error("MODEL_CALL_UNCERTAIN_NOT_DURABLE");
}
