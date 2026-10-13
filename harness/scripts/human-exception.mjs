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

const sprintBindingErrors=(state,s,laneName)=>{
  const sprintId=state.headSprint?.active_sprint??null,errors=[];
  if((s.affected_sprint??null)!==sprintId) errors.push("exception is bound to a different Sprint than the active Sprint");
  if(laneName!=="CLOSURE_DEFERRAL"){
    return sameJson(state.baseSprint,state.headSprint)?errors:
      [...errors,"delivery/CURRENT-SPRINT.json must stay unchanged in lane "+laneName];
  }
  if(!nonEmptyStrings(s.affected_tasks)) errors.push("CLOSURE_DEFERRAL requires affected_tasks");
  const sameBinding=state.baseSprint?.active_sprint===sprintId &&
    state.baseSprint?.active_build_spec===state.headSprint?.active_build_spec;
  if(!sameBinding) errors.push("CLOSURE_DEFERRAL cannot switch Sprint/Build binding");
  return errors;
};
const laneSpecificErrors={
  GOVERNANCE_REFORM:ctx=>(ctx.docket.scope_exception?.affected_tasks||[]).length?["GOVERNANCE_REFORM cannot claim Task authority"]:[],
  PROTECTED_SSOT_AMENDMENT:ssotLaneErrors,
  HOTFIX:hotfixLaneErrors
};
const checkLaneState=(ctx,laneName)=>{
  const {state,docket}=ctx,s=docket.scope_exception||{},errors=[];
  if(!sameJson(state.baseBuild,state.headBuild)) errors.push("build-spec/CURRENT.json must stay unchanged; Activation is a separate authority");
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

const approvalComplete=(d,policy,accounts)=>{
  const a=d?.human_approval||{};
  return a.case_id===d.case_id && (policy.accepted_source_kinds||[]).includes(a.source_kind) &&
    a.decision===policy.required_decision && a.scope===policy.required_scope &&
    RE_DIGEST.test(d.candidate_digest_sha256||"") && a.candidate_digest_sha256===d.candidate_digest_sha256 &&
    nonEmptyString(a.human_message_ref) && (accounts||[]).includes(a.approver) && isUnix(a.approved_at_unix);
};
/** A merged CLOSURE_DEFERRAL docket keeps deferring exactly its named procedural gate for its named Task. */
export const isPersistentProceduralWaiver=(d,{policy,accounts,gateId,taskId,sprintId})=>{
  const s=d?.scope_exception||{};
  return s.schema===HUMAN_EXCEPTION_SCHEMA && s.lane==="CLOSURE_DEFERRAL" &&
    (policy.deferrable_procedural_gates||[]).includes(gateId) &&
    Array.isArray(s.covered_gates) && s.covered_gates.includes(gateId) &&
    Array.isArray(s.affected_tasks) && s.affected_tasks.includes(taskId) &&
    s.affected_sprint===sprintId && s.never_converts_fail_or_untested_to_pass===true &&
    nonEmptyStrings(s.residual_gaps) && approvalComplete(d,policy,accounts);
};

const readJsonFile=abs=>{
  try{return JSON.parse(fs.readFileSync(abs,"utf8"));}catch{return null;}
};
export function loadGovernanceReformPolicy(root){
  return readJsonFile(path.join(root,GOVERNANCE_REFORM_POLICY_PATH));
}
export function hasPersistentProceduralWaiver({root,gateId,taskId,sprintId}){
  const full=loadGovernanceReformPolicy(root);
  if(!full?.exception) return false;
  const dir=path.join(root,full.exception.docket_dir);
  if(!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).filter(f=>f.endsWith(".json")).some(f=>isPersistentProceduralWaiver(
    readJsonFile(path.join(dir,f)),
    {policy:full.exception,accounts:full.human_authority_accounts,gateId,taskId,sprintId}));
}

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
