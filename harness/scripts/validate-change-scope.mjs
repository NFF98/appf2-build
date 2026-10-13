import fs from "node:fs";
import { createHash } from "node:crypto";
import { isOneTimeConstitutionFounding } from "./validate-constitutional-change.mjs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { isExactT005PercentGovernanceRepair, testT005PercentRepairGuard, T005_PERCENT_GATE_MARKER } from "./t005-percent-test-compat.mjs";
import { isExactPg001DependencyHoldUpdate, testPg001DependencyHoldPathGuard, PG001_DEPENDENCY_GATE_MARKER } from "./pg001-dependency-hold-path.mjs";

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
const isSideEffect=p=>sideEffectPrefixes.some(prefix=>p.startsWith(prefix));
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
const targetSprint=cs.active_sprint || baseCurrentSprint?.active_sprint;
const controlAllowed=new Set([
  "build-spec/CURRENT.json",
  "delivery/CURRENT-SPRINT.json",
  "delivery/backlog/QUEUE.json",
  ...(targetSprint?["delivery/sprints/"+targetSprint+"/manifest.json","delivery/sprints/"+targetSprint+"/tasks.json"]:[])
]);
let safeControlTransition=false;
if(changed.length && changed.every(p=>controlAllowed.has(p)) && baseSha && !/^0+$/.test(baseSha)){
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


// GOV-T006-F06-PHASED-001: once-only L3 governance candidacy.
// Do not turn a draft into execution authority: requires exact Human candidate decision,
// fixed source main SHA, exact four paths, SHA256 of three rule files, unchanged Sprint/Build.
// Constitutional validator independently verifies the same signed-off dossier contract.
const p0DocketPath="delivery/constitutional-cases/GOV-T006-F06-PHASED-001.json";
const p0RulePaths=[
  "harness/scripts/validate-backlog.mjs",
  "harness/scripts/validate-change-scope.mjs",
  "harness/scripts/validate-sprint.mjs"
];
const p0AllPaths=[...p0RulePaths,p0DocketPath].sort();
const p0Docket=readHeadJson(p0DocketPath);
const p0Digest=()=>{
  const h=createHash("sha256");
  for(const rel of [...p0RulePaths].sort()){
    h.update(rel+"\\0");
    h.update(fs.readFileSync(path.join(root,rel)));
    h.update("\\0");
  }
  return h.digest("hex");
};
const isExactP0Candidate=({base,changed,buildBefore,buildAfter,sprintBefore,sprintAfter,docket,digest})=>{
  const human=docket?.human_approval;
  return base==="3c6eb63a009a515d9fa1038ad5cd1a81908469f6" &&
    stable([...changed].sort())===stable(p0AllPaths) &&
    stable(buildBefore)===stable(buildAfter) && stable(sprintBefore)===stable(sprintAfter) &&
    sprintAfter?.active_sprint==="SP-P1-003" && sprintAfter.active_task==="T006" &&
    sprintAfter.active_build_spec==="BS-P1-025" && sprintAfter.status==="ACTIVE" &&
    buildAfter?.active_baseline==="BS-P1-025" && buildAfter.implementation_enabled===true &&
    docket?.case_id==="GOV-T006-F06-PHASED-001" && docket.constitution_version==="1.0" &&
    docket.base_sha===base &&
    stable([...(docket.exact_changed_paths||[])].sort())===stable([...p0RulePaths].sort()) &&
    docket.candidate_digest_sha256===digest && digest===human?.candidate_digest_sha256 &&
    human?.case_id===docket.case_id && human.source_kind==="DIRECT_HUMAN_MESSAGE" &&
    human.decision==="APPROVE_EXACT_CANDIDATE" && human.scope==="EXACT_PR_DIFF" &&
    typeof human.human_message_ref==="string" && human.human_message_ref.trim().length>0 &&
    Number.isSafeInteger(human.approved_at_unix) && human.approved_at_unix>0;
};
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

if(cs.active_sprint===null){
  if(!approvedPfr06WebReadinessTransition && !pg001DependencyHoldUpdate){
    for(const p of changed) if(isImpl(p)) errors.push("Product/task-scoped implementation changed while Sprint HOLD: "+p);
  }
}else if(safeControlTransition || t006FocusSwitch || t006R2MaintenanceRepair || approvedRebaselineTransition || boundedT005PercentRepair || foundedConstitutionException || approvedP0GovernanceCandidate){
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
