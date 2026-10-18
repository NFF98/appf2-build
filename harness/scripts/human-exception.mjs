// GOV-REFORM-20261013: reusable, fail-closed Human exception lanes.
// CI verifies exact bytes, lane scope, expiry, replay and decision metadata.
// CI cannot prove that the approver is a person: independent BCE plus a Human
// manual provenance check remain mandatory before any merge.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

export const HUMAN_EXCEPTION_SCHEMA="APPF2-HUMAN-EXCEPTION-1";
export const HUMAN_EXCEPTION_SCOPE_MARKER="Generic Human exception lane recognized";
export const GOVERNANCE_REFORM_POLICY_PATH="harness/policy/governance-reform.json";

const RE_SHA=/^[0-9a-f]{40}$/;
const RE_DIGEST=/^[0-9a-f]{64}$/;
const RE_CASE=/^GOV-[A-Z0-9-]{3,90}$/;
const SAFE_REL=/^[a-zA-Z0-9/_.@-]+$/;

const sorted=xs=>[...xs].sort();
const canonical=v=>{
  if(Array.isArray(v)) return v.map(canonical);
  if(v && typeof v==="object") return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));
  return v;
};
export const sameJson=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const nonEmptyString=v=>typeof v==="string" && v.trim().length>0;
const nonEmptyStrings=v=>Array.isArray(v) && v.length>0 && v.every(nonEmptyString);
const isUnix=v=>Number.isSafeInteger(v) && v>0;

const globSegmentToRegex=s=>s.replace(/[.+?^${}()|[\]\\]/g,"\\$&").replace(/\*/g,"[^/]*");
const globToRegex=rule=>new RegExp("^"+rule.split("**/").map(globSegmentToRegex).join("(?:.*/)?")+"$");
export const matchesPathRule=(p,rule)=>{
  if(rule.includes("*")) return globToRegex(rule).test(p);
  return rule.endsWith("/")?p.startsWith(rule):p===rule;
};
const matchesAny=(p,rules)=>(rules||[]).some(rule=>matchesPathRule(p,rule));

/** Same byte digest as validate-constitutional-change.mjs, so one Human decision binds both gates. */
export function exceptionDigest(readBytes,paths){
  const h=createHash("sha256");
  for(const p of sorted(paths)){
    const bytes=readBytes(p);
    if(!bytes) return null;
    h.update(p+"\0");h.update(bytes);h.update("\0");
  }
  return h.digest("hex");
}

const expandLaneRules=(rules,affectedSprint)=>(rules||[])
  .map(r=>r.replaceAll("{affected_sprint}",affectedSprint||"__NO_SPRINT__"));

const checkDocketBinding=ctx=>{
  const {docket,docketPath,policy,base}=ctx,s=docket.scope_exception||{},errors=[];
  if(!RE_CASE.test(docket.case_id||"") || docketPath!==policy.docket_dir+docket.case_id+".json") errors.push("case identity/path invalid");
  if(!ctx.isNewDocket) errors.push("replay/tamper: exception docket already exists at base and is append-only");
  if(ctx.baseDigests.has(docket.candidate_digest_sha256)) errors.push("replay: candidate digest already consumed by an earlier docket");
  if(!RE_SHA.test(base||"") || docket.base_sha!==base) errors.push("stale or mismatched base SHA");
  if(s.schema!==HUMAN_EXCEPTION_SCHEMA) errors.push("scope_exception.schema must be "+HUMAN_EXCEPTION_SCHEMA);
  if(!Object.hasOwn(policy.lanes||{},s.lane||"")) errors.push("unknown exception lane: "+s.lane);
  return errors;
};
const checkExactBytes=ctx=>{
  const {docket,docketPath,changed}=ctx,errors=[];
  const exact=docket.exact_changed_paths, others=changed.filter(p=>p!==docketPath);
  const exactOk=Array.isArray(exact) && exact.length>0 && new Set(exact).size===exact.length &&
    sameJson(sorted(exact),sorted(others));
  if(!exactOk) errors.push("PR changed paths differ from exact approved paths");
  const digest=exactOk?exceptionDigest(ctx.readHead,others):null;
  if(!RE_DIGEST.test(docket.candidate_digest_sha256||"") || digest!==docket.candidate_digest_sha256) errors.push("PR bytes differ from approved candidate digest");
  return errors;
};
const checkIdentity=ctx=>[...checkDocketBinding(ctx),...checkExactBytes(ctx)];

