import fs from "node:fs";
import { createHash } from "node:crypto";
import { isOneTimeConstitutionFounding } from "./validate-constitutional-change.mjs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { isExactT005PercentGovernanceRepair, testT005PercentRepairGuard, T005_PERCENT_GATE_MARKER } from "./t005-percent-test-compat.mjs";
import { isExactPg001DependencyHoldUpdate, testPg001DependencyHoldPathGuard, PG001_DEPENDENCY_GATE_MARKER } from "./pg001-dependency-hold-path.mjs";
import { resolveRepoException, HUMAN_EXCEPTION_SCOPE_MARKER, GOVERNANCE_REFORM_POLICY_PATH } from "./human-exception.mjs";
import { inspectCarryForwardChange, closedSprintErrors, validateRepoCarryForwardRegister, ADMIN_CLOSURE } from "./validate-special-approvals-and-carry-forward.mjs";

const root=process.cwd(), errors=[];
const read=r=>JSON.parse(fs.readFileSync(path.join(root,r),"utf8"));
const policy=read("harness/policy/repo-policy.json");
const cs=read("delivery/CURRENT-SPRINT.json");
const currentBuild=read("build-spec/CURRENT.json");
const holdExceptions=new Set(policy.hold_exceptions||[]);
const sideEffectPrefixes=policy.execution_side_effect_paths||[];

const getChanged=()=>{
  const base=process.env.BASE_SHA, head=process.env.HEAD_SHA||"HEAD";
  if(base && !/^0+$/.test(base)){
    try{return execFileSync("git",["diff","--name-only",base,head],{encoding:"utf8"}).trim().split("\n").filter(Boolean);}
    catch{errors.push("Unable to calculate CI change scope."); return [];}
  }
  try{
    const a=execFileSync("git",["diff","--name-only","HEAD"],{encoding:"utf8"}).trim().split("\n").filter(Boolean);
    const b=execFileSync("git",["diff","--cached","--name-only"],{encoding:"utf8"}).trim().split("\n").filter(Boolean);
    const c=execFileSync("git",["ls-files","--others","--exclude-standard"],{encoding:"utf8"}).trim().split("\n").filter(Boolean);
    return [...new Set([...a,...b,...c])];
  }catch{return [];}
};
const changed=getChanged();
const isImpl=p=>(policy.implementation_roots||[]).some(prefix=>p.startsWith(prefix)) && !holdExceptions.has(p);
const isGov=p=>(policy.governance_only_paths||[]).some(prefix=>prefix.endsWith("/")?p.startsWith(prefix):p===prefix);
// A verified CLOSURE_DEFERRAL docket is an append-only governance record, not Task scope.
const exceptionRecordPaths=new Set();
const isSideEffect=p=>sideEffectPrefixes.some(prefix=>p.startsWith(prefix)) || exceptionRecordPaths.has(p);
const pathAllowed=(p,allowed)=>allowed.some(a=>a.endsWith("/")?p.startsWith(a):p===a);

const baseSha=process.env.BASE_SHA;
const showBaseJson=rel=>{
  if(!baseSha || /^0+$/.test(baseSha)) return null;
  try{return JSON.parse(execFileSync("git",["show",baseSha+":"+rel],{encoding:"utf8"}));}
  catch{return null;}
};
const stable=x=>JSON.stringify(x);
const omit=(obj,keys)=>{
  if(!obj || typeof obj!=="object") return obj;
  const out={...obj}; for(const k of keys) delete out[k]; return out;
};
const immutableTasks=doc=>({
  schema_version:doc?.schema_version,
  sprint_id:doc?.sprint_id,
  tasks:(doc?.tasks||[]).map(t=>omit(t,["status","completion_evidence"]))
});
const immutableManifest=m=>{
  if(!m) return m;
  const x={...m,entry_gate:m.entry_gate?omit(m.entry_gate,["user_approved","approval_ref"]):m.entry_gate};
  delete x.status;
  return x;
};
const immutableBacklog=q=>({
  schema_version:q?.schema_version,
  build_spec_id:q?.build_spec_id,
  status:q?.status,
  generation:q?.generation,
  items:(q?.items||[]).map(i=>omit(i,["status","sprint_id"]))
});
const immutableBuild=b=>omit(b,["implementation_enabled","reason"]);


/**
 * Safe-control-only exception for an audited revalidation closure, never a general backlog rewrite.
 * The existing Evidence Gate independently verifies every referenced PASS record before a Task is CLOSED.
 */
const validRevalidationClosureContext=(beforeQueue,afterQueue,beforeTd,afterTd)=>{
  if(!Array.isArray(beforeQueue?.items) || !Array.isArray(afterQueue?.items)) return false;
  if(beforeQueue.items.length!==afterQueue.items.length) return false;
  return beforeTd?.sprint_id===afterTd?.sprint_id &&
    Array.isArray(beforeTd?.tasks) && Array.isArray(afterTd?.tasks);
};
const unchangedRevalidationBinding=(oldR,newR,ctx)=>{
  if(!oldR || !newR || oldR.status!=="IN_PROGRESS" || newR.status!=="CLOSED") return false;
  if(stable(omit(oldR,["status"]))!==stable(omit(newR,["status"]))) return false;
  return oldR.sprint_id===ctx.beforeTd.sprint_id &&
    newR.sprint_id===ctx.afterTd.sprint_id &&
    oldR.target_build_spec_id===ctx.beforeQueue.build_spec_id &&
    newR.target_build_spec_id===ctx.afterQueue.build_spec_id;
};
const exactlyClosingTask=(oldTask,newTask,oldR,newR)=>{
  if(!oldTask || !newTask || oldTask.task_id!==newTask.task_id) return false;
  // Historical T007 can retain its existing direct closure route; T008 must
  // first enter REVIEW and produce independent evidence before CLOSED.
  return (oldTask.status==="IN_PROGRESS" ||
    (oldTask.task_id==="T008" && oldTask.status==="REVIEW")) &&
    (oldTask.task_id!=="T008" || oldTask.status==="REVIEW") &&
    newTask.status==="CLOSED" &&
    oldTask.build_spec_id===oldR.target_build_spec_id &&
    newTask.build_spec_id===newR.target_build_spec_id;
};
const completedTaskHasMappedEvidence=(newTask,newR)=>{
  if(!Array.isArray(newTask.completion_evidence) || !newTask.completion_evidence.length) return false;
  if(!Array.isArray(newR.acceptance_ids)) return false;
  return newR.acceptance_ids.every(aid=>(newTask.acceptance_links||[]).some(link=>link.acceptance_id===aid));
};
const exactItemRevalidationClosure=(oldR,newR,ctx)=>{
  if(!unchangedRevalidationBinding(oldR,newR,ctx)) return false;
  const oldTask=ctx.beforeTasks.get(oldR.task_id),newTask=ctx.afterTasks.get(newR.task_id);
  if(!exactlyClosingTask(oldTask,newTask,oldR,newR)) return false;
  return completedTaskHasMappedEvidence(newTask,newR);
};
const exactRevalidationClosures=(beforeQueue,afterQueue,beforeTd,afterTd)=>{
  if(!validRevalidationClosureContext(beforeQueue,afterQueue,beforeTd,afterTd)) return false;
  const ctx={
    beforeQueue,afterQueue,beforeTd,afterTd,
    beforeTasks:new Map(beforeTd.tasks.map(t=>[t.task_id,t])),
    afterTasks:new Map(afterTd.tasks.map(t=>[t.task_id,t]))
  };
  let closures=0;
  const restored=[];
  for(let i=0;i<beforeQueue.items.length;i++){
    const oldItem=beforeQueue.items[i],newItem=afterQueue.items[i];
    if(!oldItem || !newItem || oldItem.backlog_item_id!==newItem.backlog_item_id) return false;
    const oldR=oldItem.revalidation,newR=newItem.revalidation;
    if(stable(oldR)===stable(newR)){
      restored.push(newItem);
      continue;
    }
    if(!exactItemRevalidationClosure(oldR,newR,ctx)) return false;
    restored.push({...newItem,revalidation:oldR});
    closures++;
  }
  return closures>0 &&
    stable(immutableBacklog(beforeQueue))===
    stable(immutableBacklog({...afterQueue,items:restored}));
};

