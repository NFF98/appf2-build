import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

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
  return oldTask.status==="IN_PROGRESS" &&
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
    ["wrong Sprint identity",false,oldQueue,newQueue,oldTd,replace(newTd,{sprint_id:"SP-P1-004"})]
  ];
  for(const [name,expected,before,after,tasksBefore,tasksAfter] of cases){
    if(exactRevalidationClosures(before,after,tasksBefore,tasksAfter)!==expected) errors.push("Revalidation closure guard self-test failed: "+name);
  }
  if(!errors.some(e=>e.startsWith("Revalidation closure guard self-test failed:"))) console.log("- Revalidation closure guard: 11 positive/negative regression cases PASS.");
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

if(cs.active_sprint===null){
  if(!approvedPfr06WebReadinessTransition){
    for(const p of changed) if(isImpl(p)) errors.push("Product/task-scoped implementation changed while Sprint HOLD: "+p);
  }
}else if(safeControlTransition || approvedRebaselineTransition){
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
