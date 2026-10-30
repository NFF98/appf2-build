/**
 * P-256 owner-signed Cloudflare Browser QA admission. Last saved run_test and
 * current immutable snapshot are checked BEFORE a durable one-shot reservation.
 * Ambiguous delivery is NEVER retried. No App publication authority exists.
 */
import {verifyFrozenQaPlan} from "./agent-qa-plan.js";
import {recoverAgentJob,advanceDurableAgentJob} from "../platform/agent/durable-agent-service.js";
import {sha256CodeBytes} from "../platform/blueprint/code-artifact-v2.js";
import {validPrivateBrowserQaTask,validQaObservedChecks,strictQaChecks,
 type PrivateBrowserQaTask}
 from "../platform/agent/qa-browser-contract.js";
import {reviewAgentQa} from "./agent-qa-review.js";
import type {QaPlan} from "../platform/qa/requirement-contract.js";
import type {AgentJobExecutor} from "../platform/agent/postgres-agent-jobs.js";
import type {SandboxServiceBinding} from "./agent-sandbox-run.js";
export type BrowserQaRunInput={readonly anonymous_id:string;
 readonly expected_revision:number} & PrivateBrowserQaTask;
export function validBrowserQaRunBody(x:unknown):x is BrowserQaRunInput{
 if(typeof x!=="object"||x===null||Array.isArray(x))return false;
 const v=x as Record<string,unknown>;
 if(Object.keys(v).sort().join(",")!==
  "anonymous_id,build_call_id,expected_revision,explicit_browser_qa_consent,job_id,original_plan,original_prompt,project_hash,test_call_id"||
  typeof v.anonymous_id!=="string"||
  !Number.isSafeInteger(v.expected_revision)||Number(v.expected_revision)<1)return false;
 const {anonymous_id,expected_revision,...task}=v;
 void anonymous_id;void expected_revision;
 return validPrivateBrowserQaTask(task);
}
type SandboxRow={readonly job_id:string;readonly owner_anonymous_id:string;
 readonly call_id:string;readonly project_hash:string;readonly status:string;
 readonly job_revision:number;
 readonly receipt_json:unknown};
type QaResponse={readonly ready_for_review:boolean;readonly packet:unknown;
 readonly checks:unknown};
/** A contradictory private-verifier response must not become durable QA evidence.
 * A claimed PASS needs every original automatable criterion and a packet;
 * a failed run has NO signed approval packet and at least one failed check.
 */
export function consistentBrowserQaResult(plan:QaPlan,value:unknown):boolean{
 if(typeof value!=="object"||value===null||Array.isArray(value))return false;
 const data=value as Record<string,unknown>;
 if(typeof data.ready_for_review!=="boolean"||
  !validQaObservedChecks(plan,data.checks))return false;
 const allPassed=strictQaChecks(plan,data.checks);
 if(data.ready_for_review!==allPassed)return false;
 if(allPassed)return typeof data.packet==="object"&&data.packet!==null&&
  !Array.isArray(data.packet);
 return data.packet===null&&data.checks.some(c=>c.verdict!=="PASS");
}

