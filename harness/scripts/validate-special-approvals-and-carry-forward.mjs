// GOV-392: permanent Special Approval / Carry-Forward register, fail-closed Change Review
// and truthful ADMINISTRATIVE_WITH_CARRY_FORWARD Sprint closure.
// CI verifies structure, links, bytes and immutability only. It cannot prove that an
// approval reference comes from a person: independent BCE plus a Human provenance check
// remain mandatory before any merge. Nothing here converts FAIL/UNTESTED/BLOCKED to PASS.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { exceptionDigest, sameJson, GOVERNANCE_REFORM_POLICY_PATH } from "./human-exception.mjs";

export const CARRY_FORWARD_SCHEMA="APPF2-CARRY-FORWARD-1";
export const ADMIN_CLOSURE_SCHEMA="APPF2-ADMIN-CLOSURE-1";
export const ADMIN_CLOSURE="ADMINISTRATIVE_WITH_CARRY_FORWARD";
export const CARRY_FORWARD_MODULE_PATH="harness/scripts/validate-special-approvals-and-carry-forward.mjs";
export const CARRY_FORWARD_GATE_MARKER="GOV-392 special-approval / carry-forward Change Review";

const RE_SHA=/^[0-9a-f]{40}$/;
const RE_DIGEST=/^[0-9a-f]{64}$/;
const RE_CASE=/^GOV-[A-Z0-9-]{3,90}$/;
const RE_SPRINT=/^SP-P(\d+)-(\d{3})$/;
const RE_TASK=/^T\d{3}$/;
const RE_BACKLOG=/^BL-P\d+-\d{3}$/;
const RE_AC=/^F\d{2}-AC-\d{3}$/;
const RE_TEST=/^TEST-[A-Z0-9-]+$/;
const RE_MANIFEST=/^delivery\/sprints\/(SP-P\d+-\d{3})\/manifest\.json$/;
const RE_TASKS=/^delivery\/sprints\/(SP-P\d+-\d{3})\/tasks\.json$/;
const SAFE_REL=/^[a-zA-Z0-9/_.@-]+$/;
const OPEN_ROW=new Set(["OPEN","BLOCKED","UNTESTED"]);
const IMMUTABLE_ROW_KEYS=["id","row_schema","source","human_decision","waived_gate","reason"];

const str=v=>typeof v==="string" && v.trim().length>0;
const strs=v=>Array.isArray(v) && v.length>0 && v.every(str);
const isUnix=v=>Number.isSafeInteger(v) && v>0;
const sorted=xs=>[...xs].sort();
const unique=xs=>new Set(xs).size===xs.length;
const omit=(o,keys)=>Object.fromEntries(Object.entries(o||{}).filter(([k])=>!keys.includes(k)));
const canonical=v=>{
  if(Array.isArray(v)) return v.map(canonical);
  if(v && typeof v==="object") return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));
  return v;
};
const isStrictRow=r=>r?.row_schema===CARRY_FORWARD_SCHEMA;
const placeholderOf=full=>new RegExp(full?.exception?.placeholder_ref_pattern||"$^","i");
const sprintOrder=sid=>{const m=RE_SPRINT.exec(sid||"");return m?Number(m[1])*1000+Number(m[2]):-1;};
const acceptancePairs=row=>(Array.isArray(row?.acceptance)?row.acceptance:[]).map(a=>a?.acceptance_id+"::"+a?.test_id);

/** Freezes a carried-forward Task's AC/Test/Evidence bytes at the moment of Human closure approval. */
export const taskSnapshotDigest=t=>createHash("sha256").update(JSON.stringify(canonical({
  task_id:t?.task_id,status:t?.status,build_spec_id:t?.build_spec_id,
  acceptance_links:t?.acceptance_links??null,completion_evidence:t?.completion_evidence??null
}))).digest("hex");

// ---------------------------------------------------------------- register rows

