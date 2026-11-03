/**
 * Signed private Sandbox run_build/run_test: PostgreSQL CAS before any remote
 * execution, persisted broker evidence before advancing the project checkpoint.
 * A network timeout is ambiguous and NEVER automatically triggers another run.
 */
import {parseAgentResponsesBatch} from "../platform/agent/responses-api.js";
import {sandboxJobAllowed} from "../platform/agent/private-sandbox-authorization.js";
import {executeAgentTurn} from "../platform/agent/agent-turn.js";
import {recoverAgentJob,advanceDurableAgentJob}
 from "../platform/agent/durable-agent-service.js";
import {getModelCall} from "../platform/agent/postgres-model-calls.js";
import {sha256CodeBytes} from "../platform/blueprint/code-artifact-v2.js";
import type {AgentJobExecutor} from "../platform/agent/postgres-agent-jobs.js";
import type {AgentToolCall} from "../platform/agent/agent-contract.js";
import type {SandboxEvidence} from "../platform/agent/sandbox-adapter.js";
import type {ProjectSnapshot} from "../platform/agent/project-workspace.js";

export type SandboxRunInput={
 readonly anonymous_id:string;readonly model_call_key:string;
 readonly expected_revision:number;readonly explicit_container_consent:true;
 readonly max_charge_cents:number;
};
/** Private Worker-to-Worker service binding. No public workers.dev URL needed. */
export type SandboxServiceBinding={fetch:(request:Request)=>Promise<Response>};
export type SandboxRunDeps={
 readonly db:AgentJobExecutor;readonly jobId:string;readonly owner:string;
 readonly ownerThumb:string;readonly brokerUrl:string;
 readonly brokerService?:SandboxServiceBinding;
 readonly brokerToken:string;readonly allowedJobId:string;
 readonly send?:(task:{job_id:string;project:ProjectSnapshot;call:AgentToolCall},
  url:string,token:string)=>Promise<unknown>;
};
export type SandboxRunResult={
 readonly status:"SANDBOX_RESULT_SAVED"|"ALREADY_APPLIED";
 readonly job_state:string;readonly project_hash:string;
 readonly revision:number;readonly exit_code:number|null;
 readonly timed_out:boolean;
};
type StoredCall={
 job_id:string;owner_anonymous_id:string;call_id:string;
 model_call_key:string;job_revision:number;checkpoint_hash:string;
 project_hash:string;call_hash:string;max_charge_cents:number;
 status:"RESERVED"|"IN_FLIGHT"|"SUCCEEDED"|"BLOCKED_UNCERTAIN";
 receipt_json:unknown|null;
};
const KEY=/^[A-Za-z0-9_-]{8,80}$/u;
const SHA=/^sha256:[0-9a-f]{64}$/u;
const GET=`SELECT job_id::text,owner_anonymous_id::text,call_id,model_call_key,
 job_revision,checkpoint_hash,project_hash,call_hash,max_charge_cents,
 status,receipt_json FROM public.appf2_agent_sandbox_call
 WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid AND call_id=$3::text LIMIT 1`;
const RESERVE=`SELECT appf2_internal.reserve_agent_sandbox_call(
 $1::uuid,$2::text,$3::text,$4::integer,$5::text,$6::text,$7::text,
 $8::integer) AS status`;
const CLAIM=`UPDATE public.appf2_agent_sandbox_call SET status='IN_FLIGHT'
 WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid AND call_id=$3::text
 AND status='RESERVED' AND call_hash=$4::text AND checkpoint_hash=$5::text
 RETURNING call_id`;
const COMPLETE=`UPDATE public.appf2_agent_sandbox_call SET status='SUCCEEDED',
 receipt_json=$4::jsonb
 WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid AND call_id=$3::text
 AND status='IN_FLIGHT' RETURNING call_id`;
const UNCERTAIN=`UPDATE public.appf2_agent_sandbox_call SET status='BLOCKED_UNCERTAIN'
 WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid AND call_id=$3::text
 AND status='IN_FLIGHT' RETURNING call_id`;