const checkApprovalDecision=ctx=>{
  const {docket,policy}=ctx,a=docket.human_approval||{},errors=[];
  if(a.case_id!==docket.case_id) errors.push("approval case_id mismatch");
  if(!(policy.accepted_source_kinds||[]).includes(a.source_kind)) errors.push("approval source_kind not accepted: "+a.source_kind);
  if(a.decision!==policy.required_decision || a.scope!==policy.required_scope) errors.push("approval decision/scope is not an exact-candidate decision");
  if(a.candidate_digest_sha256!==docket.candidate_digest_sha256) errors.push("approval bound to a different digest");
  return errors;
};
const checkApprovalAuthority=ctx=>{
  const {docket,policy,now}=ctx,a=docket.human_approval||{},errors=[];
  const placeholder=new RegExp(policy.placeholder_ref_pattern||"$^","i");
  if(!nonEmptyString(a.human_message_ref) || placeholder.test(a.human_message_ref)) errors.push("Human decision reference missing or placeholder");
  if(!(ctx.humanAccounts||[]).includes(a.approver)) errors.push("approver is not a registered Human authority account");
  if(!isUnix(a.approved_at_unix) || a.approved_at_unix>now+(policy.max_clock_skew_seconds||0)) errors.push("approved_at_unix missing or in the future");
  return errors;
};
const checkApproval=ctx=>[...checkApprovalDecision(ctx),...checkApprovalAuthority(ctx)];

const checkExpiry=ctx=>{
  const {docket,policy,now}=ctx,s=docket.scope_exception||{},approved=docket.human_approval?.approved_at_unix;
  if(!isUnix(s.expires_at_unix) || !isUnix(approved)) return ["expires_at_unix required"];
  if(s.expires_at_unix<=approved || s.expires_at_unix-approved>policy.max_ttl_seconds) return ["expiry window invalid or longer than policy max_ttl_seconds"];
  return now>s.expires_at_unix?["exception expired"]:[];
};

const checkCoveredGates=(policy,laneName,covered)=>{
  const lane=policy.lanes[laneName],errors=[];
  const waivable=laneName==="CLOSURE_DEFERRAL"?policy.deferrable_procedural_gates||[]:lane.waivable_gates||[];
  if(!nonEmptyStrings(covered)) return ["scope_exception.covered_gates required"];
  for(const g of covered){
    if((policy.non_waivable_gates||[]).includes(g)) errors.push("non-waivable gate cannot be covered: "+g);
    else if(!waivable.includes(g)) errors.push("gate not waivable in lane "+laneName+": "+g);
  }
  return errors;
};
const checkGovernanceFields=(ctx,laneName)=>{
  const {docket,policy}=ctx,s=docket.scope_exception||{},errors=[];
  for(const key of ["reason","risk","owner","follow_up"]) if(!nonEmptyString(s[key])) errors.push("scope_exception."+key+" required");
  if(!nonEmptyStrings(s.residual_gaps)) errors.push("scope_exception.residual_gaps must list the remaining GAP(s)");
  if(s.never_converts_fail_or_untested_to_pass!==true) errors.push("exception must declare it never converts FAIL/UNTESTED to PASS");
  if(!Array.isArray(s.affected_tasks)) errors.push("scope_exception.affected_tasks must be an array");
  return [...errors,...checkCoveredGates(policy,laneName,s.covered_gates)];
};

