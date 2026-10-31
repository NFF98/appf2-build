/**
 * Multi-file Agent repair policy. Independent, already-saved browser QA is
 * authoritative; never infer progress from model claims or amend frozen tests.
 * No new paid calls and no migration: the private QA journal is source of truth.
 */
import {validQaObservedChecks,type PrivateQaCheck}
 from "./qa-browser-contract.js";
import type {QaPlan} from "../qa/requirement-contract.js";
export type SavedQaHistory={
 readonly project_hash:string;
 readonly status:string;
 readonly receipt_json:unknown;
};
const HASH=/^sha256:[0-9a-f]{64}$/u;
export type QaRepairStrategy={
 readonly mode:"FIX_FAILED_CHECKS"|"RETHINK_ROOT_CAUSE";
 readonly verified_failure_count:number;
 readonly stalled_failure_count:number;
 readonly latest_failed_criteria:readonly string[];
};
/** Input MUST be newest first and bound to the current owner + job by SQL. */
// eslint-disable-next-line complexity -- Strict signed-QA provenance guards cannot be skipped.
export function determineQaRepairStrategy(plan:QaPlan,
 history:readonly SavedQaHistory[]):QaRepairStrategy{
 const seen=new Set<string>();
 const failures:{ids:readonly string[];signature:string}[]=[];
 for(const item of history.slice(0,8)){
  if(item.status!=="SUCCEEDED"||!HASH.test(item.project_hash)||
   seen.has(item.project_hash)||
   typeof item.receipt_json!=="object"||item.receipt_json===null||
   Array.isArray(item.receipt_json))continue;
  seen.add(item.project_hash);
  const data=item.receipt_json as Record<string,unknown>;
  if(data.ready_for_review!==false||data.packet!==null||
   !validQaObservedChecks(plan,data.checks))continue;
  const checks=data.checks as PrivateQaCheck[];
  const ids=checks.filter(c=>c.verdict!=="PASS").map(c=>c.criterion_id).sort();
  if(ids.length===0)continue;
  failures.push({ids,signature:JSON.stringify(ids)});
 }
 const latest=failures[0];
 let stalled=0;
 if(latest){
  for(const f of failures){
   if(f.signature!==latest.signature)break;
   stalled++;
  }
 }
 return {mode:stalled>=3?"RETHINK_ROOT_CAUSE":"FIX_FAILED_CHECKS",
  verified_failure_count:failures.length,
  stalled_failure_count:stalled,
  latest_failed_criteria:latest?.ids??[]};
}