export function validSandboxRunBody(x:unknown):x is SandboxRunInput{
 if(typeof x!=="object"||x===null||Array.isArray(x))return false;
 const y=x as Record<string,unknown>;
 return Object.keys(y).sort().join(",")===
  "anonymous_id,expected_revision,explicit_container_consent,max_charge_cents,model_call_key"&&
  typeof y.anonymous_id==="string"&&typeof y.model_call_key==="string"&&
  KEY.test(y.model_call_key)&&Number.isSafeInteger(y.expected_revision)&&
  Number(y.expected_revision)>=1&&y.explicit_container_consent===true&&
  Number.isSafeInteger(y.max_charge_cents)&&Number(y.max_charge_cents)>=1&&
  Number(y.max_charge_cents)<=100;
}
// eslint-disable-next-line complexity -- Optional service binding plus legacy strict network origin are independent guards.
export function validPrivateBrokerConfig(url:string,token:string,
 allowedJobId:string,jobId:string,
 brokerService?:SandboxServiceBinding):boolean{
 if(brokerService!==undefined){
  return typeof brokerService.fetch==="function"&&url===""&&
   token.length>=32&&token.length<=512&&
   sandboxJobAllowed(allowedJobId,jobId);
 }
 try{
  const parsed=new URL(url);
  return parsed.protocol==="https:"&&parsed.hostname.endsWith(".workers.dev")&&
   parsed.hostname!=="workers.dev"&&parsed.port===""&&
   parsed.username===""&&parsed.password===""&&parsed.pathname==="/"&&
   parsed.search===""&&parsed.hash===""&&token.length>=32&&token.length<=512&&
   sandboxJobAllowed(allowedJobId,jobId);
 }catch{return false;}
}
export async function sendPrivateSandboxTask(task:{
 job_id:string;project:ProjectSnapshot;call:AgentToolCall
},baseUrl:string,token:string,
 service?:SandboxServiceBinding):Promise<unknown>{
 const request=new Request((service?"https://appf2-private-sandbox.invalid/":baseUrl)+
  "internal/execute",{
  method:"POST",redirect:"error",
  headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
  body:JSON.stringify(task),signal:AbortSignal.timeout(45000)
 });
 // The private service binding is always preferred; never fall back to
 // public fetch after a private error or a possibly paid execution.
 const response=service?await service.fetch(request):await fetch(request);
 if(!response.ok)throw Error("SANDBOX_BROKER_UNAVAILABLE");
 const raw=await response.text();
 if(raw.length>16384)throw Error("SANDBOX_BROKER_OVERSIZED");
 const parsed=JSON.parse(raw) as {data?:unknown};
 return parsed.data;
}
async function verifiedEvidence(raw:unknown,call:AgentToolCall):Promise<SandboxEvidence>{
 if(typeof raw!=="object"||raw===null)throw Error("SANDBOX_EVIDENCE_INVALID");
 const item=raw as Record<string,unknown>;
 if(item.call_id!==call.call_id||item.project_hash!==call.project_hash||
  !SHA.test(String(item.output_digest))||
  item.runner_attestation!=="APPF2_ISOLATED_CLOUDFLARE_CONTAINER_V1"||
  typeof item.detail!=="string"||item.detail.length>4096||
  typeof item.timed_out!=="boolean"||
  (item.exit_code!==null&&(!Number.isInteger(item.exit_code)||
   Number(item.exit_code)<0||Number(item.exit_code)>255)))
  throw Error("SANDBOX_EVIDENCE_UNVERIFIED");
 const digest=await sha256CodeBytes(new TextEncoder().encode(item.detail));
 if(digest!==item.output_digest)throw Error("SANDBOX_EVIDENCE_HASH_MISMATCH");
 return raw as SandboxEvidence;
}
async function getCall(db:AgentJobExecutor,jobId:string,owner:string,
 callId:string):Promise<StoredCall|null>{
 return (await db.query<StoredCall>(GET,[jobId,owner,callId])).rows[0]??null;
}
// eslint-disable-next-line max-params -- Immutable identity checks.
function matchesStored(row:StoredCall,callHash:string,revision:number,
 checkpoint:string,charge:number,modelKey:string):void{
 if(row.call_hash!==callHash||row.job_revision!==revision||
  row.checkpoint_hash!==checkpoint||row.max_charge_cents!==charge||
  row.model_call_key!==modelKey)throw Error("SANDBOX_REPLAY_CONFLICT");
}
// eslint-disable-next-line max-params -- Durable reservation context.
async function reserve(db:AgentJobExecutor,input:SandboxRunInput,jobId:string,
 owner:string,call:AgentToolCall,checkpoint:string,hash:string):Promise<StoredCall>{
 const prior=await getCall(db,jobId,owner,call.call_id);
 if(prior){
  matchesStored(prior,hash,input.expected_revision,checkpoint,
   input.max_charge_cents,input.model_call_key);
  return prior;
 }
 const accepted=(await db.query<{status:string}>(RESERVE,[jobId,
  input.model_call_key,call.call_id,input.expected_revision,
  checkpoint,call.project_hash,hash,input.max_charge_cents])).rows[0];
 if(accepted?.status!=="RESERVED")throw Error("SANDBOX_RESERVE_FAILED");
 const saved=await getCall(db,jobId,owner,call.call_id);
 if(!saved)throw Error("SANDBOX_RESERVATION_MISSING");
 matchesStored(saved,hash,input.expected_revision,checkpoint,
  input.max_charge_cents,input.model_call_key);
 return saved;
}
async function executeOnce(db:AgentJobExecutor,row:StoredCall,task:{
 job_id:string;project:ProjectSnapshot;call:AgentToolCall
},deps:SandboxRunDeps):Promise<SandboxEvidence>{
 if(row.status==="SUCCEEDED")return verifiedEvidence(row.receipt_json,task.call);
 if(row.status!=="RESERVED")throw Error("SANDBOX_UNKNOWN_RESULT_NO_RETRY");
 const claimed=await db.query<{call_id:string}>(CLAIM,
  [row.job_id,row.owner_anonymous_id,row.call_id,row.call_hash,row.checkpoint_hash]);
 if(claimed.rows.length!==1)throw Error("SANDBOX_ALREADY_DISPATCHED_NO_RETRY");
 let result:SandboxEvidence;
 try{
  const raw=await (deps.send??sendPrivateSandboxTask)(
   task,deps.brokerUrl,deps.brokerToken,deps.brokerService);
  result=await verifiedEvidence(raw,task.call);
  const saved=await db.query<{call_id:string}>(COMPLETE,
   [row.job_id,row.owner_anonymous_id,row.call_id,JSON.stringify(result)]);
  if(saved.rows.length!==1)throw Error("SANDBOX_RECEIPT_NOT_DURABLE");
 }catch{
  await db.query(UNCERTAIN,[row.job_id,row.owner_anonymous_id,row.call_id])
   .catch(()=>undefined);
  throw Error("SANDBOX_UNKNOWN_RESULT_NO_RETRY");
 }
 return result;
}
/** Disallows model-owned shell, fake attestations and replayed container charging. */
// eslint-disable-next-line complexity -- Private execution admission gates.
export async function executeSignedSandboxTool(input:SandboxRunInput,
 deps:SandboxRunDeps):Promise<SandboxRunResult>{
 if(!validSandboxRunBody(input)||input.anonymous_id!==deps.owner||
  !validPrivateBrokerConfig(deps.brokerUrl,deps.brokerToken,
   deps.allowedJobId,deps.jobId,deps.brokerService))
  throw Error("SANDBOX_PRIVATE_EXECUTION_DISABLED");
 const creator=(await deps.db.query<{job_id:string}>(`SELECT job_id::text
  FROM public.appf2_agent_job WHERE job_id=$1::uuid
  AND owner_anonymous_id=$2::uuid AND owner_key_thumbprint=$3::text LIMIT 1`,
  [deps.jobId,deps.owner,deps.ownerThumb])).rows[0];
 if(creator?.job_id!==deps.jobId)throw Error("SANDBOX_CREATOR_MISMATCH");
 const job=await recoverAgentJob(deps.db,deps.jobId,deps.owner);
 if(!job)throw Error("SANDBOX_JOB_MISSING");
 const savedModel=await getModelCall(deps.db,deps.jobId,deps.owner,
  input.model_call_key);
 if(savedModel?.status!=="SUCCEEDED"||!savedModel.response_json)
  throw Error("SANDBOX_MODEL_NOT_DURABLE");
 const parsed=parseAgentResponsesBatch(savedModel.response_json,job.project.project_hash);
 if(!parsed||parsed.calls.length!==1||
  !["run_build","run_test"].includes(parsed.calls[0].name))
  throw Error("SANDBOX_MODEL_TOOL_NOT_ALLOWED");
 const call=parsed.calls[0];
 if(job.job.revision===input.expected_revision+1&&
  job.job.checkpoint.completed_call_ids.at(-1)===call.call_id)
  return {status:"ALREADY_APPLIED",job_state:job.job.job_state,
   project_hash:job.project.project_hash,revision:job.job.revision,
   exit_code:null,timed_out:false};
 if(job.job.revision!==input.expected_revision||
  savedModel.job_revision!==job.job.revision||
  savedModel.checkpoint_hash!==job.job.checkpoint_hash||
  job.job.checkpoint.completed_call_ids.includes(call.call_id))
  throw Error("SANDBOX_JOB_REVISION_MISMATCH");
 const callHash=await sha256CodeBytes(new TextEncoder().encode(
  "APPF2_PRIVATE_SANDBOX_CALL_V1\u0000"+JSON.stringify({
   job_id:deps.jobId,model_call_key:input.model_call_key,
   checkpoint_hash:job.job.checkpoint_hash,project_hash:job.project.project_hash,
   call
  })));
 const reserved=await reserve(deps.db,input,deps.jobId,deps.owner,call,
  job.job.checkpoint_hash,callHash);
 const evidence=await executeOnce(deps.db,reserved,{
  job_id:deps.jobId,project:job.project,call
 },deps);
 const result=await executeAgentTurn(job,savedModel.response_json,{
  broker:async()=>evidence,
  persist:(previous,next,project)=>advanceDurableAgentJob(deps.db,
   previous.job,deps.owner,next,project)
 });
 return {status:"SANDBOX_RESULT_SAVED",job_state:result.saved.job.job_state,
  revision:result.saved.job.revision,project_hash:result.saved.project.project_hash,
  exit_code:evidence.exit_code,timed_out:evidence.timed_out};
}

