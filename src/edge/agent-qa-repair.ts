/** The only AI repair entry after independently verified Browser QA failures.
 * Paid Responses dispatch uses the existing PostgreSQL at-most-once journal.
 */
import {verifyFrozenQaPlan} from "./agent-qa-plan.js";
import {recoverAgentJob} from "../platform/agent/durable-agent-service.js";
import {runJournaledPaidModelTurn,type PaidModelTurnDeps}
 from "../platform/agent/journaled-model-gateway.js";
import {sha256CodeBytes} from "../platform/blueprint/code-artifact-v2.js";
import {parseQaPlan} from "../platform/qa/requirement-contract.js";
import {validQaObservedChecks} from "../platform/agent/qa-browser-contract.js";
import {qaRepairCallKey} from "../platform/agent/qa-repair-key.js";
import {determineQaRepairStrategy,type SavedQaHistory}
 from "../platform/agent/qa-repair-strategy.js";
import type {AgentJobExecutor} from "../platform/agent/postgres-agent-jobs.js";
const KEY=/^[A-Za-z0-9_-]{8,80}$/u;
export type QaRepairInput={readonly anonymous_id:string;readonly expected_revision:number;
 readonly model_call_key:string;readonly original_prompt:string;
 readonly original_plan:unknown;readonly max_charge_cents:number;
 readonly max_output_tokens:number;readonly explicit_ai_consent:true};
export type QaRepairDeps={readonly db:AgentJobExecutor;readonly jobId:string;
 readonly owner:string;readonly ownerThumb:string;readonly apiKey:string;
 readonly send?:PaidModelTurnDeps["send"]};
// eslint-disable-next-line complexity -- Original requirement, spend and owner consent guards.
export function validQaRepairBody(raw:unknown):raw is QaRepairInput{
 if(typeof raw!=="object"||raw===null||Array.isArray(raw))return false;
 const x=raw as Record<string,unknown>;
 return Object.keys(x).sort().join(",")===
  "anonymous_id,expected_revision,explicit_ai_consent,max_charge_cents,max_output_tokens,model_call_key,original_plan,original_prompt"&&
  typeof x.anonymous_id==="string"&&typeof x.model_call_key==="string"&&
  KEY.test(x.model_call_key)&&typeof x.original_prompt==="string"&&
  x.original_prompt.trim().length>=5&&x.original_prompt.length<=800&&
  parseQaPlan(x.original_plan,x.original_prompt)!==null&&
  x.explicit_ai_consent===true&&Number.isSafeInteger(x.expected_revision)&&
  Number(x.expected_revision)>=2&&Number.isSafeInteger(x.max_charge_cents)&&
  Number(x.max_charge_cents)>=1&&Number(x.max_charge_cents)<=100&&
  Number.isSafeInteger(x.max_output_tokens)&&
  Number(x.max_output_tokens)>=512&&Number(x.max_output_tokens)<=4096;
}
type SavedQa={readonly job_revision:number;readonly status:string;
 readonly receipt_json:unknown};