const baselineIdOf=p=>p.match(/^build-spec\/baselines\/(BS-P\d+-\d{3})\//)?.[1]||null;

const checkPaths=(ctx,laneName)=>{
  const {docket,docketPath,policy,changed}=ctx,lane=policy.lanes[laneName],errors=[];
  const affectedSprint=docket.scope_exception?.affected_sprint;
  const allowed=expandLaneRules(lane.allowed_paths,affectedSprint);
  const forbidden=[...(policy.global_forbidden_paths||[]),...(lane.forbidden_paths||[])];
  for(const p of changed.filter(x=>x!==docketPath)){
    if(!SAFE_REL.test(p) || p.includes("..")) errors.push("unsafe path: "+p);
    else if(p.startsWith(policy.docket_dir)) errors.push("other dockets are immutable inside an exception: "+p);
    else if(matchesAny(p,forbidden)) errors.push("path forbidden in lane "+laneName+": "+p);
    else if(!matchesAny(p,allowed)) errors.push("path outside lane "+laneName+" allowlist: "+p);
    const bid=baselineIdOf(p);
    if(bid && ctx.existsAtBase("build-spec/baselines/"+bid+"/manifest.json")) errors.push("existing locked baseline is immutable: "+p);
  }
  return errors;
};

const singleTaskDiffError=(t,next,affected)=>{
  if(!affected.includes(t.task_id)) return sameJson(t,next)?null:"unaffected Task changed: "+t.task_id;
  const lifecycleSame=next && t.status===next.status && sameJson(t.completion_evidence,next.completion_evidence);
  return lifecycleSame?null:"SSOT amendment cannot transition Task status/evidence: "+t.task_id;
};
const taskDiffErrors=(beforeTd,afterTd,affected)=>{
  const before=beforeTd?.tasks||[],afterList=afterTd?.tasks||[];
  const after=new Map(afterList.map(t=>[t.task_id,t]));
  const errors=before.map(t=>singleTaskDiffError(t,after.get(t.task_id),affected)).filter(Boolean);
  if(before.length!==afterList.length) errors.unshift("Task count changed; Task creation/removal needs Planning + Activation");
  return errors;
};
const backlogDiffErrors=(beforeQ,afterQ)=>{
  const lifecycle=i=>({id:i.backlog_item_id,status:i.status,sprint:i.sprint_id,r:i.revalidation?.status||null});
  return sameJson((beforeQ?.items||[]).map(lifecycle),(afterQ?.items||[]).map(lifecycle))?[]:
    ["SSOT amendment cannot change Backlog lifecycle status/sprint/revalidation state"];
};

const ssotLaneErrors=ctx=>{
  const s=ctx.docket.scope_exception||{},errors=[];
  if(!["CORRECTION","MATERIAL_PRODUCT_SEMANTIC"].includes(s.semantic_class)) errors.push("semantic_class must be CORRECTION or MATERIAL_PRODUCT_SEMANTIC");
  if(!nonEmptyStrings(s.impact_audit)) errors.push("impact_audit (affected AC/Test/Task bindings) required");
  const newBaseline=ctx.changed.some(p=>{const bid=baselineIdOf(p);return bid && !ctx.existsAtBase("build-spec/baselines/"+bid+"/manifest.json");});
  if(s.semantic_class==="MATERIAL_PRODUCT_SEMANTIC" && (!nonEmptyString(s.design_change_ref) || !newBaseline)){
    errors.push("material Product semantic change requires approved Design reference and a NEW immutable baseline version");
  }
  for(const p of ctx.changed.filter(x=>/^delivery\/sprints\/[^/]+\/tasks\.json$/.test(x))){
    errors.push(...taskDiffErrors(ctx.readBaseJson(p),ctx.readHeadJson(p),s.affected_tasks||[]));
  }
  if(ctx.changed.includes("delivery/backlog/QUEUE.json")){
    errors.push(...backlogDiffErrors(ctx.readBaseJson("delivery/backlog/QUEUE.json"),ctx.readHeadJson("delivery/backlog/QUEUE.json")));
  }
  return errors;
};
const hotfixLaneErrors=ctx=>{
  const s=ctx.docket.scope_exception||{},lane=ctx.policy.lanes.HOTFIX,errors=[];
  if(!nonEmptyString(s.incident_ref)) errors.push("HOTFIX requires incident_ref");
  if(!isUnix(s.retrospective_due_unix)) errors.push("HOTFIX requires retrospective_due_unix");
  for(const g of lane.required_full_gates||[]) if(!(s.required_full_gates||[]).includes(g)) errors.push("HOTFIX must keep full gate: "+g);
  for(const p of ctx.changed.filter(x=>x.startsWith("supabase/migrations/"))){
    if(ctx.existsAtBase(p)) errors.push("HOTFIX migrations are forward-only; existing migration changed: "+p);
  }
  return errors;
};

// BUILD_SPEC_ACTIVATION: second stage of a Human-approved mid-Sprint rebaseline. The new
// baseline must already be merged and LOCKED (stage 1 = PROTECTED_SSOT_AMENDMENT); this stage
// only moves the control pointers. validate-activation still checks the record, approvals,
// Deltas and lineage; only its "Sprint BLOCKED first" precondition is covered.
const RE_BASELINE=/^BS-P\d+-\d{3}$/;
const ACTIVATION_RECORD_RE=/^build-spec\/activations\/[^/]+\.json$/;
const omitKeys=(obj,keys)=>Object.fromEntries(Object.entries(obj||{}).filter(([k])=>!keys.includes(k)));

const activationPointerErrors=(ctx,t)=>{
  const {baseBuild,headBuild}=ctx.state,errors=[];
  if(baseBuild?.active_baseline!==t.from_baseline || headBuild?.active_baseline!==t.to_baseline) errors.push("CURRENT.json must move exactly from_baseline -> to_baseline");
  if(!sameJson(omitKeys(baseBuild,["active_baseline","reason"]),omitKeys(headBuild,["active_baseline","reason"]))) errors.push("CURRENT.json may change only active_baseline (and reason)");
  const manifest=ctx.readBaseJson("build-spec/baselines/"+t.to_baseline+"/manifest.json");
  if(manifest?.status!=="LOCKED" || manifest.supersedes!==t.from_baseline) errors.push("to_baseline must already be merged, LOCKED and supersede from_baseline (freeze it first)");
  return errors;
};
const activationRecordErrors=(ctx,t)=>{
  const rel="build-spec/activations/"+t.to_baseline+".json",records=ctx.changed.filter(p=>ACTIVATION_RECORD_RE.test(p));
  if(records.length!==1 || records[0]!==rel) return ["exactly one Activation Record for to_baseline required: "+rel];
  if(ctx.existsAtBase(rel)) return ["Activation Record already exists at base and is append-only: "+rel];
  const a=ctx.readHeadJson(rel);
  const ok=a?.baseline_id===t.to_baseline && a.previous_baseline===t.from_baseline && a.type==="REBASELINE";
  return ok?[]:["Activation Record must be REBASELINE from_baseline -> to_baseline"];
};
const activationSprintErrors=(ctx,t)=>{
  const {baseSprint,headSprint}=ctx.state,errors=[];
  if(!baseSprint?.active_sprint) return ["BUILD_SPEC_ACTIVATION needs an existing Sprint; use the ordinary Activation flow while HOLD"];
  if(baseSprint.active_build_spec!==t.from_baseline || headSprint?.active_build_spec!==t.to_baseline) errors.push("CURRENT-SPRINT active_build_spec must move from_baseline -> to_baseline");
  if(!sameJson(omitKeys(baseSprint,["active_build_spec","reason"]),omitKeys(headSprint,["active_build_spec","reason"]))) errors.push("active Sprint/Task/status must stay unchanged during BUILD_SPEC_ACTIVATION");
  return errors;
};
const REBIND_FIELDS=["build_spec_id","acceptance_links"];
const taskRebindError=(t,next,affected,{from_baseline,to_baseline})=>{
  if(!next) return "Task removed: "+t.task_id;
  if(t.status==="CLOSED") return sameJson(t,next)?null:"CLOSED Task is immutable: "+t.task_id;
  if(!sameJson(omitKeys(t,REBIND_FIELDS),omitKeys(next,REBIND_FIELDS))) return "Task "+t.task_id+" may change only build_spec_id/acceptance_links";
  const rebound=next.build_spec_id===t.build_spec_id || (t.build_spec_id===from_baseline && next.build_spec_id===to_baseline);
  if(!rebound) return "Task "+t.task_id+" may only rebind from_baseline -> to_baseline";
  const mappingChanged=!sameJson(t.acceptance_links,next.acceptance_links);
  return mappingChanged && !affected.includes(t.task_id)?"AC/Test mapping change requires Task in affected_tasks: "+t.task_id:null;
};
const activationTaskErrors=(ctx,t,s)=>{
  const rel="delivery/sprints/"+s.affected_sprint+"/tasks.json";
  if(!ctx.changed.includes(rel)) return [];
  const before=ctx.readBaseJson(rel)?.tasks||[],afterList=ctx.readHeadJson(rel)?.tasks||[];
  const after=new Map(afterList.map(x=>[x.task_id,x]));
  const errors=before.map(x=>taskRebindError(x,after.get(x.task_id),s.affected_tasks||[],t)).filter(Boolean);
  if(before.length!==afterList.length) errors.push("Task count changed; Task creation/removal needs Planning + Activation");
  return errors;
};
const activationManifestErrors=(ctx,t,s)=>{
  const rel="delivery/sprints/"+s.affected_sprint+"/manifest.json";
  if(!ctx.changed.includes(rel)) return [];
  const before=ctx.readBaseJson(rel),after=ctx.readHeadJson(rel);
  const ok=before?.build_spec_id===t.from_baseline && after?.build_spec_id===t.to_baseline &&
    sameJson(omitKeys(before,["build_spec_id"]),omitKeys(after,["build_spec_id"]));
  return ok?[]:["Sprint manifest may change only build_spec_id from_baseline -> to_baseline"];
};
const activationBacklogErrors=ctx=>{
  const rel="delivery/backlog/QUEUE.json";
  if(!ctx.changed.includes(rel)) return [];
  const before=ctx.readBaseJson(rel)?.items||[],after=ctx.readHeadJson(rel)?.items||[];
  const lifecycle=i=>({id:i.backlog_item_id,status:i.status,sprint:i.sprint_id});
  if(!sameJson(before.map(lifecycle),after.map(lifecycle))) return ["BUILD_SPEC_ACTIVATION cannot change Backlog item status/sprint"];
  const afterById=new Map(after.map(i=>[i.backlog_item_id,i]));
  const rewritten=before.filter(i=>i.revalidation && !sameJson(i.revalidation,afterById.get(i.backlog_item_id)?.revalidation));
  return rewritten.map(i=>"existing revalidation record is immutable: "+i.backlog_item_id);
};
const buildSpecActivationLaneErrors=ctx=>{
  const s=ctx.docket.scope_exception||{},t=s.activation||{},errors=[];
  if(!RE_BASELINE.test(t.from_baseline||"") || !RE_BASELINE.test(t.to_baseline||"") || t.from_baseline===t.to_baseline) errors.push("activation.from_baseline/to_baseline must be two distinct baseline IDs");
  if(!nonEmptyString(s.design_change_ref)) errors.push("approved Design/Delta reference (design_change_ref) required");
  if(!nonEmptyStrings(s.impact_audit)) errors.push("impact_audit (affected AC/Test/Task bindings) required");
  if(errors.length) return errors;
  return [...activationPointerErrors(ctx,t),...activationRecordErrors(ctx,t),...activationSprintErrors(ctx,t),
    ...activationTaskErrors(ctx,t,s),...activationManifestErrors(ctx,t,s),...activationBacklogErrors(ctx)];
};

const closureBindingErrors=(state,s)=>{
  const errors=[],sprintId=state.headSprint?.active_sprint??null;
  if(!nonEmptyStrings(s.affected_tasks)) errors.push("CLOSURE_DEFERRAL requires affected_tasks");
  if(s.affected_build_spec!==state.headSprint?.active_build_spec) errors.push("CLOSURE_DEFERRAL requires affected_build_spec equal to the active Build Spec");
  const sameBinding=state.baseSprint?.active_sprint===sprintId &&
    state.baseSprint?.active_build_spec===state.headSprint?.active_build_spec;
  if(!sameBinding) errors.push("CLOSURE_DEFERRAL cannot switch Sprint/Build binding");
  return errors;
};
const sprintBindingErrors=(state,s,laneName)=>{
  if(laneName==="16P_ACCEPTANCE_LEASE"){
    const errors=[];
    if(s.affected_sprint!=null) errors.push("16P_ACCEPTANCE_LEASE must keep affected_sprint null (Product HOLD; no Sprint4)");
    if(!sameJson(state.baseSprint,state.headSprint))
      errors.push("delivery/CURRENT-SPRINT.json must stay unchanged in lane 16P_ACCEPTANCE_LEASE");
    return errors;
  }
  const errors=(s.affected_sprint??null)!==(state.headSprint?.active_sprint??null)?["exception is bound to a different Sprint than the active Sprint"]:[];
  if(laneName==="BUILD_SPEC_ACTIVATION") return errors;
  if(laneName==="CLOSURE_DEFERRAL") return [...errors,...closureBindingErrors(state,s)];
  return sameJson(state.baseSprint,state.headSprint)?errors:
    [...errors,"delivery/CURRENT-SPRINT.json must stay unchanged in lane "+laneName];
};
const LEASE_FILE="delivery/16p-acceptance-lease/CURRENT.json";
const sixteenPAcceptanceLeaseLaneErrors=ctx=>{
  const s=ctx.docket.scope_exception||{},errors=[];
  const tasks=s.affected_tasks||[];
  if(tasks.length!==1||tasks[0]!=="T016") errors.push("16P_ACCEPTANCE_LEASE requires affected_tasks exactly [\"T016\"]");
  if(s.product_hold_preserved!==true) errors.push("scope_exception.product_hold_preserved must be true");
  if(s.sprint4_forbidden!==true) errors.push("scope_exception.sprint4_forbidden must be true");
  if(s.direct_connector_prewrite_proven===true)
    errors.push("scope_exception must not claim direct_connector_prewrite_proven");
  const leasePaths=ctx.changed.filter(p=>p.startsWith("delivery/16p-acceptance-lease/"));
  if(!leasePaths.includes(LEASE_FILE)) errors.push("16P_ACCEPTANCE_LEASE requires "+LEASE_FILE);
  if(leasePaths.some(p=>p!==LEASE_FILE)) errors.push("only "+LEASE_FILE+" may change under delivery/16p-acceptance-lease/");
  const lease=ctx.readHeadJson(LEASE_FILE);
  const pol=ctx.readHeadJson(GOVERNANCE_REFORM_POLICY_PATH)?.sixteen_p_acceptance_lease||
    ctx.readBaseJson(GOVERNANCE_REFORM_POLICY_PATH)?.sixteen_p_acceptance_lease||{};
  // Inline minimal checks (avoid import cycle with 16p-acceptance-lease.mjs).
  if(lease?.schema!==(pol.lease_schema||"APPF2-16P-ACCEPTANCE-LEASE-1")) errors.push("lease schema invalid");
  if(lease?.task_id!=="T016") errors.push("lease.task_id must be T016");
  if(["T006","T008","T009"].includes(lease?.task_id)) errors.push("lease reuses forbidden Task");
  if(lease?.bound_sprint_id!=null) errors.push("lease.bound_sprint_id must be null");
  if(lease?.product_hold_preserved!==true||lease?.sprint4_forbidden!==true)
    errors.push("lease must preserve Product HOLD and forbid Sprint4");
  if(lease?.direct_connector_prewrite_proven===true)
    errors.push("lease must not self-attest connector prewrite proven");
  if(!["PENDING","ACTIVE","EXPIRED","REVOKED"].includes(lease?.status||""))
    errors.push("lease.status invalid");
  if(lease?.never_converts_fail_or_untested_to_pass!==true)
    errors.push("lease never_converts_fail_or_untested_to_pass required");
  return errors;
};
const laneSpecificErrors={
  GOVERNANCE_REFORM:ctx=>(ctx.docket.scope_exception?.affected_tasks||[]).length?["GOVERNANCE_REFORM cannot claim Task authority"]:[],
  PROTECTED_SSOT_AMENDMENT:ssotLaneErrors,
  BUILD_SPEC_ACTIVATION:buildSpecActivationLaneErrors,
  HOTFIX:hotfixLaneErrors,
  "16P_ACCEPTANCE_LEASE":sixteenPAcceptanceLeaseLaneErrors
};
const checkLaneState=(ctx,laneName)=>{
  const {state,docket}=ctx,s=docket.scope_exception||{},errors=[];
  if(laneName!=="BUILD_SPEC_ACTIVATION" && !sameJson(state.baseBuild,state.headBuild)) errors.push("build-spec/CURRENT.json must stay unchanged; only BUILD_SPEC_ACTIVATION may move it");
  errors.push(...sprintBindingErrors(state,s,laneName));
  errors.push(...(laneSpecificErrors[laneName]?.(ctx)||[]));
  return errors;
};

/** Pure evaluation; every input is injected so the self-test matrix is deterministic. */
export function evaluateHumanException(ctx){
  const lane=ctx.docket?.scope_exception?.lane;
  const errors=checkIdentity(ctx);
  if(Object.hasOwn(ctx.policy.lanes||{},lane||"")){
    errors.push(...checkApproval(ctx),...checkExpiry(ctx),...checkGovernanceFields(ctx,lane),
      ...checkPaths(ctx,lane),...checkLaneState(ctx,lane));
  }
  const covered=errors.length?[]:[...ctx.docket.scope_exception.covered_gates];
  return {applies:true,ok:errors.length===0,lane:lane||null,caseId:ctx.docket?.case_id||null,
    docketPath:ctx.docketPath,coveredGates:covered,errors};
}

const waiverScopeErrors=(s,{policy,gateId,taskId,sprintId,buildSpecId})=>{
  const errors=[];
  if(!(policy.deferrable_procedural_gates||[]).includes(gateId) || !(s.covered_gates||[]).includes(gateId)) errors.push("gate "+gateId+" not covered");
  if(!(s.affected_tasks||[]).includes(taskId)) errors.push("Task "+taskId+" out of scope");
  if(s.affected_sprint!==sprintId) errors.push("Sprint "+sprintId+" out of scope");
  if(s.affected_build_spec!==buildSpecId) errors.push("Build Spec "+buildSpecId+" out of scope");
  if(s.never_converts_fail_or_untested_to_pass!==true || !nonEmptyStrings(s.residual_gaps)) errors.push("fake-green / residual GAP declaration missing");
  return errors;
};
const waiverRegistryErrors=(d,{fileName,revokedIds,digestCounts})=>{
  const errors=[];
  if(fileName!==undefined && fileName!==d.case_id+".json") errors.push("docket file name does not match case_id");
  if(!RE_DIGEST.test(d.candidate_digest_sha256||"")) errors.push("candidate digest missing");
  if(revokedIds?.has(d.case_id)) errors.push("revoked");
  if((digestCounts?.get(d.candidate_digest_sha256)||0)>1) errors.push("replay: digest bound by more than one docket");
  return errors;
};
/**
 * Use-time validation of a merged CLOSURE_DEFERRAL docket. Re-checked on every gate run:
 * a docket that is expired, revoked, replayed, out of scope or not exactly Human-approved
 * defers nothing.
 */
export function persistentWaiverErrors(d,query){
  const s=d?.scope_exception||{};
  if(s.schema!==HUMAN_EXCEPTION_SCHEMA || s.lane!=="CLOSURE_DEFERRAL") return ["not a CLOSURE_DEFERRAL docket"];
  const ctx={docket:d,policy:query.policy,now:query.now,humanAccounts:query.accounts};
  return [...waiverScopeErrors(s,query),...waiverRegistryErrors(d,query),
    ...checkApproval(ctx),...checkExpiry(ctx),...checkCoveredGates(query.policy,"CLOSURE_DEFERRAL",s.covered_gates)];
}
export const isPersistentProceduralWaiver=(d,query)=>persistentWaiverErrors(d,query).length===0;

const readJsonFile=abs=>{
  try{return JSON.parse(fs.readFileSync(abs,"utf8"));}catch{return null;}
};
export function loadGovernanceReformPolicy(root){
  return readJsonFile(path.join(root,GOVERNANCE_REFORM_POLICY_PATH));
}
const loadDockets=dir=>fs.existsSync(dir)?
  fs.readdirSync(dir).filter(f=>f.endsWith(".json")).map(fileName=>({fileName,docket:readJsonFile(path.join(dir,fileName))})).filter(x=>x.docket):[];
/** Returns valid and rejected CLOSURE_DEFERRAL dockets for one gate/Task/Sprint/Build at time `now`. */
export function findPersistentProceduralWaivers({root,gateId,taskId,sprintId,buildSpecId,now=Math.floor(Date.now()/1000)}){
  const full=loadGovernanceReformPolicy(root);
  if(!full?.exception) return {valid:[],rejected:[]};
  const entries=loadDockets(path.join(root,full.exception.docket_dir));
  const revokedIds=new Set(entries.flatMap(x=>Array.isArray(x.docket.revokes_exception_case_ids)?x.docket.revokes_exception_case_ids:[]));
  const digestCounts=new Map();
  for(const {docket} of entries) if(docket.candidate_digest_sha256) digestCounts.set(docket.candidate_digest_sha256,(digestCounts.get(docket.candidate_digest_sha256)||0)+1);
  const candidates=entries.filter(x=>x.docket.scope_exception?.lane==="CLOSURE_DEFERRAL" && (x.docket.scope_exception.covered_gates||[]).includes(gateId));
  const query={policy:full.exception,accounts:full.human_authority_accounts,gateId,taskId,sprintId,buildSpecId,now,revokedIds,digestCounts};
  const results=candidates.map(x=>({case_id:x.docket.case_id,errors:persistentWaiverErrors(x.docket,{...query,fileName:x.fileName})}));
  return {valid:results.filter(r=>!r.errors.length).map(r=>r.case_id),rejected:results.filter(r=>r.errors.length)};
}
export const hasPersistentProceduralWaiver=query=>findPersistentProceduralWaivers(query).valid.length>0;

const gitShow=(base,rel)=>{
  if(!RE_SHA.test(base||"") || !SAFE_REL.test(rel)) return null;
  try{return execFileSync("git",["show",base+":"+rel],{maxBuffer:64*1024*1024,stdio:["ignore","pipe","ignore"]});}catch{return null;}
};
const gitListDir=(base,dir)=>{
  try{return execFileSync("git",["ls-tree","--name-only",base,dir],{encoding:"utf8",stdio:["ignore","pipe","ignore"]}).trim().split("\n").filter(Boolean);}
  catch{return [];}
};
const parseJson=buf=>{
  if(!buf) return null;
  try{return JSON.parse(buf.toString("utf8"));}catch{return null;}
};

/** Locate changed dockets that declare (or used to declare) a scope_exception. */
const exceptionDocketsIn=({changed,dir,readHeadJson,readBaseJson})=>
  changed.filter(p=>p.startsWith(dir) && p.endsWith(".json") &&
    (readHeadJson(p)?.scope_exception || readBaseJson(p)?.scope_exception));

/** Repository adapter: BASE policy governs lanes, so a PR can never widen its own lane. */
export function resolveRepoException({root,base,changed,state,now=Math.floor(Date.now()/1000)}){
  const readHead=rel=>{
    if(!SAFE_REL.test(rel) || rel.includes("..")) return null;
    try{return fs.readFileSync(path.join(root,rel));}catch{return null;}
  };
  const readHeadJson=rel=>parseJson(readHead(rel));
  const readBaseJson=rel=>parseJson(gitShow(base,rel));
  const basePolicy=readBaseJson(GOVERNANCE_REFORM_POLICY_PATH);
  const full=basePolicy||readHeadJson(GOVERNANCE_REFORM_POLICY_PATH);
  const policySource=basePolicy?"BASE":"HEAD_BOOTSTRAP";
  if(!full?.exception) return {applies:false,ok:false,errors:[],policySource};
  const policy=full.exception;
  const dockets=exceptionDocketsIn({changed,dir:policy.docket_dir,readHeadJson,readBaseJson});
  if(!dockets.length) return {applies:false,ok:false,errors:[],policySource};
  if(dockets.length!==1) return {applies:true,ok:false,errors:["exactly one exception docket per PR"],policySource};
  const docketPath=dockets[0],docket=readHeadJson(docketPath);
  if(!docket) return {applies:true,ok:false,errors:["exception dockets are append-only; deletion/invalid JSON rejected"],policySource};
  const baseDigests=new Set(gitListDir(base,policy.docket_dir)
    .map(rel=>readBaseJson(rel)?.candidate_digest_sha256).filter(Boolean));
  const result=evaluateHumanException({
    changed,base,policy,humanAccounts:full.human_authority_accounts,docketPath,docket,
    isNewDocket:!gitShow(base,docketPath),baseDigests,readHead,readHeadJson,readBaseJson,
    existsAtBase:rel=>Boolean(gitShow(base,rel)),state,now
  });
  return {...result,policySource};
}