/** Mandatory positive/negative regression assertions, executed by npm run gate on every CI run. */
const checkRevalidationClosureGuard=()=>{
  const revalidation={target_build_spec_id:"BS-P1-024",sprint_id:"SP-P1-003",task_id:"T007",acceptance_ids:["F01-AC-004"],status:"IN_PROGRESS"};
  const item={backlog_item_id:"BL-P1-008",status:"DONE",sprint_id:"SP-P1-002",revalidation};
  const oldQueue={schema_version:1,build_spec_id:"BS-P1-024",status:"OPEN",generation:{},items:[item]};
  const newQueue={...oldQueue,items:[{...item,revalidation:{...revalidation,status:"CLOSED"}}]};
  const oldTask={task_id:"T007",status:"IN_PROGRESS",build_spec_id:"BS-P1-024",completion_evidence:[],acceptance_links:[{acceptance_id:"F01-AC-004",test_id:"TEST-F01-004"}]};
  const newTask={...oldTask,status:"CLOSED",completion_evidence:["EV-SP-P1-003-T007-001"]};
  const oldTd={sprint_id:"SP-P1-003",tasks:[oldTask]},newTd={sprint_id:"SP-P1-003",tasks:[newTask]};
  const replace=(base,patch)=>({...base,...patch});
  const t008R={...revalidation,task_id:"T008",target_build_spec_id:"BS-P1-025"};
  const t008Q={...oldQueue,build_spec_id:"BS-P1-025",items:[{...item,revalidation:t008R}]};
  const t008QC={...t008Q,items:[{...item,revalidation:{...t008R,status:"CLOSED"}}]};
  const t008Before={...oldTask,task_id:"T008",status:"REVIEW",build_spec_id:"BS-P1-025"};
  const t008After={...t008Before,status:"CLOSED",completion_evidence:["SYNTHETIC-ONLY"]};
  const t008Td0={sprint_id:"SP-P1-003",tasks:[t008Before]};
  const t008Td1={sprint_id:"SP-P1-003",tasks:[t008After]};
  const cases=[
    ["valid exact closure",true,oldQueue,newQueue,oldTd,newTd],
    ["no evidence",false,oldQueue,newQueue,oldTd,replace(newTd,{tasks:[replace(newTask,{completion_evidence:[]})]})],
    ["Task not CLOSED",false,oldQueue,newQueue,oldTd,replace(newTd,{tasks:[replace(newTask,{status:"IN_PROGRESS"})]})],
    ["Task source already CLOSED",false,oldQueue,newQueue,replace(oldTd,{tasks:[replace(oldTask,{status:"CLOSED"})]}),newTd],
    ["revalidation status reopened",false,replace(oldQueue,{items:[{...item,revalidation:{...revalidation,status:"CLOSED"}}]}),replace(oldQueue,{items:[item]}),oldTd,newTd],
    ["revalidation VERIFIED instead of CLOSED",false,oldQueue,replace(newQueue,{items:[{...item,revalidation:{...revalidation,status:"VERIFIED"}}]}),oldTd,newTd],
    ["different target Build Spec",false,oldQueue,replace(newQueue,{items:[{...item,revalidation:{...revalidation,status:"CLOSED",target_build_spec_id:"BS-P1-023"}}]}),oldTd,newTd],
    ["different revalidation Task",false,oldQueue,replace(newQueue,{items:[{...item,revalidation:{...revalidation,status:"CLOSED",task_id:"T006"}}]}),oldTd,newTd],
    ["different acceptance scope",false,oldQueue,replace(newQueue,{items:[{...item,revalidation:{...revalidation,status:"CLOSED",acceptance_ids:["F01-AC-005"]}}]}),oldTd,newTd],
    ["extra edited backlog metadata",false,oldQueue,replace(newQueue,{items:[{...newQueue.items[0],priority:"P0"}]}),oldTd,newTd],
    ["wrong Sprint identity",false,oldQueue,newQueue,oldTd,replace(newTd,{sprint_id:"SP-P1-004"})],
    ["T008 independent REVIEW to CLOSED",true,t008Q,t008QC,t008Td0,t008Td1],
    ["T008 cannot skip REVIEW",false,t008Q,t008QC,replace(t008Td0,{tasks:[{...t008Before,status:"IN_PROGRESS"}]}),t008Td1]
  ];
  for(const [name,expected,before,after,tasksBefore,tasksAfter] of cases){
    if(exactRevalidationClosures(before,after,tasksBefore,tasksAfter)!==expected) errors.push("Revalidation closure guard self-test failed: "+name);
  }
  if(!errors.some(e=>e.startsWith("Revalidation closure guard self-test failed:"))) console.log("- Revalidation closure guard: 13 positive/negative regression cases PASS.");
};
checkRevalidationClosureGuard();

const baseCurrentSprint=showBaseJson("delivery/CURRENT-SPRINT.json");
const baseCurrentBuild=showBaseJson("build-spec/CURRENT.json");

// GOV-REFORM-20261013 generic Human exception lane. Lane rules come from the BASE
// policy (no self-widening); bytes, paths, base, expiry and replay are exact.
// Evidence/Test/Product CI/Constitution/Activation gates still run independently.
const humanException=resolveRepoException({
  root,base:baseSha,changed,
  state:{baseSprint:baseCurrentSprint,headSprint:cs,baseBuild:baseCurrentBuild,headBuild:currentBuild}
});
if(humanException.applies && !humanException.ok){
  for(const e of humanException.errors) errors.push("Human exception lane rejected ("+humanException.policySource+" policy): "+e);
}
const humanExceptionScope=humanException.ok && humanException.coveredGates.includes("CHANGE_SCOPE");
if(humanException.ok && humanException.lane==="CLOSURE_DEFERRAL") exceptionRecordPaths.add(humanException.docketPath);
if(humanException.ok){
  console.log("- "+HUMAN_EXCEPTION_SCOPE_MARKER+": "+humanException.lane+" "+humanException.caseId+
    " covers "+humanException.coveredGates.join(",")+" ("+humanException.policySource+" policy); Human provenance must still be verified manually.");
}

const targetSprint=cs.active_sprint || baseCurrentSprint?.active_sprint;
const controlAllowed=new Set([
  "build-spec/CURRENT.json",
  "delivery/CURRENT-SPRINT.json",
  "delivery/backlog/QUEUE.json",
  ...(targetSprint?["delivery/sprints/"+targetSprint+"/manifest.json","delivery/sprints/"+targetSprint+"/tasks.json"]:[])
]);
let safeControlTransition=false;
// Closure simplification: one control PR may also carry its Evidence/Finding side effects;
// the Evidence Gate independently verifies every referenced record.
const controlChanged=changed.filter(p=>!isSideEffect(p));
if(controlChanged.length && controlChanged.every(p=>controlAllowed.has(p)) && baseSha && !/^0+$/.test(baseSha)){
  const oldBuild=showBaseJson("build-spec/CURRENT.json");
  const oldCurrent=showBaseJson("delivery/CURRENT-SPRINT.json");
  const oldBacklog=showBaseJson("delivery/backlog/QUEUE.json");
  const sprint=cs.active_sprint || oldCurrent?.active_sprint;
  const oldManifest=sprint?showBaseJson("delivery/sprints/"+sprint+"/manifest.json"):null;
  const oldTasks=sprint?showBaseJson("delivery/sprints/"+sprint+"/tasks.json"):null;
  const newManifest=sprint && fs.existsSync(path.join(root,"delivery/sprints/"+sprint+"/manifest.json"))?read("delivery/sprints/"+sprint+"/manifest.json"):null;
  const newTasks=sprint && fs.existsSync(path.join(root,"delivery/sprints/"+sprint+"/tasks.json"))?read("delivery/sprints/"+sprint+"/tasks.json"):null;
  const newBacklog=read("delivery/backlog/QUEUE.json");
  safeControlTransition=
    stable(immutableBuild(oldBuild))===stable(immutableBuild(currentBuild)) &&
    (!oldManifest || stable(immutableManifest(oldManifest))===stable(immutableManifest(newManifest))) &&
    (!oldTasks || stable(immutableTasks(oldTasks))===stable(immutableTasks(newTasks))) &&
    (!oldBacklog || stable(immutableBacklog(oldBacklog))===stable(immutableBacklog(newBacklog)) ||
      exactRevalidationClosures(oldBacklog,newBacklog,oldTasks,newTasks));
  if(safeControlTransition) console.log("- Safe execution control transition recognized; Task definitions remain immutable.");
}

const rebaselineActivationPath=currentBuild.active_baseline
  ?"build-spec/activations/"+currentBuild.active_baseline+".json"
  :null;