const decisionErrors=(d,label,placeholder)=>{
  if(!d || typeof d!=="object") return [label+" human_decision must be an object"];
  const e=[];
  if(!RE_CASE.test(d.case_id||"")) e.push(label+" human_decision.case_id invalid");
  if(!str(d.human_message_ref) || placeholder.test(d.human_message_ref)) e.push(label+" human_decision.human_message_ref missing or placeholder");
  if(!isUnix(d.approved_at_unix)) e.push(label+" human_decision.approved_at_unix required");
  if(d.expires_at_unix!==null && !isUnix(d.expires_at_unix)) e.push(label+" human_decision.expires_at_unix must be null (permanent) or unix time");
  if(isUnix(d.expires_at_unix) && isUnix(d.approved_at_unix) && d.expires_at_unix<=d.approved_at_unix) e.push(label+" human_decision expiry precedes approval");
  return e;
};
const sourceErrors=(s,label,cf)=>{
  const e=[];
  if(!(cf.source_kinds||[]).includes(s.kind)) e.push(label+" source.kind invalid: "+s.kind);
  if(s.sprint_id!==null && !RE_SPRINT.test(s.sprint_id||"")) e.push(label+" source.sprint_id invalid");
  if(s.task_id!==null && !RE_TASK.test(s.task_id||"")) e.push(label+" source.task_id invalid");
  if(!Array.isArray(s.backlog_item_ids) || !s.backlog_item_ids.every(x=>RE_BACKLOG.test(x||""))) e.push(label+" source.backlog_item_ids must be a list of Backlog IDs");
  if(!strs(s.refs)) e.push(label+" source.refs must list the originating PR/Issue/Sprint/audit references");
  return e;
};
const acceptanceEntryErrors=(a,label,cf)=>{
  const e=[];
  if(!RE_AC.test(a?.acceptance_id||"") || !RE_TEST.test(a?.test_id||"")) e.push(label+" acceptance/test identifier invalid");
  if(!(cf.evidence_statuses||[]).includes(a?.evidence_status)) e.push(label+" evidence_status invalid: "+a?.evidence_status);
  if(!Array.isArray(a?.evidence_refs) || !a.evidence_refs.every(str)) e.push(label+" evidence_refs must be an array of references");
  return e;
};
const acceptanceErrors=(row,label,cf)=>{
  if(!Array.isArray(row.acceptance)) return [label+" acceptance must be an array"];
  const e=[];
  for(const a of row.acceptance) e.push(...acceptanceEntryErrors(a,label,cf));
  if(!unique(acceptancePairs(row))) e.push(label+" duplicate Acceptance/Test pair");
  return e;
};
const waiverErrors=(row,label,ctx)=>{
  if(row.waived_gate===null) return [];
  if(!str(row.waived_gate)) return [label+" waived_gate must be null or a gate id"];
  const e=[];
  if(row.human_decision===null) e.push(label+" waived gate "+row.waived_gate+" requires an exact Human decision reference");
  if((ctx.nonWaivable||[]).includes(row.waived_gate)) e.push(label+" non-waivable gate cannot be waived: "+row.waived_gate);
  const exp=row.human_decision?.expires_at_unix;
  if(isUnix(exp) && ctx.now>exp && row.status!=="RESOLVED") e.push(label+" expired approval: "+row.waived_gate+" is no longer waived; resolve the row or record a permanent Human disposition");
  return e;
};
const nextPhaseErrors=(np,label,placeholder)=>{
  if(!np || !str(np.target)) return [label+" next_phase.target required"];
  if(np.decided_by_human===true) return str(np.decision_ref) && !placeholder.test(np.decision_ref)?[]:[label+" Human-decided next_phase requires a non-placeholder decision_ref"];
  return np.target==="PENDING_PRODUCT_ALIGNMENT"?[]:[label+" next_phase not decided by Human must be PENDING_PRODUCT_ALIGNMENT"];
};
const resolutionErrors=(row,label)=>{
  const acc=Array.isArray(row.acceptance)?row.acceptance:[];
  if(row.status!=="RESOLVED"){
    const e=row.resolution===null || row.resolution===undefined?[]:[label+" unresolved row may not carry a resolution"];
    if(row.status==="UNTESTED" && !acc.some(a=>a?.evidence_status==="UNTESTED")) e.push(label+" UNTESTED row must name the UNTESTED Acceptance (no fake PASS)");
    return e;
  }
  const r=row.resolution||{},e=[];
  if(!strs(r.evidence_refs) || !str(r.resolution_ref) || !isUnix(r.resolved_at_unix)) e.push(label+" RESOLVED requires resolution.evidence_refs, resolution_ref and resolved_at_unix");
  if(acc.some(a=>a?.evidence_status!=="PASS")) e.push(label+" RESOLVED while an Acceptance is not PASS (fake-green)");
  return e;
};