function passedSavedTest(row:SandboxRow|undefined,identity:{
 readonly jobId:string;readonly owner:string;
 readonly projectHash:string;readonly testCallId:string}):boolean{
 if(!row||row.job_id!==identity.jobId||
  row.owner_anonymous_id!==identity.owner||
  row.project_hash!==identity.projectHash||
  row.call_id!==identity.testCallId||row.status!=="SUCCEEDED")return false;
 if(typeof row.receipt_json!=="object"||row.receipt_json===null||
  Array.isArray(row.receipt_json))return false;
 const e=row.receipt_json as Record<string,unknown>;
 return e.call_id===identity.testCallId&&e.project_hash===identity.projectHash&&
  e.exit_code===0&&e.timed_out===false&&
  e.runner_attestation==="APPF2_ISOLATED_CLOUDFLARE_CONTAINER_V1";
}
async function dispatchQa(service:SandboxServiceBinding,token:string,
 task:PrivateBrowserQaTask):Promise<QaResponse>{
 const response=await service.fetch(new Request(
  "https://appf2-private-qa.invalid/internal/verify-built-app",{
  method:"POST",redirect:"error",
  headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
  signal:AbortSignal.timeout(60000),body:JSON.stringify(task)
 }));
 if(response.status!==200)throw Error("QA_WORKER_UNAVAILABLE_NO_RETRY");
 const content=await response.text();
 if(content.length>65536)throw Error("QA_RESPONSE_TOO_LARGE");
 const parsed:unknown=JSON.parse(content);
 if(typeof parsed!=="object"||parsed===null||!("data" in parsed)||
  typeof parsed.data!=="object"||parsed.data===null)
  throw Error("QA_RESPONSE_INVALID");
 const data=parsed.data as Record<string,unknown>;
 if(typeof data.ready_for_review!=="boolean"||
  !Array.isArray(data.checks))throw Error("QA_RESPONSE_INVALID");
 return data as unknown as QaResponse;
}
type Dependencies={
 readonly db:AgentJobExecutor;readonly jobId:string;readonly owner:string;
 readonly ownerThumb:string;readonly service:SandboxServiceBinding;
 readonly privateToken:string;readonly verifierSecret:string;
};
/** CAS reserve before Browser Run, and never dispatch on rerun/uncertainty. */
// eslint-disable-next-line complexity -- Signed creator, saved run, immutable project and one-shot paid QA gates.
export async function runSignedIndependentBrowserQa(input:BrowserQaRunInput,
 deps:Dependencies){
 if(!validBrowserQaRunBody(input)||input.anonymous_id!==deps.owner||
  input.job_id!==deps.jobId||deps.privateToken.length<32||
  deps.verifierSecret.length<32)throw Error("QA_NOT_AUTHORIZED");
 const creator=(await deps.db.query<{job_id:string}>(
  "SELECT job_id::text\n FROM public.appf2_agent_job WHERE job_id=$1::uuid "+
  "AND owner_anonymous_id=$2::uuid AND owner_key_thumbprint=$3::text LIMIT 1",
  [deps.jobId,deps.owner,deps.ownerThumb])).rows[0];
 if(creator?.job_id!==deps.jobId)throw Error("QA_NOT_CREATOR");
 const current=await recoverAgentJob(deps.db,deps.jobId,deps.owner);
 if(!current||current.job.revision!==input.expected_revision||
  current.job.job_state!=="TESTING"||
  current.project.project_hash!==input.project_hash||
  current.job.checkpoint.completed_call_ids.at(-1)!==input.test_call_id)
  throw Error("QA_NO_LATEST_TESTED_SNAPSHOT");
 const digest=await sha256CodeBytes(new TextEncoder().encode(
  "APPF2_AGENT_REQUEST_V1\u0000"+input.original_prompt.trim()));
 if(digest!==current.job.request_hash)throw Error("QA_ORIGINAL_PROMPT_CHANGED");
 if(!await verifyFrozenQaPlan(deps.db,deps.jobId,deps.owner,
  input.original_prompt,input.original_plan))throw Error("QA_ORIGINAL_PLAN_NOT_FROZEN");
 const test=(await deps.db.query<SandboxRow>(
  "SELECT job_id::text,owner_anonymous_id::text,call_id,model_call_key,"+
  "job_revision,checkpoint_hash,project_hash,call_hash,max_charge_cents,status,receipt_json "+
  "FROM public.appf2_agent_sandbox_call WHERE job_id=$1::uuid "+
  "AND owner_anonymous_id=$2::uuid AND call_id=$3::text LIMIT 1",
  [deps.jobId,deps.owner,input.test_call_id])).rows[0];
 if(!passedSavedTest(test,{jobId:deps.jobId,owner:deps.owner,
  projectHash:input.project_hash,testCallId:input.test_call_id}))
  throw Error("QA_TEST_RUN_NOT_INDEPENDENTLY_PROVEN");
 // Verify successful build provenance BEFORE any paid Browser Run dispatch.
 // The private Sandbox releases compiled assets only for the exact build ID.
 const build=(await deps.db.query<SandboxRow>(
  "SELECT job_id::text,owner_anonymous_id::text,call_id,model_call_key,"+
  "job_revision,checkpoint_hash,project_hash,call_hash,max_charge_cents,status,receipt_json "+
  "FROM public.appf2_agent_sandbox_call WHERE job_id=$1::uuid "+
  "AND owner_anonymous_id=$2::uuid AND call_id=$3::text LIMIT 1",
  [deps.jobId,deps.owner,input.build_call_id])).rows[0];
 const completed=current.job.checkpoint.completed_call_ids;
 if(!passedSavedTest(build,{jobId:deps.jobId,owner:deps.owner,
  projectHash:input.project_hash,testCallId:input.build_call_id})||
  !Number.isSafeInteger(build.job_revision)||
  !Number.isSafeInteger(test.job_revision)||
  build.job_revision>test.job_revision||
  completed.indexOf(input.build_call_id)<0||
  completed.indexOf(input.build_call_id)>=completed.indexOf(input.test_call_id))
  throw Error("QA_BUILD_NOT_IN_PROVEN_CHECKPOINT");
 const inserted=await deps.db.query<{job_id:string}>(
  "INSERT INTO public.appf2_agent_browser_qa_attempt("+
  "job_id,owner_anonymous_id,project_hash,job_revision,build_call_id,test_call_id) "+
  "VALUES($1::uuid,$2::uuid,$3::text,$4::integer,$5::text,$6::text) "+
  "ON CONFLICT (job_id,project_hash) DO NOTHING RETURNING job_id::text",
  [deps.jobId,deps.owner,input.project_hash,input.expected_revision,
   input.build_call_id,input.test_call_id]);
 if(inserted.rows.length!==1)throw Error("QA_ALREADY_DISPATCHED_NO_RETRY");
 const {anonymous_id,expected_revision,...task}=input;
 void anonymous_id;void expected_revision;
 let response:QaResponse;
 try{
  response=await dispatchQa(deps.service,deps.privateToken,task);
  if(!consistentBrowserQaResult(task.original_plan,response))
   throw Error("QA_INDEPENDENT_CHECKS_INVALID");
  const saved=await deps.db.query<{job_id:string}>(
   "UPDATE public.appf2_agent_browser_qa_attempt SET status='SUCCEEDED',"+
   "receipt_json=$4::jsonb WHERE job_id=$1::uuid AND "+
   "owner_anonymous_id=$2::uuid AND project_hash=$3::text "+
   "AND status='IN_FLIGHT' RETURNING job_id::text",
   [deps.jobId,deps.owner,input.project_hash,JSON.stringify(response)]);
  if(saved.rows.length!==1)throw Error("QA_RESULT_NOT_DURABLE");
 }catch{
  await deps.db.query("UPDATE public.appf2_agent_browser_qa_attempt "+
   "SET status='BLOCKED_UNCERTAIN' WHERE job_id=$1::uuid "+
   "AND owner_anonymous_id=$2::uuid AND project_hash=$3::text "+
   "AND status='IN_FLIGHT' RETURNING job_id::text",
   [deps.jobId,deps.owner,input.project_hash]).catch(()=>undefined);
  throw Error("QA_UNKNOWN_RESULT_NO_RETRY");
 }
 if(!response.ready_for_review){
  // A failed independently observed requirement re-opens the exact saved
  // project for an owner-consented model repair; no model spend happens here.
  const next={...current.job.checkpoint,state:"REPAIRING" as const,
   previous_checkpoint_id:current.job.checkpoint_hash};
  const repaired=await advanceDurableAgentJob(deps.db,current.job,deps.owner,next);
  return {status:"BROWSER_QA_FAILED_REPAIR_READY" as const,
   checks:response.checks,ready_for_review:false,
   revision:repaired.job.revision,job_state:repaired.job.job_state,
   project_hash:repaired.project.project_hash,
   next_action:"OWNER_APPROVED_QA_REPAIR_MODEL" as const,
   app_published:false,publication_authorized:false};
 }
 // Packet from the separate verifier is still independently rechecked under
 // creator, current revision, original prompt, and saved Sandbox evidence.
 const result=await reviewAgentQa({
  anonymous_id:deps.owner,packet:response.packet as never
 },{db:deps.db,jobId:deps.jobId,owner:deps.owner,
  ownerThumb:deps.ownerThumb,verifierSecret:deps.verifierSecret});
 return {...result,checks:response.checks};
}