const rebaselineControlAllowed=new Set([
  "build-spec/CURRENT.json",
  "delivery/CURRENT-SPRINT.json",
  "delivery/backlog/QUEUE.json",
  ...(targetSprint?["delivery/sprints/"+targetSprint+"/manifest.json","delivery/sprints/"+targetSprint+"/tasks.json"]:[]),
  ...(rebaselineActivationPath?[rebaselineActivationPath]:[])
]);
const previousExecutionPaused=
  baseCurrentSprint?.status==="BLOCKED" ||
  (baseCurrentSprint?.status==="HOLD" &&
   baseCurrentSprint?.active_sprint===null &&
   baseCurrentSprint?.active_build_spec===null &&
   baseCurrentSprint?.active_task===null);
const rebaselineTransitionShape=
  baseCurrentBuild?.active_baseline &&
  currentBuild.active_baseline &&
  baseCurrentBuild.active_baseline!==currentBuild.active_baseline &&
  previousExecutionPaused &&
  ["BLOCKED","ACTIVE"].includes(cs.status) &&
  rebaselineActivationPath &&
  changed.includes(rebaselineActivationPath);

const canonical=value=>{
  if(Array.isArray(value)) return value.map(canonical);
  if(value && typeof value==="object") return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
};
const sameJson=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const appendOnly=(before,after)=>
  Array.isArray(before) && Array.isArray(after) && after.length>=before.length &&
  before.every((entry,i)=>sameJson(entry,after[i]));
const readHeadJson=rel=>{
  try{return JSON.parse(fs.readFileSync(path.join(root,rel),"utf8"));}
  catch{return null;}
};
// Only the replacement baseline's newly introduced Delta(s) and their exact source Finding(s) may advance
// lifecycle inside the atomic rebaseline transition; every other field must stay identical.
const governedLifecycleRules=[
  {pattern:/^delivery\/deltas\/(BD-\d{3,})\.json$/,kind:"Delta",from:"APPROVED",to:"IMPLEMENTING",appendField:"verification"},
  {pattern:/^delivery\/findings\/(BF-\d{3,})\.json$/,kind:"Finding",from:"BLOCKED",to:"RESOLVED",appendField:"evidence"}
];
const lifecycleViolation=(rel,rule,allowedIds,id)=>{
  if(!allowedIds.has(id)) return rule.kind+" "+id+" is not introduced by the replacement baseline";
  const before=showBaseJson(rel), after=readHeadJson(rel);
  if(!before || !after) return rule.kind+" "+id+" must exist before and after the transition";
  if(before.status!==rule.from || after.status!==rule.to) return rule.kind+" "+id+" may only move "+rule.from+" -> "+rule.to;
  if(!appendOnly(before[rule.appendField],after[rule.appendField])) return rule.kind+" "+id+" "+rule.appendField+" must be append-only";
  if(!sameJson(omit(before,["status",rule.appendField]),omit(after,["status",rule.appendField]))) return rule.kind+" "+id+" semantic fields must remain identical";
  return null;
};
const rebaselineLifecyclePaths=()=>{
  const allowed=new Set();
  const replacement=showBaseJson("build-spec/baselines/"+currentBuild.active_baseline+"/manifest.json");
  const predecessor=showBaseJson("build-spec/baselines/"+baseCurrentBuild.active_baseline+"/manifest.json");
  const lineageOk=replacement && predecessor && replacement.supersedes===baseCurrentBuild.active_baseline;
  const inherited=new Set(lineageOk?predecessor.approved_delta_ids||[]:[]);
  const introducedDeltas=new Set(lineageOk?(replacement.approved_delta_ids||[]).filter(id=>!inherited.has(id)):[]);
  const sourceFindings=new Set();
  for(const did of introducedDeltas) for(const fid of showBaseJson("delivery/deltas/"+did+".json")?.source_finding_ids||[]) sourceFindings.add(fid);
  const allowedIds={Delta:introducedDeltas,Finding:sourceFindings};
  for(const rel of changed){
    const rule=governedLifecycleRules.find(r=>r.pattern.test(rel));
    if(!rule) continue;
    const violation=lifecycleViolation(rel,rule,allowedIds[rule.kind],rel.match(rule.pattern)[1]);
    if(violation) errors.push("Rebaseline transition governance side effect rejected: "+violation);
    else allowed.add(rel);
  }
  return allowed;
};
const rebaselineLifecycleAllowed=rebaselineTransitionShape?rebaselineLifecyclePaths():new Set();
const approvedRebaselineTransition=
  rebaselineTransitionShape &&
  changed.every(p=>rebaselineControlAllowed.has(p) || rebaselineLifecycleAllowed.has(p));

if(approvedRebaselineTransition) console.log("- Human-approved rebaseline control transition recognized; Activation/Baseline/Sprint gates must independently approve it.");
if(approvedRebaselineTransition && rebaselineLifecycleAllowed.size) console.log("- Introduced Delta/source Finding lifecycle side effects: "+[...rebaselineLifecycleAllowed].sort().join(", "));

const pfr06ReadinessPaths=new Set([
  "package.json",
  "package-lock.json",
  "tooling/TOOLCHAIN.json",
  "tooling/web/vite.config.ts",
  "playwright.config.ts",
  "harness/scripts/validate-toolchain.mjs",
  "harness/scripts/validate-change-scope.mjs",
  "delivery/audits/PFR-06-WEB-READINESS.json"
]);
const pfr06ReadinessAudit=readHeadJson("delivery/audits/PFR-06-WEB-READINESS.json");
const approvedPfr06WebReadinessTransition=
  baseCurrentSprint?.status==="HOLD" &&
  baseCurrentSprint?.active_sprint===null &&
  baseCurrentSprint?.active_task===null &&
  cs.status==="HOLD" &&
  cs.active_sprint===null &&
  cs.active_task===null &&
  currentBuild.implementation_enabled===false &&
  stable(baseCurrentBuild)===stable(currentBuild) &&
  stable(baseCurrentSprint)===stable(cs) &&
  pfr06ReadinessAudit?.status==="READINESS_CANDIDATE" &&
  typeof pfr06ReadinessAudit?.approved_by==="string" &&
  pfr06ReadinessAudit.approved_by.includes("Human 2026-10-06") &&
  changed.includes("package-lock.json") &&
  changed.includes("delivery/audits/PFR-06-WEB-READINESS.json") &&
  changed.every(p=>pfr06ReadinessPaths.has(p));

if(approvedPfr06WebReadinessTransition){
  console.log("- Human-approved PFR-06 web readiness transition recognized; Product source remains forbidden while Sprint HOLD.");
}


// GOV-T006-F06-DEFER-T008-001: exact-once two-rule L3 candidacy, never implicit Human approval.
const f06DeferL3CasePath="delivery/constitutional-cases/GOV-T006-F06-DEFER-T008-001.json";
const f06DeferL3RulePaths=["harness/scripts/validate-backlog.mjs","harness/scripts/validate-change-scope.mjs"];
const f06DeferL3Paths=[...f06DeferL3RulePaths,f06DeferL3CasePath].sort();
const f06DeferL3Digest=()=>{
  const h=createHash("sha256");
  for(const rel of [...f06DeferL3RulePaths].sort()){
    h.update(rel+"\\0".replace("\\0",String.fromCharCode(0)));
    h.update(fs.readFileSync(path.join(root,rel)));
    h.update(String.fromCharCode(0));
  }
  return h.digest("hex");
};
const f06DeferL3ControlMatches=({base,changedPaths,beforeBuild,afterBuild,beforeSprint,afterSprint})=>
  base==="e495237d85ceaa2ae7c2c62d32678dcac4fa133b" &&
  sameJson([...changedPaths].sort(),f06DeferL3Paths) &&
  sameJson(beforeBuild,afterBuild) && sameJson(beforeSprint,afterSprint) &&
  afterBuild?.active_baseline==="BS-P1-025" && afterBuild.implementation_enabled===true &&
  afterSprint?.active_sprint==="SP-P1-003" && afterSprint.active_task==="T006" &&
  afterSprint.active_build_spec==="BS-P1-025" && afterSprint.status==="ACTIVE";
const f06DeferL3DocketMatches=(docket,base,digest)=>
  docket?.case_id==="GOV-T006-F06-DEFER-T008-001" && docket.base_sha===base &&
  sameJson([...(docket.exact_changed_paths||[])].sort(),[...f06DeferL3RulePaths].sort()) &&
  docket.candidate_digest_sha256===digest &&
  docket.deferred_acceptance_id==="F00-AC-037" &&
  docket.deferred_test_id==="TEST-F00-037" &&
  docket.deferred_scope==="F06_PREVIEW_ORIGIN_ONLY" &&
  docket.owner_product_progress_value===95;