const carryForwardStructuralErrors=(row,label,cf,placeholder)=>{
  const e=[];
  if(!new RegExp(cf.id_pattern).test(row?.id||"")) e.push(label+" id must match "+cf.id_pattern);
  if(!str(row.title)) e.push(label+" title required");
  if(!(cf.row_statuses||[]).includes(row.status)) e.push(label+" status invalid: "+row.status);
  for(const k of ["reason","risk","owner","completion_criterion"]) if(!str(row[k])) e.push(label+" "+k+" required");
  if(row.human_decision!==null) e.push(...decisionErrors(row.human_decision,label,placeholder));
  if(!Array.isArray(row.history) || !row.history.length ||
     !row.history.every(h=>isUnix(h?.at_unix) && str(h?.event) && str(h?.ref))) e.push(label+" history must be a non-empty list of {at_unix,event,ref}");
  return e;
};
/** Strict validation of one APPF2-CARRY-FORWARD-1 row. */
export function carryForwardRowErrors(row,ctx){
  const cf=ctx.cf,label="carry-forward "+(row?.id||"<missing id>"),placeholder=ctx.placeholder;
  return [...carryForwardStructuralErrors(row,label,cf,placeholder),
    ...sourceErrors(row.source||{},label,cf),...acceptanceErrors(row,label,cf),
    ...waiverErrors(row,label,ctx),...nextPhaseErrors(row.next_phase,label,placeholder),...resolutionErrors(row,label)];
}
/** Cross-checks a row against real Sprint/Task/Backlog truth: no phantom AC, no fake CLOSED/DONE. */
const mappedTaskTruthErrors=(row,s,sp,label)=>{
  const e=[],t=(sp.td?.tasks||[]).find(x=>x.task_id===s.task_id);
  if(!t) return [label+" source Task not found: "+s.sprint_id+"/"+s.task_id];
  const mapped=new Set((t.acceptance_links||[]).map(l=>l.acceptance_id+"::"+l.test_id));
  for(const pair of acceptancePairs(row)) if(!mapped.has(pair)) e.push(label+" phantom Acceptance not mapped to "+s.task_id+": "+pair);
  if(OPEN_ROW.has(row.status) && t.status==="CLOSED" && (row.acceptance||[]).some(a=>a?.evidence_status!=="PASS")){
    e.push(label+" Task "+s.task_id+" is CLOSED while its carry-forward Acceptance is not PASS (fake closure)");
  }
  return e;
};
const mappedBacklogTruthErrors=(row,s,ctx,label)=>{
  const e=[];
  for(const bid of s.backlog_item_ids||[]){
    const bi=ctx.backlogById?.get(bid);
    if(!bi){e.push(label+" unknown Backlog item "+bid); continue;}
    if(OPEN_ROW.has(row.status) && s.kind==="BACKLOG" && bi.status==="DONE") e.push(label+" Backlog "+bid+" is DONE while its carry-forward row is open; resolve the row with evidence");
    if(OPEN_ROW.has(row.status) && s.kind==="REVALIDATION" && ["VERIFIED","CLOSED"].includes(bi.revalidation?.status)) e.push(label+" revalidation "+bid+" is complete while its carry-forward row is open; resolve the row with evidence");
  }
  return e;
};
export function rowTruthErrors(row,ctx){
  const s=row.source||{},label="carry-forward "+row.id;
  if(!s.sprint_id || !ctx.sprints) return [];
  const sp=ctx.sprints.get(s.sprint_id);
  if(!sp) return [label+" source Sprint not found: "+s.sprint_id];
  return [
    ...(s.task_id?mappedTaskTruthErrors(row,s,sp,label):[]),
    ...mappedBacklogTruthErrors(row,s,ctx,label)
  ];
}
/** Whole-register validation at HEAD. Legacy POI rows keep their format; only IDs must be unique. */
export function registerErrors(register,ctx){
  const items=Array.isArray(register?.items)?register.items:null;
  if(!items) return ["carry-forward register "+ctx.cf.register_path+" must contain items[]"];
  const e=[],seen=new Set();
  for(const row of items){
    if(!str(row?.id)){e.push("register row without id"); continue;}
    if(seen.has(row.id)) e.push("duplicate register id "+row.id);
    seen.add(row.id);
  }
  for(const row of items.filter(isStrictRow)) e.push(...carryForwardRowErrors(row,ctx),...rowTruthErrors(row,ctx));
  return e;
}

// ---------------------------------------------------------------- Change Review (diff)

const strictRowDiffErrors=(id,before,after)=>{
  if(!isStrictRow(after)) return ["register row "+id+" lost "+CARRY_FORWARD_SCHEMA];
  if(before.status==="RESOLVED") return sameJson(before,after)?[]:["RESOLVED register row is immutable: "+id];
  const e=[];
  for(const k of IMMUTABLE_ROW_KEYS) if(!sameJson(before[k],after[k])) e.push("register row "+id+" field "+k+" is immutable");
  if(!sameJson(sorted(acceptancePairs(before)),sorted(acceptancePairs(after)))) e.push("register row "+id+" Acceptance/Test set is immutable");
  const bh=Array.isArray(before.history)?before.history:[],ah=Array.isArray(after.history)?after.history:[];
  const appendOnly=ah.length>=bh.length && bh.every((h,i)=>sameJson(h,ah[i]));
  if(!appendOnly) e.push("register row "+id+" history is append-only");
  else if(ah.length===bh.length && !sameJson(before,after)) e.push("register row "+id+" changed without a new history entry");
  return e;
};
/** Rows are never deleted; strict rows keep identity, Human decision and append-only history. */
export function registerDiffErrors(baseReg,headReg){
  const before=new Map((baseReg?.items||[]).map(r=>[r.id,r])),after=new Map((headReg?.items||[]).map(r=>[r.id,r])),e=[];
  for(const [id,r] of before){
    const n=after.get(id);
    if(!n) e.push("register row deleted: "+id);
    else if(isStrictRow(r)) e.push(...strictRowDiffErrors(id,r,n));
  }
  for(const [id,n] of after) if(!before.has(id) && !isStrictRow(n)) e.push("new register row must use "+CARRY_FORWARD_SCHEMA+": "+id);
  return e;
}