/**
 * Read only an independently recorded result for the exact preceding model
 * build/test call. The AI never gets to invent its own success or diagnostics.
 */
export async function readProvenSandboxToolResult(db:AgentJobExecutor,identity:{
 readonly jobId:string;readonly owner:string;readonly modelCallKey:string;
 readonly checkpointHash:string;readonly projectHash:string;
 readonly jobRevision:number;readonly call:AgentToolCall;
}):Promise<SandboxEvidence>{
 const {jobId,owner,modelCallKey,checkpointHash,projectHash,jobRevision,call}=identity;
 if(call.project_hash!==projectHash||
  (call.name!=="run_build"&&call.name!=="run_test"))
  throw Error("SANDBOX_CONTINUATION_TOOL_INVALID");
 const row=await getCall(db,jobId,owner,call.call_id);
 if(!row||row.status!=="SUCCEEDED"||row.receipt_json===null||
  row.job_id!==jobId||row.owner_anonymous_id!==owner||
  row.model_call_key!==modelCallKey||row.job_revision!==jobRevision||
  row.checkpoint_hash!==checkpointHash||row.project_hash!==projectHash)
  throw Error("SANDBOX_CONTINUATION_NOT_PROVEN");
 const callHash=await sha256CodeBytes(new TextEncoder().encode(
  "APPF2_PRIVATE_SANDBOX_CALL_V1\u0000"+JSON.stringify({
   job_id:jobId,model_call_key:modelCallKey,
   checkpoint_hash:checkpointHash,project_hash:projectHash,call
  })));
 if(row.call_hash!==callHash)throw Error("SANDBOX_CONTINUATION_CALL_CHANGED");
 return verifiedEvidence(row.receipt_json,call);
}