const f06DeferL3ApprovalMatches=(docket,digest)=>{
  const a=docket?.human_approval||{};
  return a.case_id===docket?.case_id && a.source_kind==="DIRECT_HUMAN_MESSAGE" &&
    a.decision==="APPROVE_EXACT_CANDIDATE" && a.scope==="EXACT_PR_DIFF" &&
    a.candidate_digest_sha256===digest &&
    typeof a.human_message_ref==="string" && !!a.human_message_ref.trim() &&
    Number.isSafeInteger(a.approved_at_unix) && a.approved_at_unix>0;
};
const exactF06DeferL3Candidate=ctx=>
  f06DeferL3ControlMatches(ctx) &&
  f06DeferL3DocketMatches(ctx.docket,ctx.base,ctx.digest) &&
  f06DeferL3ApprovalMatches(ctx.docket,ctx.digest);
const testF06DeferL3Candidate=()=>{
  const fixture=()=>{
    const docket={case_id:"GOV-T006-F06-DEFER-T008-001",base_sha:"e495237d85ceaa2ae7c2c62d32678dcac4fa133b",
      exact_changed_paths:[...f06DeferL3RulePaths],
      deferred_acceptance_id:"F00-AC-037",deferred_test_id:"TEST-F00-037",
      deferred_scope:"F06_PREVIEW_ORIGIN_ONLY",owner_product_progress_value:95,
      candidate_digest_sha256:"f".repeat(64)};
    docket.human_approval={case_id:docket.case_id,source_kind:"DIRECT_HUMAN_MESSAGE",
      decision:"APPROVE_EXACT_CANDIDATE",scope:"EXACT_PR_DIFF",
      candidate_digest_sha256:docket.candidate_digest_sha256,
      human_message_ref:"SYNTHETIC-NON-HUMAN",approved_at_unix:1};
    const build={active_baseline:"BS-P1-025",implementation_enabled:true};
    const sprint={active_sprint:"SP-P1-003",active_build_spec:"BS-P1-025",active_task:"T006",status:"ACTIVE"};
    return {base:"e495237d85ceaa2ae7c2c62d32678dcac4fa133b",changedPaths:[...f06DeferL3Paths],
      beforeBuild:JSON.parse(JSON.stringify(build)),afterBuild:JSON.parse(JSON.stringify(build)),
      beforeSprint:JSON.parse(JSON.stringify(sprint)),afterSprint:JSON.parse(JSON.stringify(sprint)),
      docket,digest:docket.candidate_digest_sha256};
  };
  const cases=[
    ["exact",true,x=>x],
    ["approval missing",false,x=>{delete x.docket.human_approval;return x;}],
    ["bot approval",false,x=>{x.docket.human_approval.source_kind="BOT";return x;}],
    ["wrong sha",false,x=>{x.base="a".repeat(40);return x;}],
    ["wrong digest",false,x=>{x.digest="a".repeat(64);return x;}],
    ["extra protected file",false,x=>{x.changedPaths.push("ci/run-product-ci.mjs");return x;}],
    ["missing file",false,x=>{x.changedPaths.pop();return x;}],
    ["Task changed",false,x=>{x.afterSprint.active_task="T008";return x;}],
    ["Sprint changed",false,x=>{x.afterSprint.active_sprint="SP-P1-004";return x;}],
    ["Build changed",false,x=>{x.afterBuild.active_baseline="BS-P1-026";return x;}],
    ["fake F06 PASS",false,x=>{x.docket.deferred_test_id="TEST-F00-039";return x;}],
    ["fake PPV",false,x=>{x.docket.owner_product_progress_value=100;return x;}],
    ["approval ref missing",false,x=>{x.docket.human_approval.human_message_ref="";return x;}],
    ["approval stage wrong",false,x=>{x.docket.human_approval.decision="APPROVE_PLAN";return x;}]
  ];
  for(const [label,want,edit] of cases)
    if(exactF06DeferL3Candidate(edit(fixture()))!==want)
      throw Error("OWNER L3 CANDIDATE NEGATIVE FAILED: "+label);
  return cases.length;
};
console.log("- F06 defer L3 positive/negative: "+testF06DeferL3Candidate()+"/14 PASS (synthetic).");
const f06DeferL3Docket=readHeadJson(f06DeferL3CasePath);
const approvedF06DeferL3Candidate=Boolean(f06DeferL3Docket &&
  exactF06DeferL3Candidate({
    base:baseSha,changedPaths:changed,beforeBuild:baseCurrentBuild,afterBuild:currentBuild,
    beforeSprint:baseCurrentSprint,afterSprint:cs,
    docket:f06DeferL3Docket,digest:f06DeferL3Digest()
  }));
if(approvedF06DeferL3Candidate)
  console.log("- Exact Human-approved F06/T008 L3 rule candidate recognized; constitutional gate independently required.");

// GOV-T006-F06-PHASED-001: once-only L3 governance candidacy.
// Do not turn a draft into execution authority: requires exact Human candidate decision,
// fixed source main SHA, exact five paths, SHA256 of four rule files, unchanged Sprint/Build.
// Constitutional validator independently verifies the same signed-off dossier contract.
const p0DocketPath="delivery/constitutional-cases/GOV-T006-F06-PHASED-001.json";
const p0RulePaths=[
  "ci/run-product-ci.mjs",
  "harness/scripts/validate-backlog.mjs",
  "harness/scripts/validate-change-scope.mjs",
  "harness/scripts/validate-sprint.mjs"
];
const p0AllPaths=[...p0RulePaths,p0DocketPath].sort();
const p0Docket=readHeadJson(p0DocketPath);
const p0Digest=()=>{
  const h=createHash("sha256");
  for(const rel of [...p0RulePaths].sort()){
    h.update(rel+String.fromCharCode(0));
    h.update(fs.readFileSync(path.join(root,rel)));
    h.update(String.fromCharCode(0));
  }
  return h.digest("hex");
};
const matchesExactP0Control=({buildBefore,buildAfter,sprintBefore,sprintAfter})=>
  stable(buildBefore)===stable(buildAfter) && stable(sprintBefore)===stable(sprintAfter) &&
  sprintAfter?.active_sprint==="SP-P1-003" && sprintAfter.active_task==="T006" &&
  sprintAfter.active_build_spec==="BS-P1-025" && sprintAfter.status==="ACTIVE" &&
  buildAfter?.active_baseline==="BS-P1-025" && buildAfter.implementation_enabled===true;
const matchesExactP0Docket=({docket,base,digest})=>
  docket?.case_id==="GOV-T006-F06-PHASED-001" &&
  docket.constitution_version==="1.0" && docket.base_sha===base &&
  stable([...(docket.exact_changed_paths||[])].sort())===stable([...p0RulePaths].sort()) &&
  docket.candidate_digest_sha256===digest;
const matchesExactP0Human=({human,docket,digest})=>
  digest===human?.candidate_digest_sha256 &&
  human?.case_id===docket.case_id && human.source_kind==="DIRECT_HUMAN_MESSAGE" &&
  human.decision==="APPROVE_EXACT_CANDIDATE" && human.scope==="EXACT_PR_DIFF" &&
  typeof human.human_message_ref==="string" && human.human_message_ref.trim().length>0 &&
  Number.isSafeInteger(human.approved_at_unix) && human.approved_at_unix>0;
const isExactP0Candidate=({base,changed,buildBefore,buildAfter,sprintBefore,sprintAfter,docket,digest})=>
  base==="3c6eb63a009a515d9fa1038ad5cd1a81908469f6" &&
  stable([...changed].sort())===stable(p0AllPaths) &&
  matchesExactP0Control({buildBefore,buildAfter,sprintBefore,sprintAfter}) &&
  matchesExactP0Docket({docket,base,digest}) &&
  matchesExactP0Human({human:docket?.human_approval,docket,digest});