const linksDocket=(row,caseId)=>row?.human_decision?.case_id===caseId || (row?.source?.refs||[]).some(x=>String(x).includes(caseId));
const zeroGapErrors=(docket,p)=>{
  const c=docket.carry_forward,e=[];
  if(Array.isArray(c.ids) && c.ids.length) e.push(p+" zero_gap declaration cannot also list carry-forward ids");
  if(!str(c.justification) || c.justification.trim().length<20) e.push(p+" zero_gap declaration requires a justification of at least 20 characters");
  if(docket.deferred_acceptance_id || docket.closure_disposition) e.push(p+" zero_gap is impossible for a deferred Acceptance or Sprint closure docket");
  const s=docket.scope_exception;
  if(s?.lane==="CLOSURE_DEFERRAL") e.push(p+" zero_gap is impossible for a CLOSURE_DEFERRAL docket");
  if(s && !(Array.isArray(s.residual_gaps) && s.residual_gaps.length===1 && s.residual_gaps[0]==="NONE")) e.push(p+" zero_gap requires scope_exception.residual_gaps exactly [\"NONE\"]");
  return e;
};
/** A NEW docket that creates, defers or waives an obligation must link registered carry-forward rows. */
const linkedDocketRowErrors=(docket,p,headReg,ids)=>{
  const rows=new Map((headReg?.items||[]).map(r=>[r.id,r])),e=[];
  for(const id of ids){
    const r=rows.get(id);
    if(!r) e.push(p+" carry-forward id missing from register: "+id);
    else if(!isStrictRow(r)) e.push(p+" carry-forward row "+id+" must use "+CARRY_FORWARD_SCHEMA);
    else if(r.status==="RESOLVED") e.push(p+" carry-forward row "+id+" is already RESOLVED");
    else if(!linksDocket(r,docket.case_id)) e.push(p+" register row "+id+" does not link back to "+docket.case_id);
  }
  return e;
};
export function docketCarryForwardErrors(docket,p,headReg,cf){
  if(!(cf.obligation_docket_markers||[]).some(k=>Object.hasOwn(docket,k))) return [];
  if(docket.closure_disposition && docket.carry_forward) return [p+" closure docket lists carry-forward only in administrative_closure.carry_forward_ids"];
  const c=docket.closure_disposition?{ids:docket.administrative_closure?.carry_forward_ids}:docket.carry_forward;
  if(!c || typeof c!=="object") return [p+" creates/defers/waives an obligation without a carry_forward declaration (silent carry-forward)"];
  if(c.zero_gap===true) return zeroGapErrors(docket,p);
  if(!Array.isArray(c.ids) || !c.ids.length || !unique(c.ids)) return [p+" carry_forward.ids must list unique register IDs (or an explicit zero_gap declaration)"];
  return linkedDocketRowErrors(docket,p,headReg,c.ids);
}
const holdState=cs=>cs?.status==="HOLD" && cs.active_sprint===null && cs.active_build_spec===null && cs.active_task===null;
const adminTransitionDocketErrors=(ctx,docket,others,L)=>{
  const {base,readHead,baseDocketDigests}=ctx,e=[];
  const exact=docket.exact_changed_paths;
  if(!Array.isArray(exact) || !unique(exact) || !sameJson(sorted(exact),sorted(others))) e.push(L+" PR changed paths differ from the docket's exact_changed_paths");
  if(!RE_DIGEST.test(docket.candidate_digest_sha256||"") || exceptionDigest(readHead,others)!==docket.candidate_digest_sha256) e.push(L+" PR bytes differ from the approved candidate digest");
  if(baseDocketDigests.has(docket.candidate_digest_sha256)) e.push(L+" replay: candidate digest already bound by an earlier docket");
  if(!RE_SHA.test(base||"") || docket.base_sha!==base) e.push(L+" docket base_sha must equal the PR base");
  return e;
};
const adminTransitionStateErrors=(ctx,sid,after,L)=>{
  const {readBaseJson,readHeadJson}=ctx,e=[];
  const baseBuild=readBaseJson("build-spec/CURRENT.json"),headBuild=readHeadJson("build-spec/CURRENT.json");
  if(!holdState(readHeadJson("delivery/CURRENT-SPRINT.json"))) e.push(L+" must move CURRENT-SPRINT to HOLD with no Sprint/Build Spec/Task binding");
  if(headBuild?.implementation_enabled!==false || !sameJson(omit(baseBuild,["implementation_enabled","reason"]),omit(headBuild,["implementation_enabled","reason"]))) e.push(L+" may only set build-spec/CURRENT.json implementation_enabled=false (and reason)");
  const listed=new Set(after.administrative_closure?.carry_forward_ids||[]);
  for(const r of (ctx.headReg?.items||[]).filter(r=>isStrictRow(r) && r.source?.sprint_id===sid && r.status!=="RESOLVED")){
    if(!listed.has(r.id)) e.push(L+" silent carry-forward omission: open register row "+r.id+" not listed");
  }
  return e;
};
const adminTransitionErrors=(ctx,sid,after)=>{
  const {cf,changed,readBaseJson,readHeadJson}=ctx;
  const caseId=after.administrative_closure?.case_id,docketPath=cf.docket_dir+caseId+".json";
  const L=sid+" administrative closure transition";
  if(!RE_CASE.test(caseId||"")) return [L+" case_id invalid"];
  const docket=readHeadJson(docketPath);
  if(!changed.includes(docketPath) || readBaseJson(docketPath) || !docket) return [L+" requires its Human closure docket to be added in the same PR (replay/tamper otherwise): "+docketPath];
  return [...adminTransitionDocketErrors(ctx,docket,changed.filter(p=>p!==docketPath),L),
    ...adminTransitionStateErrors(ctx,sid,after,L)];
};
const sprintDiffErrors=(ctx)=>{
  const e=[];
  for(const p of ctx.changed){
    const mm=RE_MANIFEST.exec(p),tm=RE_TASKS.exec(p);
    const sid=mm?.[1]||tm?.[1];
    if(!sid) continue;
    const baseManifest=ctx.readBaseJson("delivery/sprints/"+sid+"/manifest.json");
    if(baseManifest?.closure_disposition===ADMIN_CLOSURE){ e.push("administratively CLOSED Sprint record is immutable: "+p); continue; }
    if(!mm) continue;
    const after=ctx.readHeadJson(p);
    if(after?.closure_disposition===ADMIN_CLOSURE && baseManifest?.status!=="CLOSED") e.push(...adminTransitionErrors(ctx,sid,after));
  }
  return e;
};
const suppressionErrors=ctx=>{
  const e=[];
  if(ctx.headPolicyFull?.carry_forward?.enforced!==true) e.push("suppression: HEAD policy removes or disables carry_forward enforcement");
  if(ctx.changed.includes(CARRY_FORWARD_MODULE_PATH) && !ctx.readHead(CARRY_FORWARD_MODULE_PATH)) e.push("suppression: carry-forward validator deleted");
  if(ctx.changed.includes("harness/scripts/governance-gate.mjs")){
    const src=ctx.readHead("harness/scripts/governance-gate.mjs")?.toString("utf8")||"";
    const wired=["./validate-special-approvals-and-carry-forward.mjs","inspectRepoCarryForwardChange(","validateRepoCarryForwardRegister(","runCarryForwardSelfTests("].every(x=>src.includes(x));
    if(!wired) e.push("suppression: governance-gate.mjs no longer runs the carry-forward Change Review");
  }
  for(const sprintScript of ["harness/scripts/validate-sprint.mjs","harness/scripts/validate-backlog.mjs"]){
    if(!ctx.changed.includes(sprintScript)) continue;
    const src=ctx.readHead(sprintScript)?.toString("utf8")||"";
    if(!src.includes("./validate-special-approvals-and-carry-forward.mjs")) e.push("suppression: "+sprintScript+" no longer uses the carry-forward validator");
  }
  return e;
};
const docketDiffErrors=ctx=>{
  const {cf,changed,readBaseJson,readHeadJson,headReg}=ctx,e=[];
  for(const p of changed.filter(x=>x.startsWith(cf.docket_dir) && x.endsWith(".json"))){
    const before=readBaseJson(p),after=readHeadJson(p);
    if(before){
      if((before.closure_disposition || before.carry_forward) && !sameJson(before,after)) e.push("carry-forward / closure docket is append-only: "+p);
      continue;
    }
    if(after) e.push(...docketCarryForwardErrors(after,p,headReg,cf));
  }
  return e;
};