function failedChecks(record:SavedQa|undefined,revision:number,
 plan:NonNullable<ReturnType<typeof parseQaPlan>>){
 if(!record||record.status!=="SUCCEEDED"||record.job_revision!==revision-1||
  typeof record.receipt_json!=="object"||record.receipt_json===null||
  Array.isArray(record.receipt_json))return null;
 const x=record.receipt_json as Record<string,unknown>;
 if(x.ready_for_review!==false||x.packet!==null||
  !validQaObservedChecks(plan,x.checks)||
  !x.checks.some(v=>v.verdict!=="PASS"))return null;
 return x.checks;
}
/** No historical/bogus QA result may trigger a fresh paid model call. */
// eslint-disable-next-line complexity -- Independent RLS, state, response and budget gates.
export async function executeSignedQaRepair(input:QaRepairInput,deps:QaRepairDeps){
 if(!validQaRepairBody(input)||input.anonymous_id!==deps.owner||
  deps.apiKey.length<16)throw Error("QA_REPAIR_NOT_AUTHORIZED");
 const creator=(await deps.db.query<{job_id:string}>(
  "SELECT job_id::text\n FROM public.appf2_agent_job WHERE job_id=$1::uuid "+
  "AND owner_anonymous_id=$2::uuid AND owner_key_thumbprint=$3::text LIMIT 1",
  [deps.jobId,deps.owner,deps.ownerThumb])).rows[0];
 if(creator?.job_id!==deps.jobId)throw Error("QA_REPAIR_NOT_CREATOR");
 const current=await recoverAgentJob(deps.db,deps.jobId,deps.owner);
 if(!current||current.job.revision!==input.expected_revision||
  current.job.job_state!=="REPAIRING")throw Error("QA_REPAIR_NOT_READY");
 if(input.model_call_key!==qaRepairCallKey(current.project.project_hash))
  throw Error("QA_REPAIR_KEY_MUST_BE_PROJECT_STABLE");
 const hash=await sha256CodeBytes(new TextEncoder().encode(
  "APPF2_AGENT_REQUEST_V1\u0000"+input.original_prompt.trim()));
 if(current.job.request_hash!==hash)throw Error("QA_REPAIR_CHANGED_ORIGINAL_PROMPT");
 const plan=parseQaPlan(input.original_plan,input.original_prompt);
 if(!plan)throw Error("QA_REPAIR_PLAN_INVALID");
 if(!await verifyFrozenQaPlan(deps.db,deps.jobId,deps.owner,
  input.original_prompt,plan))throw Error("QA_REPAIR_PLAN_NOT_FROZEN");
 const journal=(await deps.db.query<SavedQa>(
  "SELECT job_revision,status,receipt_json FROM public.appf2_agent_browser_qa_attempt "+
  "WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid AND project_hash=$3::text LIMIT 1",
  [deps.jobId,deps.owner,current.project.project_hash])).rows[0];
 const failed=failedChecks(journal,current.job.revision,plan);
 if(!failed)throw Error("QA_REPAIR_NO_INDEPENDENT_FAILURE");
 // Historical entries are PRIVATE, job- and owner-scoped, already persisted
 // by the independent verifier. An authoring model cannot forge this signal.
 const history=(await deps.db.query<SavedQaHistory>(
  "SELECT project_hash,status,receipt_json FROM public.appf2_agent_browser_qa_attempt "+
  "WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid "+
  "AND status='SUCCEEDED' ORDER BY created_at DESC,project_hash DESC LIMIT 8",
  [deps.jobId,deps.owner])).rows;
 const strategy=determineQaRepairStrategy(plan,history);
 const rethink=strategy.mode==="RETHINK_ROOT_CAUSE";
 const context=JSON.stringify({protocol:"APPF2_QA_REPAIR_V2",
  instruction:rethink?
   "Three independent browser checks failed on distinct saved project versions "+
   "with the SAME remaining requirements. Stop repeating the previous patch. "+
   "Investigate the root cause, trace the real UI logic and choose a different "+
   "implementation approach using signed read_file / write_files tools. "+
   "Preserve all original requirements; never edit the frozen QA plan. "+
   "Run real build and test after editing.":
   "Fix observed requirements using only signed data-only project tools. "+
   "Never assume tests pass. Run build and test after editing.",
  strategy_mode:strategy.mode,
  verified_failure_count:strategy.verified_failure_count,
  stalled_failure_count:strategy.stalled_failure_count,
  inspection_guide:"If the affected source is missing or clipped, use inspect_project with path dot (.) and offset 0 to page all saved filenames and hashes. Use inspect_project with exact path and offset 0 to page large source files; advance using next_offset. This costs an approved model step but does not execute code. Never guess a file hash or silently alter the frozen QA plan.",
  total_files:current.project.files.length,
  unlisted_files:Math.max(0,current.project.files.length-10),
  project_hash:current.project.project_hash,
  original_prompt:input.original_prompt,original_plan:plan,
  browser_failures:failed,
  files:current.project.files.slice(0,10).map(f=>({
   path:f.path,hash:f.hash,content:f.content.slice(0,1200)}))});
 if(context.length>15000)throw Error("QA_REPAIR_CONTEXT_LIMIT");
 const saved=await runJournaledPaidModelTurn({owner:deps.owner,job:current.job,
  call_key:input.model_call_key,input:context,previous_response_id:null,
  max_output_tokens:input.max_output_tokens,max_charge_cents:input.max_charge_cents,
  paid_consent:true,api_key:deps.apiKey},{db:deps.db,send:deps.send});
 return {status:"QA_REPAIR_MODEL_SAVED" as const,
  response_id:(saved.response as {id:string}).id,source:saved.source,
  revision:current.job.revision,project_hash:current.project.project_hash,
  next_action:"PROCESS_SAVED_MODEL" as const,
  strategy_mode:strategy.mode,
  ready_for_review:false as const,app_published:false as const};
}