const testExactP0Candidate=()=>{
  const d={case_id:"GOV-T006-F06-PHASED-001",constitution_version:"1.0",base_sha:"3c6eb63a009a515d9fa1038ad5cd1a81908469f6",exact_changed_paths:[...p0RulePaths],candidate_digest_sha256:"SYNTHETIC",
    human_approval:{case_id:"GOV-T006-F06-PHASED-001",source_kind:"DIRECT_HUMAN_MESSAGE",decision:"APPROVE_EXACT_CANDIDATE",scope:"EXACT_PR_DIFF",candidate_digest_sha256:"SYNTHETIC",human_message_ref:"SYNTHETIC-NOT-REAL-APPROVAL",approved_at_unix:1}};
  const f=()=>({base:"3c6eb63a009a515d9fa1038ad5cd1a81908469f6",changed:[...p0AllPaths],buildBefore:{active_baseline:"BS-P1-025",implementation_enabled:true},buildAfter:{active_baseline:"BS-P1-025",implementation_enabled:true},sprintBefore:{active_sprint:"SP-P1-003",active_task:"T006",active_build_spec:"BS-P1-025",status:"ACTIVE"},sprintAfter:{active_sprint:"SP-P1-003",active_task:"T006",active_build_spec:"BS-P1-025",status:"ACTIVE"},docket:JSON.parse(JSON.stringify(d)),digest:"SYNTHETIC"});
  const cases=[
    ["exact synthetic",true,x=>x],["approval missing",false,x=>{delete x.docket.human_approval;return x;}],
    ["extra changed path",false,x=>{x.changed.push("src/app/evil.ts");return x;}],
    ["wrong baseline",false,x=>{x.buildAfter.active_baseline="BS-P1-026";return x;}],
    ["wrong Sprint",false,x=>{x.sprintAfter.active_task="T008";return x;}],
    ["wrong base SHA",false,x=>{x.base="a".repeat(40);return x;}],
    ["wrong digest",false,x=>{x.digest="WRONG";return x;}],
    ["fake source kind",false,x=>{x.docket.human_approval.source_kind="BOT_COMMENT";return x;}],
    ["unauthorized decision",false,x=>{x.docket.human_approval.decision="APPROVE_PLAN";return x;}],
    ["missing human source",false,x=>{x.docket.human_approval.human_message_ref="";return x;}]
  ];
  for(const [name,want,edit] of cases)if(isExactP0Candidate(edit(f()))!==want)throw Error("P0 scope negative guard FAIL: "+name);
  return cases.length;
};
console.log("- P0 scope synthetic positive/negative guard: "+testExactP0Candidate()+"/10 PASS (synthetic, NOT Human approval).");
const approvedP0GovernanceCandidate=Boolean(
  p0Docket &&
  isExactP0Candidate({base:baseSha,changed,buildBefore:baseCurrentBuild,buildAfter:currentBuild,
    sprintBefore:baseCurrentSprint,sprintAfter:cs,docket:p0Docket,digest:p0Digest()})
);
if(approvedP0GovernanceCandidate) console.log("- Exact Human-approved P0 scope candidate recognized; independent constitutional gate remains mandatory.");

// GOV-T006-BS026-FREEZE-001 — once-only, fail-closed bridge from approved L2
// Composer-only Design to one immutable Build Freeze while T006 is active/blocked.
// This does NOT approve any Product TEST, activation, Cursor lease, T008, or merge.
const bs026DocketPath="delivery/constitutional-cases/GOV-T006-BS026-FREEZE-001.json";
const bs026RulePath="harness/scripts/validate-change-scope.mjs";
const bs026ProductCiPath="ci/run-product-ci.mjs";
const bs026GovRulePaths=[bs026ProductCiPath,bs026RulePath].sort();
const bs026GovAllPaths=[bs026DocketPath,...bs026GovRulePaths].sort();
const bs026Docket=readHeadJson(bs026DocketPath);
const bs026RuleDigest=()=>{
  const h=createHash("sha256");
  for(const rel of bs026GovRulePaths){
    h.update(rel+String.fromCharCode(0));
    h.update(fs.readFileSync(path.join(root,rel)));
    h.update(String.fromCharCode(0));
  }
  return h.digest("hex");
};
const bs026SelfApprovalValid=({docket,digest,base,changed,cs,build,oldSprint,oldBuild})=>{
  const caseFile=docket||{},human=caseFile.human_approval||{},sprint=cs||{},baseline=build||{};
  return [
    base==="c596a657a31d843df070bdfdfed84cc8dc6d7c20",
    sameJson([...changed].sort(),bs026GovAllPaths),
    sameJson(cs,oldSprint),
    sameJson(build,oldBuild),
    sprint.active_sprint==="SP-P1-003",
    sprint.active_task==="T006",
    sprint.active_build_spec==="BS-P1-025",
    sprint.status==="ACTIVE",
    baseline.active_baseline==="BS-P1-025",
    caseFile.case_id==="GOV-T006-BS026-FREEZE-001",
    caseFile.base_sha===base,
    caseFile.constitution_version==="1.0",
    sameJson([...(caseFile.exact_changed_paths||[])].sort(),bs026GovRulePaths),
    caseFile.candidate_digest_sha256===digest,
    human.case_id===caseFile.case_id,
    human.source_kind==="DIRECT_HUMAN_MESSAGE",
    human.decision==="APPROVE_EXACT_CANDIDATE",
    human.scope==="EXACT_PR_DIFF",
    human.candidate_digest_sha256===digest,
    typeof human.human_message_ref==="string",
    Boolean(typeof human.human_message_ref==="string" && human.human_message_ref.trim()),
    Number.isSafeInteger(human.approved_at_unix),
    human.approved_at_unix>0
  ].every(Boolean);
};
const bs026ProtectedAmendment=Boolean(bs026Docket && bs026SelfApprovalValid({
  docket:bs026Docket,digest:bs026RuleDigest(),base:baseSha,changed,
  cs,build:currentBuild,oldSprint:baseCurrentSprint,oldBuild:baseCurrentBuild
}));
const bs026NewPathPrefix="build-spec/baselines/BS-P1-026/";
const bs026DeltaPath="delivery/deltas/BD-026.json";
const bs026FindingPath="delivery/findings/BF-055.json";
const bs026AuditPath="delivery/audits/SP-P1-003-BD-026-FREEZE-CANDIDATE.md";
const bs026AllowedExtra=new Set([bs026DeltaPath,bs026FindingPath,bs026AuditPath]);
const bs026KnownHash="481599d68791b7bb1e19525f141e6b46f5c93755fbdef9744fda20b74271a536";
const exactBs026FreezeOnly=({paths,sprint,current,previousSprint,previousBuild,manifest,delta,finding,auditPresent})=>{
  const outputPaths=paths.filter(p=>p.startsWith(bs026NewPathPrefix));
  const s=sprint||{},b=current||{},m=manifest||{},approved=m.approval||{},designDelta=delta||{},bf=finding||{},deltaDecision=designDelta.user_decision||{};
  return [
    outputPaths.length===53,
    paths.length===56,
    paths.every(p=>p.startsWith(bs026NewPathPrefix) || bs026AllowedExtra.has(p)),
    [...bs026AllowedExtra].every(p=>paths.includes(p)),
    outputPaths.every(p=>p!==bs026NewPathPrefix && !p.includes("..")),
    ["ACTIVE","BLOCKED"].includes(s.status),
    s.active_sprint==="SP-P1-003",
    s.active_task==="T006",
    s.active_build_spec==="BS-P1-025",
    sameJson(sprint,previousSprint),
    sameJson(current,previousBuild),
    b.active_baseline==="BS-P1-025",
    b.implementation_enabled===true,
    m.baseline_id==="BS-P1-026",
    m.status==="LOCKED",
    m.supersedes==="BS-P1-025",
    m.source_working_commit==="7129e16a7110b40d009b963d9937e41c83cadb02",
    m.content_sha256===bs026KnownHash,
    m.acceptance_count===308,
    approved.status==="USER_APPROVED",
    typeof approved.decision_ref==="string",
    Boolean(typeof approved.decision_ref==="string" && approved.decision_ref.trim()),
    Array.isArray(m.approved_delta_ids),
    (m.approved_delta_ids||[]).includes("BD-026"),
    designDelta.delta_id==="BD-026",
    designDelta.type==="DESIGN_DELTA",
    ["APPROVED","IMPLEMENTING"].includes(designDelta.status),
    deltaDecision.status==="APPROVED",
    designDelta.affected_build_spec==="BS-P1-025",
    designDelta.replacement_build_spec==="BS-P1-026",
    bf.finding_id==="BF-055",
    ["RESOLVED","CLOSED"].includes(bf.status),
    auditPresent===true
  ].every(Boolean);
};
const approvedBs026FreezeOnly=exactBs026FreezeOnly({
  paths:changed,sprint:cs,current:currentBuild,
  previousSprint:baseCurrentSprint,previousBuild:baseCurrentBuild,
  manifest:readHeadJson(bs026NewPathPrefix+"manifest.json"),
  delta:readHeadJson(bs026DeltaPath),
  finding:readHeadJson(bs026FindingPath),
  auditPresent:fs.existsSync(path.join(root,bs026AuditPath))
});
const testBs026FreezeBoundary=()=>{
  const prefix=bs026NewPathPrefix;
  const paths=Array.from({length:53},(_,i)=>prefix+"example-"+i+".md").concat([...bs026AllowedExtra]);
  const sprint={active_sprint:"SP-P1-003",active_task:"T006",active_build_spec:"BS-P1-025",status:"BLOCKED"};
  const current={active_baseline:"BS-P1-025",implementation_enabled:true};
  const manifest={baseline_id:"BS-P1-026",status:"LOCKED",supersedes:"BS-P1-025",
    source_working_commit:"7129e16a7110b40d009b963d9937e41c83cadb02",
    content_sha256:bs026KnownHash,acceptance_count:308,
    approval:{status:"USER_APPROVED",decision_ref:"SYNTHETIC-TEST-NOT-HUMAN"},
    approved_delta_ids:["BD-026"]};
  const delta={delta_id:"BD-026",type:"DESIGN_DELTA",status:"APPROVED",
    user_decision:{status:"APPROVED"},affected_build_spec:"BS-P1-025",replacement_build_spec:"BS-P1-026"};
  const finding={finding_id:"BF-055",status:"RESOLVED"};
  const fixture=()=>({paths:[...paths],sprint:{...sprint},current:{...current},
    previousSprint:{...sprint},previousBuild:{...current},
    manifest:JSON.parse(JSON.stringify(manifest)),delta:JSON.parse(JSON.stringify(delta)),
    finding:{...finding},auditPresent:true});
  const cases=[
    ["exact synthetic",true,x=>x],
    ["missing approval",false,x=>{x.manifest.approval.status="PENDING_HUMAN_APPROVAL";return x;}],
    ["wrong locked source",false,x=>{x.manifest.source_working_commit="a".repeat(40);return x;}],
    ["wrong digest",false,x=>{x.manifest.content_sha256="a".repeat(64);return x;}],
    ["extra product code",false,x=>{x.paths.push("src/app/evil.ts");return x;}],
    ["missing audit",false,x=>{x.auditPresent=false;return x;}],
    ["wrong Task",false,x=>{x.sprint.active_task="T008";return x;}],
    ["state not paused",false,x=>{x.sprint.status="REVIEW";return x;}],
    ["sprint changed in PR",false,x=>{x.previousSprint.status="ACTIVE";return x;}],
    ["wrong baseline",false,x=>{x.current.active_baseline="BS-P1-026";return x;}],
    ["delta unapproved",false,x=>{x.delta.user_decision.status="PENDING";return x;}],
    ["finding not resolved",false,x=>{x.finding.status="OPEN";return x;}]
  ];
  for(const [name,want,mutate] of cases)if(exactBs026FreezeOnly(mutate(fixture()))!==want)
    throw Error("BS026 narrow freeze guard fixture FAIL: "+name);
  return cases.length;
};
console.log("- BS026 freeze-only guard synthetic: "+testBs026FreezeBoundary()+"/12 PASS (synthetic; not Human Product evidence).");
if(bs026ProtectedAmendment) console.log("- Exact Human-approved BS026 narrow L3 rule amendment recognized; constitutional audit required.");
if(approvedBs026FreezeOnly) console.log("- Exact BS026 Human-approved freeze-only diff recognized; immutable Baseline/Delta/Evidence validators remain binding.");