/**
 * Change Review entry point (every PR). BASE policy decides whether enforcement applies, so a
 * PR cannot switch off its own review; HEAD must keep enforcement and the gate wiring.
 */
export function inspectCarryForwardChange(ctx){
  const cf=ctx.basePolicyFull?.carry_forward;
  if(cf?.enforced!==true) return {enforced:false,errors:[]};
  const full={...ctx,cf,headReg:ctx.readHeadJson(cf.register_path)};
  const errors=[...suppressionErrors(full),...docketDiffErrors(full),...sprintDiffErrors(full)];
  if(ctx.changed.includes(cf.register_path)) errors.push(...registerDiffErrors(ctx.readBaseJson(cf.register_path),full.headReg));
  return {enforced:true,errors};
}

// ---------------------------------------------------------------- Sprint closure (state)

const ordinaryClosureErrors=({sid,td,backlogById,selectedIds,revalidationIds})=>{
  const e=[];
  for(const t of td.tasks||[]) if(t.status!=="CLOSED") e.push(sid+" CLOSED Sprint requires every Task CLOSED: "+t.task_id+" is "+t.status);
  for(const bid of selectedIds){
    const bi=backlogById.get(bid);
    if(bi && bi.status!=="DONE") e.push(sid+" CLOSED Sprint requires every selected Backlog DONE: "+bid+" is "+bi.status);
  }
  for(const bid of revalidationIds){
    const bi=backlogById.get(bid);
    if(bi && !["VERIFIED","CLOSED"].includes(bi.revalidation?.status)) e.push(sid+" CLOSED Sprint requires revalidation complete: "+bid+" is "+bi.revalidation?.status);
  }
  return e;
};
const closureApprovalIdentityOk=(docket,a,ex)=>
  a.case_id===docket.case_id && (ex.accepted_source_kinds||[]).includes(a.source_kind) &&
  a.decision===ex.required_decision && a.scope===ex.required_scope;
