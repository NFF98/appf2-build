// APPF2-TASK-ONE-APPROVAL-1
// Pure, fail-closed eligibility for one bounded Human conditional Task approval.
// This module NEVER merges, closes, starts a Task/Sprint or authenticates a person.
// The trusted executor MUST verify direct Human provenance and live GitHub evidence.
const HEX40=/^[a-f0-9]{40}$/;
const HEX64=/^[a-f0-9]{64}$/;
const ACTIONS=Object.freeze(["MARK_FINAL_READY","APPROVE_MERGE","RECORD_MERGE","APPROVE_CLOSURE"]);
const CONTEXTS=Object.freeze(["ci","attack","governance","Analyze JavaScript / TypeScript"]);
const evidencePass=x=>x?.verdict==="PASS";
const nonempty=s=>typeof s==="string" && s.trim().length>0;
const fail=(e,ok,msg)=>{if(!ok)e.push(msg);};
const same=(a,b)=>a===b;
const exactList=(a,b)=>Array.isArray(a)&&a.length===b.length&&
  new Set(a).size===a.length&&b.every(x=>a.includes(x));
const validatedChecks=(checks,head)=>CONTEXTS.every(name=>{
  const matched=(checks||[]).filter(c=>c.name===name&&c.head_sha===head);
  return matched.length===1&&matched[0].status==="completed"&&
    matched[0].conclusion==="success"&&matched[0].mode==="FULL";
});
const mappedPass=rows=>Array.isArray(rows)&&rows.length>0&&
  rows.every(x=>x.status==="PASS"&&!x.blocked);
const matchScope=(g,c)=>["task_id","sprint_id","build_spec_id","scope_sha256"].every(k=>
  same(g[k],c[k]));
const grantScopeOK=(g,c)=>
  ["task_id","sprint_id","build_spec_id"].every(k=>nonempty(g?.[k]))&&
  HEX64.test(g?.scope_sha256||"")&&matchScope(g,c);
const grantTimeOK=(g,c)=>Number.isSafeInteger(g?.approved_at_unix)&&
  Number.isSafeInteger(g?.expires_at_unix)&&
  g.expires_at_unix>g.approved_at_unix &&
  g.expires_at_unix-g.approved_at_unix<=30*86400 &&
  c.now>=g.approved_at_unix && c.now<=g.expires_at_unix;
const grantOriginShapeOK=g=>g?.human?.source_kind==="DIRECT_HUMAN_MESSAGE"&&
  g.human?.decision==="AUTHORIZE_TASK_CONDITIONAL_EXECUTION"&&
  g.human?.approver==="NFF98"&&nonempty(g.human?.human_message_ref);
const checkGrant=(g,c,e)=>{
  fail(e,g?.schema==="APPF2-TASK-ONE-APPROVAL-1","wrong authorization schema");
  fail(e,g?.change_class==="L1_TASK"&&c.change_class==="L1_TASK","L2/L3 or undefined task change cannot delegate");
  fail(e,exactList(g?.actions,ACTIONS),"grant must explicitly cover precisely Final Ready, Merge and Closure");
  fail(e,grantScopeOK(g,c),"Task/Sprint/Build/scope mismatch");
  fail(e,HEX40.test(g?.base_sha||"")&&g.base_sha===c.base_sha,"approved BASE mismatch");
  fail(e,grantTimeOK(g,c),"grant missing, expired or excessive TTL");
  fail(e,grantOriginShapeOK(g),"no explicit genuine Human grant reference");
  fail(e,c.provenance_checked_by_trusted_executor===true,
    "independent Human-origin check required; GitHub shared identity/AI comment is not proof");
  fail(e,c.authority_revoked!==true&&c.scope_changed!==true,"revoked authorization or changed scope");
};
const checkEvidence=(c,e)=>{
  fail(e,HEX40.test(c.head_sha||"")&&validatedChecks(c.checks,c.head_sha),
    "four real required FULL checks are not successful on exact HEAD");
  fail(e,c.bce?.verdict==="PASS"&&c.bce?.head_sha===c.head_sha&&
    c.bce?.independent===true,"independent GPT BCE PASS on exact HEAD missing");
  fail(e,mappedPass(c.mapped_ac_tests),"mapped AC tests missing, NOT_RUN/FAIL or blocked");
  fail(e,evidencePass(c.scope_gate)&&evidencePass(c.evidence_gate),
    "scope/evidence gates missing or failed");
  fail(e,c.product_truth_changed!==true&&c.security_exception!==true,
    "unapproved Product truth or security exception");
};
const readyPr=(c)=>c.pr?.state==="open"&&c.pr?.draft===false&&
  c.pr?.base_ref==="main"&&c.pr?.head_sha===c.head_sha;
const verifiedMerged=(c)=>c.pr?.merged===true&&
  HEX40.test(c.pr?.merge_commit_sha||"")&&c.canonical_main_contains_merge===true;
const verifiedClosure=(c)=>c.closure?.verdict==="PASS"&&
  c.closure?.head_sha===c.head_sha&&c.closure?.no_unmapped_gaps===true&&
  c.closure?.carry_forward_verified===true;
const checkStage=(action,c,e)=>{
  fail(e,ACTIONS.includes(action),"unknown conditional action");
  fail(e,["ACTIVE","REVIEW"].includes(c.sprint_status),"Sprint not active/review");
  fail(e,["IN_PROGRESS","REVIEW"].includes(c.task_status),
    "Task not active/review; CLOSED/BLOCKED cannot be activated");
  if(["MARK_FINAL_READY","APPROVE_MERGE"].includes(action))
    fail(e,readyPr(c),"live Ready PR on exact HEAD required");
  if(action==="APPROVE_MERGE")
    fail(e,c.pr?.mergeable===true&&c.branch_protection_pass===true,
      "normal GitHub protection and mergeability must pass; no bypass");
  if(["RECORD_MERGE","APPROVE_CLOSURE"].includes(action))
    fail(e,verifiedMerged(c),"verified merged commit on canonical main required");
  if(action==="APPROVE_CLOSURE")
    fail(e,verifiedClosure(c),"independent closure evidence and carry-forward checks required");
};
/** Data-only eligibility; not a self-service grant or trusted executor. */
export function evaluateTaskConditionalApproval({grant,action,context}={}){
  const e=[],c=context||{};
  checkGrant(grant,c,e);
  checkEvidence(c,e);
  checkStage(action,c,e);
  return {ok:e.length===0,decision:e.length===0?"ELIGIBLE_FOR_TRUSTED_EXECUTOR":"HARD_STOP",
    action,errors:e};
}
export const CONDITIONAL_ACTIONS=ACTIONS;
export const REQUIRED_FULL_CONTEXTS=CONTEXTS;