const foundedConstitutionException=isOneTimeConstitutionFounding({
  changed,base:baseSha,cs,build:currentBuild
});
if(foundedConstitutionException) console.log("- GOV-CONST-001 single-SHA founding exception (governance-only exact paths, expires after main advances).");

const boundedT005PercentRepair = isExactT005PercentGovernanceRepair({
  base:baseSha,
  head:process.env.HEAD_SHA||"HEAD",
  changed,
  current:cs,
  build:currentBuild
});
try {
  const n=testT005PercentRepairGuard();
  console.log("- T005 bounded repair guard: "+n+" positive/negative regression cases PASS.");
} catch(error) { errors.push(String(error)); }
if(boundedT005PercentRepair) console.log("- "+T005_PERCENT_GATE_MARKER+".");

const pg001DependencyHoldUpdate=isExactPg001DependencyHoldUpdate({root,base:baseSha,changed,cs,build:currentBuild});
try {
  const n=testPg001DependencyHoldPathGuard();
  console.log("- PG-001 dependency HOLD path guard: "+n+" positive/negative regression cases PASS.");
} catch(error) { errors.push(String(error)); }
if(pg001DependencyHoldUpdate) console.log("- "+PG001_DEPENDENCY_GATE_MARKER+"; constitutional docket still required.");

// CLOSED Tasks are final: any later diff must keep them byte-identical (canonical JSON) and present.
const closedTaskViolations=(beforeTd,afterTd)=>{
  const after=new Map((afterTd?.tasks||[]).map(t=>[t.task_id,t]));
  return (beforeTd?.tasks||[]).filter(t=>t.status==="CLOSED" && !sameJson(t,after.get(t.task_id))).map(t=>t.task_id);
};
// A CLOSED revalidation may only stay in place or be appended unchanged to revalidation_history.
const revalidationHistoryKept=(b,a)=>{
  if(!a) return false;
  const bh=b.revalidation_history||[], ah=a.revalidation_history||[];
  if(!appendOnly(bh,ah)) return false;
  return b.revalidation?.status!=="CLOSED" || sameJson(b.revalidation,a.revalidation) || sameJson(b.revalidation,ah[bh.length]);
};
const closedRevalidationViolations=(beforeQueue,afterQueue)=>{
  const after=new Map((afterQueue?.items||[]).map(i=>[i.backlog_item_id,i]));
  return (beforeQueue?.items||[]).filter(b=>!revalidationHistoryKept(b,after.get(b.backlog_item_id))).map(b=>b.backlog_item_id);
};
const checkHistoryGuards=()=>{
  const closed={task_id:"T001",status:"CLOSED",build_spec_id:"BS-P1-021",acceptance_links:[{acceptance_id:"F01-AC-013",test_id:"TEST-F01-API-001"}]};
  const td={tasks:[closed,{task_id:"T006",status:"BLOCKED",build_spec_id:"BS-P1-024"}]};
  const taskCases=[
    ["CLOSED Task unchanged, open Task rebound",0,{tasks:[closed,{task_id:"T006",status:"BLOCKED",build_spec_id:"BS-P1-025"}]}],
    ["CLOSED Task rebound",1,{tasks:[{...closed,build_spec_id:"BS-P1-025"},td.tasks[1]]}],
    ["CLOSED Task acceptance edited",1,{tasks:[{...closed,acceptance_links:[]},td.tasks[1]]}],
    ["CLOSED Task reopened",1,{tasks:[{...closed,status:"IN_PROGRESS"},td.tasks[1]]}],
    ["CLOSED Task deleted",1,{tasks:[td.tasks[1]]}]
  ];
  for(const [name,n,after] of taskCases) if(closedTaskViolations(td,after).length!==n) errors.push("CLOSED Task guard self-test failed: "+name);
  const r={target_build_spec_id:"BS-P1-024",status:"CLOSED",sprint_id:"SP-P1-003",task_id:"T007",acceptance_ids:["F01-AC-004"]};
  const next={target_build_spec_id:"BS-P1-025",status:"IN_PROGRESS",sprint_id:"SP-P1-003",task_id:"T008",acceptance_ids:["F01-AC-017"]};
  const q={items:[{backlog_item_id:"BL-P1-008",revalidation:r}]};
  const qCases=[
    ["CLOSED revalidation unchanged",0,q],
    ["CLOSED revalidation appended to history",0,{items:[{backlog_item_id:"BL-P1-008",revalidation_history:[r],revalidation:next}]}],
    ["CLOSED revalidation overwritten",1,{items:[{backlog_item_id:"BL-P1-008",revalidation:next}]}],
    ["CLOSED revalidation edited into history",1,{items:[{backlog_item_id:"BL-P1-008",revalidation_history:[{...r,acceptance_ids:["F01-AC-017"]}],revalidation:next}]}],
    ["history entry removed",1,{items:[{backlog_item_id:"BL-P1-008",revalidation:next}]},{items:[{backlog_item_id:"BL-P1-008",revalidation_history:[r],revalidation:next}]}],
    ["backlog item deleted",1,{items:[]}]
  ];
  for(const [name,n,after,before] of qCases) if(closedRevalidationViolations(before||q,after).length!==n) errors.push("CLOSED revalidation guard self-test failed: "+name);
  if(!errors.some(e=>/guard self-test failed/.test(e))) console.log("- CLOSED Task / CLOSED revalidation history guards: "+(taskCases.length+qCases.length)+" positive/negative regression cases PASS.");
};
checkHistoryGuards();
if(baseSha && !/^0+$/.test(baseSha)){
  for(const rel of changed.filter(p=>/^delivery\/sprints\/SP-P\d+-\d{3}\/tasks\.json$/.test(p))){
    for(const id of closedTaskViolations(showBaseJson(rel),readHeadJson(rel))) errors.push("CLOSED Task must remain byte-identical: "+rel+" "+id);
  }
  if(changed.includes("delivery/backlog/QUEUE.json")){
    for(const id of closedRevalidationViolations(showBaseJson("delivery/backlog/QUEUE.json"),readHeadJson("delivery/backlog/QUEUE.json"))){
      errors.push("CLOSED revalidation must be preserved or appended unchanged to revalidation_history: "+id);
    }
  }
}

