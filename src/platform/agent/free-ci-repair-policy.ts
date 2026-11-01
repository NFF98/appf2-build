/** Active Sprint 3.5 GPT-6 -> free Docker repair policy.
 * One immutable signed model reservation per source project revision.
 * History is the owner/job scoped independently OIDC-saved QA receipt,
 * never model-authored assertions, and never a new frozen acceptance plan.
 */
import {validQaChecks,frozenFreeCiPlanHash} from "../../edge/free-ci-result.js";
import type {QaPlan} from "../qa/requirement-contract.js";
const HASH=/^sha256:[a-f0-9]{64}$/u;
export type FreeCiRepairHistory={
 readonly project_hash:string;readonly receipt_json:unknown;
 readonly project_revision:number;readonly parent_hash:string|null;
};
export type FreeCiRepairDecision={
 readonly round:1|2|3;
 readonly model_call_key:string;
 readonly required_approved_cents:number;
 readonly mode:"FIX_FAILED_CHECKS"|"RETHINK_ROOT_CAUSE";
 readonly repeated_failure_count:number;
 readonly evidence_snapshots:number;
};
type Failure={hash:string;signature:string};
// eslint-disable-next-line complexity -- Immutable attested QA evidence admission is deliberately fail-closed.
async function attestedFailure(planHash:string,plan:QaPlan,
 row:FreeCiRepairHistory):Promise<Failure|null>{
 if(!HASH.test(row.project_hash)||typeof row.receipt_json!=="object"||
  row.receipt_json===null||Array.isArray(row.receipt_json))return null;
 const receipt=row.receipt_json as Record<string,unknown>;
 if(receipt.original_requirements_qa!==false||
  receipt.app_published!==false||receipt.qa_plan_hash!==planHash)return null;
 if(receipt.version==="APPF2_FREE_CI_BUILD_FAILURE_V1"){
  const stage=receipt.failure_stage;
  const code=receipt.diagnostic_code;
  if((stage!=="BUILD"||code!=="FREE_CI_BUILD_FAILED")&&
   (stage!=="RENDER"||code!=="FREE_CI_CHROMIUM_RENDER_FAILED"))return null;
  return {hash:row.project_hash,signature:"FAILED_"+String(stage)};
 }
 if(receipt.version!=="APPF2_FREE_CI_SMOKE_V1"||
  !validQaChecks(receipt.qa_checks)||!Array.isArray(receipt.qa_checks)||
  receipt.qa_checks.length!==plan.criteria.length)return null;
 const checks=receipt.qa_checks;
 if(!plan.criteria.every((criterion,i)=>
  checks[i]?.criterion_id===criterion.id&&
  (criterion.automatable||checks[i]?.verdict!=="PASS")))return null;
 const failures=checks.filter(c=>c.verdict==="FAIL")
  .map(c=>c.criterion_id).sort();
 return failures.length>0?{hash:row.project_hash,
  signature:JSON.stringify(failures)}:null;
}
/** Deterministic, no-write decision; never invents failure evidence.
 * First failed source is project revision 2; three MAX repair attempts
 * result in source revision 5 / eight durable build+repair steps.
 * A new charge is forbidden without owner-signed total cost approval.
 */
// eslint-disable-next-line complexity, max-params -- Frozen plan, saved history, current head and cost limits are separate guards.
export async function decideFreeCiRepair(plan:QaPlan,
 history:readonly FreeCiRepairHistory[],currentHash:string,
 projectRevision:number,usedSteps:number,approvedCents:number,
 maxSteps:number):Promise<FreeCiRepairDecision>{
 if(!HASH.test(currentHash)||!Number.isSafeInteger(projectRevision)||
  projectRevision<2||projectRevision>4)throw Error("SP35_REPAIR_ROUNDS_EXHAUSTED");
 const round=projectRevision-1 as 1|2|3;
 if(!Number.isSafeInteger(usedSteps)||usedSteps+2>maxSteps||
  usedSteps<2||usedSteps!==projectRevision*2-2)
  throw Error("SP35_REPAIR_STEP_BUDGET_OR_HISTORY_INVALID");
 const required=28+16*round;
 if(!Number.isSafeInteger(approvedCents)||approvedCents<required)
  throw Error("SP35_REPAIR_NEW_OWNER_COST_APPROVAL_REQUIRED_"+required);
 const hash=await frozenFreeCiPlanHash(plan);
 const seen=new Set<string>(),failures:Failure[]=[];
 let expectedHash=currentHash,expectedRevision=projectRevision;
 for(const row of history.slice(0,8)){
  // A timestamp is NOT a source lineage. Bind each independently verified
  // receipt to the immutable parent pointer from PostgreSQL snapshots.
  // A missing snapshot, fork, stale receipt, duplicate or revision gap
  // breaks the streak. Never spend based on unrelated previous projects.
  if(seen.has(row.project_hash)||row.project_hash!==expectedHash||
   row.project_revision!==expectedRevision||
   !HASH.test(row.parent_hash??""))break;
  seen.add(row.project_hash);
  const valid=await attestedFailure(hash,plan,row);
  // A missing, forged or UNTESTED-only version interrupts the streak.
  if(!valid)break;
  failures.push(valid);
  expectedRevision--;
  expectedHash=row.parent_hash!;
 }
 if(failures[0]?.hash!==currentHash)
  throw Error("SP35_REPAIR_CURRENT_PROVEN_FAILURE_MISSING");
 let repeated=0;
 for(const fail of failures){
  if(fail.signature!==failures[0].signature)break;
  repeated++;
 }
 return {round,model_call_key:"sp35_free_ai_repair_v"+round,
  required_approved_cents:required,
  mode:repeated>=3?"RETHINK_ROOT_CAUSE":"FIX_FAILED_CHECKS",
  repeated_failure_count:repeated,evidence_snapshots:failures.length};
}