const closureApprovalProvenanceOk=(docket,a,full)=>
  RE_DIGEST.test(docket.candidate_digest_sha256||"") && a.candidate_digest_sha256===docket.candidate_digest_sha256 &&
  str(a.human_message_ref) && !placeholderOf(full).test(a.human_message_ref) &&
  (full.human_authority_accounts||[]).includes(a.approver) && isUnix(a.approved_at_unix);
const closureApprovalErrors=(docket,full,L)=>{
  const ex=full.exception||{},a=docket.human_approval||{};
  return closureApprovalIdentityOk(docket,a,ex) && closureApprovalProvenanceOk(docket,a,full)?
    []:[L+" exact Human closure approval missing or invalid (CI cannot prove Human provenance; manual check mandatory)"];
};
const closureDocketErrors=(ctx,a,L)=>{
  const {sid,m,docket,full}=ctx,e=[];
  if(docket.case_id!==a.case_id || docket.closure_disposition!==ADMIN_CLOSURE || docket.sprint_id!==sid || docket.build_spec_id!==m.build_spec_id) e.push(L+" docket identity/disposition/Sprint/Build Spec mismatch");
  if(docket.scope_exception) e.push(L+" docket must not be a TTL scope_exception: closure is a permanent historical record, not a live waiver");
  if(docket.never_converts_fail_or_untested_to_pass!==true) e.push(L+" docket must declare never_converts_fail_or_untested_to_pass");
  if(!sameJson(docket.administrative_closure,a)) e.push(L+" manifest administrative_closure differs from the Human-approved docket");
  if(!Array.isArray(docket.why5) || docket.why5.length!==5 || !docket.why5.every(w=>str(w?.question) && str(w?.answer) && str(w?.evidence_ref))) e.push(L+" five evidence-linked Why answers required");
  return [...e,...closureApprovalErrors(docket,full,L)];
};
const openSetErrors=(L,kind,actual,listed,permitted)=>{
  const e=[],byId=new Map();
  if(!Array.isArray(listed)) return [L+" "+kind+" must be an array"];
  for(const x of listed){ if(byId.has(x?.id)) e.push(L+" duplicate "+kind+" "+x?.id); byId.set(x?.id,x); }
  for(const [id,status] of actual){
    const x=byId.get(id);
    if(!x) e.push(L+" unlisted open "+kind+" "+id+" ("+status+")");
    else if(x.status!==status) e.push(L+" "+kind+" "+id+" is "+status+", approved as "+x.status);
    if(permitted && !permitted.includes(status)) e.push(L+" "+kind+" "+id+" status "+status+" cannot be carried forward");
  }
  for(const id of byId.keys()) if(!actual.has(id)) e.push(L+" approved open "+kind+" "+id+" no longer matches the Sprint record");
  return e;
};
const closureLinkedRows=(ctx,ids,L)=>{
  const {sid,register}=ctx,rows=new Map((register?.items||[]).map(r=>[r.id,r])),e=[],linked=[];
  for(const id of ids){
    const r=rows.get(id);
    if(!r || !isStrictRow(r)) e.push(L+" carry-forward row missing or not "+CARRY_FORWARD_SCHEMA+": "+id);
    else if(r.source?.sprint_id!==sid) e.push(L+" carry-forward row "+id+" belongs to another Sprint");
    else linked.push(r);
  }
  return {e,linked};
};
const closureUncoveredErrors=(a,linked,L)=>{
  const e=[];
  for(const x of a.open_tasks||[]) if(!linked.some(r=>r.source?.task_id===x.id)) e.push(L+" open Task "+x.id+" has no carry-forward row");
  for(const x of a.open_backlog||[]) if(!linked.some(r=>r.source?.kind==="BACKLOG" && (r.source.backlog_item_ids||[]).includes(x.id))) e.push(L+" open Backlog "+x.id+" has no carry-forward row");
  for(const x of a.open_revalidations||[]) if(!linked.some(r=>r.source?.kind==="REVALIDATION" && (r.source.backlog_item_ids||[]).includes(x.id))) e.push(L+" open revalidation "+x.id+" has no carry-forward row");
  return e;
};
const coverageErrors=(ctx,a,L)=>{
  const ids=a.carry_forward_ids;
  if(!Array.isArray(ids) || !ids.length || !unique(ids)) return [L+" carry_forward_ids must list unique register IDs"];
  const {e,linked}=closureLinkedRows(ctx,ids,L);
  return [...e,...closureUncoveredErrors(a,linked,L)];
};
const adminClosureTaskErrors=(ctx,a,L,ac)=>{
  const {td}=ctx,e=[];
  const openTasks=new Map((td.tasks||[]).filter(t=>t.status!=="CLOSED").map(t=>[t.task_id,t.status]));
  e.push(...openSetErrors(L,"Task",openTasks,a.open_tasks,ac.permitted_open_task_statuses));
  for(const x of a.open_tasks||[]){
    const t=(td.tasks||[]).find(y=>y.task_id===x.id);
    if(t && x.snapshot_sha256!==taskSnapshotDigest(t)) e.push(L+" Task "+x.id+" AC/Test/Evidence bytes changed after Human approval");
  }
  return e;
};
const adminClosureBacklogErrors=(ctx,a,L,ac)=>{
  const {selectedIds,backlogById}=ctx;
  const openBacklog=new Map([...selectedIds].filter(id=>backlogById.get(id) && backlogById.get(id).status!=="DONE").map(id=>[id,backlogById.get(id).status]));
  return openSetErrors(L,"Backlog",openBacklog,a.open_backlog,ac.permitted_open_backlog_statuses);
};
const adminClosureRevalidationErrors=(ctx,a,L)=>{
  const {revalidationIds,backlogById}=ctx;
  const openReval=new Map([...revalidationIds].filter(id=>backlogById.get(id) && !["VERIFIED","CLOSED"].includes(backlogById.get(id).revalidation?.status)).map(id=>[id,String(backlogById.get(id).revalidation?.status)]));
  return openSetErrors(L,"revalidation",openReval,a.open_revalidations,null);
};
const adminClosureHistoryErrors=(ctx,a,L,ac)=>{
  const e=[];
  for(const d of a.historical_procedural_dispositions||[]){
    if(!(ac.historical_dispositionable_gates||[]).includes(d?.gate_id)) e.push(L+" gate "+d?.gate_id+" cannot receive a historical disposition");
    if(!(ctx.td.tasks||[]).some(t=>t.task_id===d?.task_id)) e.push(L+" historical disposition names unknown Task "+d?.task_id);
  }
  return e;
};
const adminClosureErrors=ctx=>{
  const {sid,m,docket,full}=ctx;
  const a=m.administrative_closure||{},ac=full?.administrative_closure,L=sid+" administrative closure";
  if(!ac || !full?.carry_forward) return [L+" policy missing in governance-reform.json"];
  const e=[];
  if(a.schema!==ac.schema) e.push(L+" schema must be "+ac.schema);
  if(!RE_CASE.test(a.case_id||"")) return [...e,L+" case_id invalid"];
  if(!docket) return [...e,L+" Human closure docket missing: "+full.carry_forward.docket_dir+a.case_id+".json"];
  return [...e,...closureDocketErrors(ctx,a,L),
    ...adminClosureTaskErrors(ctx,a,L,ac),
    ...adminClosureBacklogErrors(ctx,a,L,ac),
    ...adminClosureRevalidationErrors(ctx,a,L),
    ...adminClosureHistoryErrors(ctx,a,L,ac),
    ...coverageErrors(ctx,a,L)];
};
/**
 * CLOSED-Sprint check used by validate-sprint.mjs. Ordinary closure keeps every original
 * all-Tasks-CLOSED / all-Backlog-DONE / all-revalidations-complete condition, byte for byte.
 */