// Exactly one post-#372 correction: pause newly introduced T008 and focus
// the existing active Sprint on T006 without altering its Task definitions,
// any revalidation binding/status, or a single CLOSED Task.
const t006FocusExpectedPaths=[
  "delivery/CURRENT-SPRINT.json",
  "delivery/constitutional-cases/GOV-BS025-T006-FOCUS-001.json",
  "delivery/sprints/SP-P1-003/tasks.json",
  "harness/scripts/validate-backlog.mjs",
  "harness/scripts/validate-change-scope.mjs",
  "harness/scripts/validate-sprint.mjs"
];
const exactT006FocusPaths=()=>
  baseSha==="e0018f52388789ba10c3f3b034e701949c2f4564" &&
  stable([...changed].sort())===stable([...t006FocusExpectedPaths].sort());
const exactT006FocusStableRegistry=()=>
  sameJson(showBaseJson("build-spec/CURRENT.json"),currentBuild) &&
  sameJson(showBaseJson("delivery/backlog/QUEUE.json"),readHeadJson("delivery/backlog/QUEUE.json")) &&
  sameJson(showBaseJson("delivery/sprints/SP-P1-003/manifest.json"),
    readHeadJson("delivery/sprints/SP-P1-003/manifest.json"));
const exactT006FocusSprint=(before,after)=>{
  const oldIdentity={sprint:before.active_sprint,build:before.active_build_spec,task:before.active_task,status:before.status};
  const newIdentity={sprint:after.active_sprint,build:after.active_build_spec,task:after.active_task,status:after.status};
  return sameJson(oldIdentity,{sprint:"SP-P1-003",build:"BS-P1-025",task:"T008",status:"ACTIVE"}) &&
    sameJson(newIdentity,{sprint:"SP-P1-003",build:"BS-P1-025",task:"T006",status:"ACTIVE"}) &&
    sameJson(omit(before,["active_task","reason"]),omit(after,["active_task","reason"]));
};
const exactT006FocusTaskStates=(beforeTd,afterTd)=>{
  if(!sameJson(omit(beforeTd,["tasks"]),omit(afterTd,["tasks"])) ||
    beforeTd.tasks.length!==afterTd.tasks.length) return false;
  const expected={T006:["BLOCKED","IN_PROGRESS"],T008:["IN_PROGRESS","BLOCKED"]};
  const seen=new Set();
  for(let i=0;i<beforeTd.tasks.length;i++){
    const prev=beforeTd.tasks[i],next=afterTd.tasks[i];
    if(prev.task_id!==next.task_id ||
       !sameJson(omit(prev,["status"]),omit(next,["status"]))) return false;
    const states=Object.hasOwn(expected,prev.task_id)?expected[prev.task_id]:null;
    if(!states){
      if(prev.status!==next.status) return false;
      continue;
    }
    if(prev.status!==states[0] || next.status!==states[1]) return false;
    seen.add(prev.task_id);
  }
  return seen.size===2;
};
const t006FocusSwitch=(()=>{
  if(!exactT006FocusPaths() || !exactT006FocusStableRegistry()) return false;
  const oldCS=showBaseJson("delivery/CURRENT-SPRINT.json");
  const oldTD=showBaseJson("delivery/sprints/SP-P1-003/tasks.json");
  const newTD=readHeadJson("delivery/sprints/SP-P1-003/tasks.json");
  if(!oldCS || !oldTD || !newTD) return false;
  return exactT006FocusSprint(oldCS,cs) && exactT006FocusTaskStates(oldTD,newTD);
})();
if(t006FocusSwitch) console.log("- Exact Human-directed T006 focus switch recognized: T008 BLOCKED, revalidations still unfinished.");

// BS-P1-025: exactly two Human-directed legacy F00 fixture rebinds and one
// non-semantic lint refactor. Bound to the exact merged main; never a general
// override for Product tests, Task status, Sprint transitions, or governance.
const t006R2MaintenancePaths=new Set([
  "delivery/sprints/SP-P1-003/tasks.json",
  "harness/scripts/validate-backlog.mjs",
  "harness/scripts/validate-change-scope.mjs",
  "ci/run-product-ci.mjs",
  "delivery/constitutional-cases/GOV-T006-R2-MAINT-001.json"
]);
const t006R2ExpectedMaintenance=[
  {test_id:"TEST-F00-001",file:"tests/e2e/f00-create-shell.spec.ts",mode:"BASELINE_FIXTURE_REBIND",from_build_spec:"BS-P1-024",to_build_spec:"BS-P1-025"},
  {test_id:"TEST-F00-038",file:"tests/e2e/f00-create-shell.spec.ts",mode:"BASELINE_FIXTURE_REBIND",from_build_spec:"BS-P1-024",to_build_spec:"BS-P1-025"}
];
const t006R2MaintenanceTaskShape=(before,after)=>{
  if(!before || !after || !Array.isArray(before.tasks) || !Array.isArray(after.tasks)) return false;
  if(before.tasks.length!==after.tasks.length ||
     !sameJson(omit(before,["tasks"]),omit(after,["tasks"]))) return false;
  return before.tasks.every((previous,index)=>{
    const next=after.tasks[index];
    if(previous.task_id!==next?.task_id) return false;
    if(previous.task_id!=="T006") return sameJson(previous,next);
    if(Object.hasOwn(previous,"test_maintenance_authorizations")) return false;
    return sameJson(omit(previous,["test_maintenance_authorizations"]),omit(next,["test_maintenance_authorizations"])) &&
      sameJson(next.test_maintenance_authorizations,t006R2ExpectedMaintenance);
  });
};
const t006R2MaintenanceRepair=(()=>{
  if(baseSha!=="67cd2217c7b94cc564c5e730aa03227c2085fb31") return false;
  if(changed.length!==t006R2MaintenancePaths.size ||
     !changed.every(p=>t006R2MaintenancePaths.has(p))) return false;
  if(!sameJson(baseCurrentSprint,cs) || !sameJson(baseCurrentBuild,currentBuild)) return false;
  if(cs.status!=="ACTIVE" || cs.active_sprint!=="SP-P1-003" ||
     cs.active_task!=="T006" || cs.active_build_spec!=="BS-P1-025") return false;
  return t006R2MaintenanceTaskShape(
    showBaseJson("delivery/sprints/SP-P1-003/tasks.json"),
    readHeadJson("delivery/sprints/SP-P1-003/tasks.json")
  );
})();
if(t006R2MaintenanceRepair) console.log("- Exact T006 R2 F00 fixture rebind + lint repair recognized; CLOSED Tasks / Product truth frozen.");