export function closedSprintErrors(ctx){
  const d=ctx.m.closure_disposition;
  if(ctx.m.status!=="CLOSED") return d===undefined?[]:[ctx.sid+" closure_disposition is only valid on a CLOSED Sprint"];
  if(d===undefined) return ordinaryClosureErrors(ctx);
  if(d===ADMIN_CLOSURE) return adminClosureErrors(ctx);
  return [ctx.sid+" invalid closure_disposition: "+d];
}

/** The next Sprint may only start after Human Product Alignment reviewed every open carry-forward. */
const productAlignmentUnreviewedErrors=(prior,register,reviewed,activeSid)=>{
  const rows=new Map((register?.items||[]).map(r=>[r.id,r])),e=[];
  for(const [sid,v] of prior) for(const id of v.m.administrative_closure?.carry_forward_ids||[]){
    if(rows.get(id)?.status!=="RESOLVED" && !reviewed.has(id)) e.push(activeSid+" Product Alignment did not review open carry-forward "+id+" from "+sid);
  }
  return e;
};
/** The next Sprint may only start after Human Product Alignment reviewed every open carry-forward. */
export function productAlignmentErrors({activeSid,activeManifest,sprints,register,full}){
  const prior=[...sprints].filter(([sid,v])=>v.m?.status==="CLOSED" && v.m.closure_disposition===ADMIN_CLOSURE && sprintOrder(sid)<sprintOrder(activeSid));
  if(!prior.length) return [];
  const pa=activeManifest?.entry_gate?.product_alignment;
  if(!pa || !str(pa.human_decision_ref) || placeholderOf(full).test(pa.human_decision_ref)) return [activeSid+" activation after an administrative closure requires entry_gate.product_alignment.human_decision_ref"];
  const reviewed=new Set(Array.isArray(pa.reviewed_carry_forward_ids)?pa.reviewed_carry_forward_ids:[]);
  return productAlignmentUnreviewedErrors(prior,register,reviewed,activeSid);
}
// ---------------------------------------------------------------- repository adapters

const readJsonAbs=abs=>{try{return JSON.parse(fs.readFileSync(abs,"utf8"));}catch{return null;}};
const readRel=(root,rel)=>SAFE_REL.test(rel) && !rel.includes("..")?readJsonAbs(path.join(root,rel)):null;
export const loadCarryForwardPolicy=root=>readRel(root,GOVERNANCE_REFORM_POLICY_PATH);
export function loadAdminClosureDocket(root,full,m){
  const id=m?.administrative_closure?.case_id;
  return RE_CASE.test(id||"")?readRel(root,(full?.carry_forward?.docket_dir||"")+id+".json"):null;
}
export function registerContext(root,{full,sprints,backlogById,now=Math.floor(Date.now()/1000)}){
  return {cf:full.carry_forward,placeholder:placeholderOf(full),nonWaivable:full.exception?.non_waivable_gates||[],now,sprints,backlogById};
}

/**
 * Permanent historical disposition for a procedural ordering gate (e.g. the T008/T006 order)
 * granted ONLY by a valid administrative closure of that exact Sprint. Expired live
 * CLOSURE_DEFERRAL dockets never become perpetual permission.
 */
export function administrativeHistoricalDisposition({root,sprintId,gateId,taskId}){
  const full=loadCarryForwardPolicy(root);
  const m=readRel(root,"delivery/sprints/"+sprintId+"/manifest.json");
  if(!full?.administrative_closure || m?.closure_disposition!==ADMIN_CLOSURE) return {valid:false,errors:["no administrative closure for "+sprintId]};
  const listed=(m.administrative_closure?.historical_procedural_dispositions||[]).some(d=>d.gate_id===gateId && d.task_id===taskId);
  const td=readRel(root,"delivery/sprints/"+sprintId+"/tasks.json")||{tasks:[]};
  const queue=readRel(root,"delivery/backlog/QUEUE.json")||{items:[]};
  const errors=closedSprintErrors({sid:sprintId,m,td,backlogById:new Map((queue.items||[]).map(x=>[x.backlog_item_id,x])),
    selectedIds:new Set(m.backlog_item_ids||[]),revalidationIds:new Set(m.revalidation_item_ids||[]),
    docket:loadAdminClosureDocket(root,full,m),full,register:readRel(root,full.carry_forward.register_path)});
  if(!listed) errors.push(gateId+" for "+taskId+" is not an approved historical disposition of "+sprintId);
  return {valid:errors.length===0,errors};
}

const gitShowJson=(base,rel)=>{
  if(!RE_SHA.test(base||"") || !SAFE_REL.test(rel)) return null;
  try{return JSON.parse(execFileSync("git",["show",base+":"+rel],{encoding:"utf8",maxBuffer:64*1024*1024,stdio:["ignore","pipe","ignore"]}));}catch{return null;}
};
const gitListDir=(base,dir)=>{
  try{return execFileSync("git",["ls-tree","--name-only",base,dir],{encoding:"utf8",stdio:["ignore","pipe","ignore"]}).trim().split("\n").filter(Boolean);}catch{return [];}
};
/** Repository adapter for governance-gate.mjs. */
export function inspectRepoCarryForwardChange({root,base,changed}){
  const readHead=rel=>{
    if(!SAFE_REL.test(rel) || rel.includes("..")) return null;
    try{return fs.readFileSync(path.join(root,rel));}catch{return null;}
  };
  const readBaseJson=rel=>gitShowJson(base,rel);
  const basePolicyFull=readBaseJson(GOVERNANCE_REFORM_POLICY_PATH);
  const docketDir=basePolicyFull?.carry_forward?.docket_dir||"delivery/constitutional-cases/";
  const baseDocketDigests=new Set(gitListDir(base,docketDir).map(rel=>readBaseJson(rel)?.candidate_digest_sha256).filter(Boolean));
  return inspectCarryForwardChange({
    base,changed,readHead,readHeadJson:rel=>readRel(root,rel),readBaseJson,
    basePolicyFull,headPolicyFull:readRel(root,GOVERNANCE_REFORM_POLICY_PATH),baseDocketDigests
  });
}

/** HEAD-state register validation for governance-gate.mjs (runs with or without BASE_SHA). */
export function validateRepoCarryForwardRegister(root,now=Math.floor(Date.now()/1000)){
  const full=loadCarryForwardPolicy(root);
  if(!full?.carry_forward) return ["governance-reform.json carry_forward policy missing"];
  const sprintRoot=path.join(root,"delivery/sprints");
  const sprints=new Map();
  if(fs.existsSync(sprintRoot)){
    for(const d of fs.readdirSync(sprintRoot,{withFileTypes:true}).filter(x=>x.isDirectory() && RE_SPRINT.test(x.name))){
      sprints.set(d.name,{m:readRel(root,"delivery/sprints/"+d.name+"/manifest.json"),td:readRel(root,"delivery/sprints/"+d.name+"/tasks.json")});
    }
  }
  const queue=readRel(root,"delivery/backlog/QUEUE.json")||{items:[]};
  const ctx=registerContext(root,{full,sprints,backlogById:new Map((queue.items||[]).map(x=>[x.backlog_item_id,x])),now});
  return registerErrors(readRel(root,full.carry_forward.register_path),ctx);
}