// GOV-392 ADMINISTRATIVE_WITH_CARRY_FORWARD: the only Sprint closure that may leave open work.
// Recognized solely as one exact, Human-bound control transition judged by the BASE policy and
// the strict carry-forward/closure validator. Any other closure-shaped diff fails closed here,
// independently of the HOLD branch below and of the governance/Sprint gates.
const ADMIN_CLOSE_DOCKET_DIR="delivery/constitutional-cases/";
const ADMIN_CLOSE_MANIFEST_RE=/^delivery\/sprints\/(SP-P\d+-\d{3})\/manifest\.json$/;
const ADMIN_CLOSE_OPEN_STATUSES=["ACTIVE","REVIEW","BLOCKED"];
const ADMIN_CLOSE_MANIFEST_KEYS=["status","closure_disposition","administrative_closure"];
const ADMIN_CLOSE_SPRINT_KEYS=["active_sprint","active_build_spec","active_task","status","reason"];
const isAdminClosureAttempt=({changed,readBaseJson,readHeadJson})=>changed.some(p=>{
  if(ADMIN_CLOSE_MANIFEST_RE.test(p)){
    const after=readHeadJson(p)||{};
    return (after.closure_disposition===ADMIN_CLOSURE || Object.hasOwn(after,"administrative_closure")) &&
      readBaseJson(p)?.closure_disposition!==ADMIN_CLOSURE;
  }
  return p.startsWith(ADMIN_CLOSE_DOCKET_DIR) && p.endsWith(".json") &&
    readHeadJson(p)?.closure_disposition!==undefined && !readBaseJson(p);
});
const adminClosureStateErrors=({sid,before,after,baseSprint,headSprint,baseBuild,headBuild})=>{
  const e=[];
  if(!before || !ADMIN_CLOSE_OPEN_STATUSES.includes(before.status) || after?.status!=="CLOSED" ||
     !sameJson(omit(before,ADMIN_CLOSE_MANIFEST_KEYS),omit(after,ADMIN_CLOSE_MANIFEST_KEYS))){
    e.push(sid+" manifest may only move an open Sprint to CLOSED adding closure_disposition/administrative_closure");
  }
  if(baseSprint?.active_sprint!==sid || !ADMIN_CLOSE_OPEN_STATUSES.includes(baseSprint?.status)) e.push("only the BASE active Sprint can be administratively closed: "+sid);
  const hold=headSprint?.status==="HOLD" && headSprint.active_sprint===null &&
    headSprint.active_build_spec===null && headSprint.active_task===null;
  if(!hold || !sameJson(omit(baseSprint,ADMIN_CLOSE_SPRINT_KEYS),omit(headSprint,ADMIN_CLOSE_SPRINT_KEYS))){
    e.push("delivery/CURRENT-SPRINT.json must move to HOLD with no Sprint/Build Spec/Task binding and nothing else changed");
  }
  if(headBuild?.implementation_enabled!==false ||
     !sameJson(omit(baseBuild,["implementation_enabled","reason"]),omit(headBuild,["implementation_enabled","reason"]))){
    e.push("build-spec/CURRENT.json may only set implementation_enabled=false (and reason)");
  }
  return e;
};
const adminClosureTransitionErrors=ctx=>{
  const {base,changed,readBaseJson,readHeadJson,now}=ctx;
  if(!/^[0-9a-f]{40}$/.test(base||"")) return ["requires an exact BASE_SHA"];
  const full=readBaseJson(GOVERNANCE_REFORM_POLICY_PATH),cf=full?.carry_forward;
  if(cf?.enforced!==true || full?.administrative_closure?.disposition!==ADMIN_CLOSURE){
    return ["BASE policy does not enforce carry_forward/administrative_closure (rules and closure cannot share one PR)"];
  }
  const manifests=changed.filter(p=>ADMIN_CLOSE_MANIFEST_RE.test(p) && readHeadJson(p)?.closure_disposition===ADMIN_CLOSURE);
  if(manifests.length!==1) return ["exactly one Sprint manifest must move to "+ADMIN_CLOSURE+" (found "+manifests.length+")"];
  const manifestPath=manifests[0],sid=ADMIN_CLOSE_MANIFEST_RE.exec(manifestPath)[1],after=readHeadJson(manifestPath);
  const docketPath=cf.docket_dir+after.administrative_closure?.case_id+".json",docket=readHeadJson(docketPath);
  const required=[docketPath,cf.register_path,manifestPath,"delivery/CURRENT-SPRINT.json","build-spec/CURRENT.json"];
  const e=[
    ...required.filter(p=>!changed.includes(p)).map(p=>"required closure path missing: "+p),
    ...changed.filter(p=>!required.includes(p)).map(p=>"path outside the exact closure set: "+p),
    ...adminClosureStateErrors({sid,before:readBaseJson(manifestPath),after,
      baseSprint:readBaseJson("delivery/CURRENT-SPRINT.json"),headSprint:readHeadJson("delivery/CURRENT-SPRINT.json"),
      baseBuild:readBaseJson("build-spec/CURRENT.json"),headBuild:readHeadJson("build-spec/CURRENT.json")})
  ];
  const approvedAt=docket?.human_approval?.approved_at_unix;
  if(Number.isSafeInteger(approvedAt) && approvedAt>now+(full.exception?.max_clock_skew_seconds||0)) e.push("Human closure approval timestamp is in the future");
  e.push(...inspectCarryForwardChange({...ctx,basePolicyFull:full,headPolicyFull:readHeadJson(GOVERNANCE_REFORM_POLICY_PATH)}).errors);
  const queue=readHeadJson("delivery/backlog/QUEUE.json");
  e.push(...closedSprintErrors({sid,m:after,td:readHeadJson("delivery/sprints/"+sid+"/tasks.json")||{tasks:[]},
    backlogById:new Map((queue?.items||[]).map(i=>[i.backlog_item_id,i])),
    selectedIds:new Set(after.backlog_item_ids||[]),revalidationIds:new Set(after.revalidation_item_ids||[]),
    docket,full,register:readHeadJson(cf.register_path)}));
  e.push(...ctx.headRegisterErrors());
  return e;
};
if(isAdminClosureAttempt({changed,readBaseJson:showBaseJson,readHeadJson})){
  const readHeadBytes=rel=>{
    if(!/^[a-zA-Z0-9/_.@-]+$/.test(rel) || rel.includes("..")) return null;
    try{return fs.readFileSync(path.join(root,rel));}catch{return null;}
  };
  const baseDocketDigests=new Set();
  if(baseSha && !/^0+$/.test(baseSha)){
    let names=[];
    try{names=execFileSync("git",["ls-tree","--name-only",baseSha,ADMIN_CLOSE_DOCKET_DIR],{encoding:"utf8",stdio:["ignore","pipe","ignore"]}).trim().split("\n").filter(Boolean);}
    catch{names=[];}
    for(const rel of names){const d=showBaseJson(rel); if(d?.candidate_digest_sha256) baseDocketDigests.add(d.candidate_digest_sha256);}
  }
  const adminErrors=adminClosureTransitionErrors({base:baseSha,changed,readHead:readHeadBytes,readHeadJson,readBaseJson:showBaseJson,
    baseDocketDigests,now:Math.floor(Date.now()/1000),headRegisterErrors:()=>validateRepoCarryForwardRegister(root)});
  for(const x of adminErrors) errors.push("ADMINISTRATIVE_WITH_CARRY_FORWARD control transition rejected: "+x);
  if(!adminErrors.length) console.log("- Exact Human-bound "+ADMIN_CLOSURE+" control transition recognized (BASE policy, exact paths/bytes); NOT Product PASS; Human provenance must still be verified manually.");
}

if(cs.active_sprint===null){
  if(!approvedPfr06WebReadinessTransition && !pg001DependencyHoldUpdate && !humanExceptionScope){
    for(const p of changed) if(isImpl(p)) errors.push("Product/task-scoped implementation changed while Sprint HOLD: "+p);
  }
}else if(safeControlTransition || t006FocusSwitch || t006R2MaintenanceRepair || approvedRebaselineTransition || boundedT005PercentRepair || foundedConstitutionException || approvedP0GovernanceCandidate || approvedF06DeferL3Candidate || bs026ProtectedAmendment || approvedBs026FreezeOnly || humanExceptionScope){
  // Structural/activation validators decide whether the governance transition itself is legal.
}else if(cs.status==="BLOCKED"){
  for(const p of changed) if(!isSideEffect(p)) errors.push("Sprint BLOCKED: only Finding/Evidence side effects are allowed outside an approved rebaseline transition: "+p);
}else if(["ACTIVE","REVIEW"].includes(cs.status)){
  const tasks=read("delivery/sprints/"+cs.active_sprint+"/tasks.json").tasks||[];
  const task=tasks.find(t=>t.task_id===cs.active_task);
  if(!task) errors.push("Active Task not found for scope validation: "+cs.active_task);
  else{
    for(const p of changed){
      if(isSideEffect(p)) continue;
      if(isGov(p)){errors.push("Governance-only path changed during execution: "+p); continue;}
      if(!pathAllowed(p,task.allowed_write_paths||[])) errors.push("Active Task "+task.task_id+" undeclared write forbidden: "+p);
    }
  }
}

if(errors.length){console.error("CHANGE SCOPE GATE: FAIL");errors.forEach(e=>console.error("- "+e));process.exit(1);}
console.log("CHANGE SCOPE GATE: PASS");
if(!changed.length) console.log("- No diff base / local changes detected; structural gates still enforced.");
