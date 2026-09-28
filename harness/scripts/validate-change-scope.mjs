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
    (!oldBacklog || stable(immutableBacklog(oldBacklog))===stable(immutableBacklog(newBacklog)));
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
const approvedRebaselineTransition=
  baseCurrentBuild?.active_baseline &&
  currentBuild.active_baseline &&
  baseCurrentBuild.active_baseline!==currentBuild.active_baseline &&
  previousExecutionPaused &&
  ["BLOCKED","ACTIVE"].includes(cs.status) &&
  rebaselineActivationPath &&
  changed.includes(rebaselineActivationPath) &&
  changed.every(p=>rebaselineControlAllowed.has(p));

if(approvedRebaselineTransition) console.log("- Human-approved rebaseline control transition recognized; Activation/Baseline/Sprint gates must independently approve it.");

if(cs.active_sprint===null){
  for(const p of changed) if(isImpl(p)) errors.push("Product/task-scoped implementation changed while Sprint HOLD: "+p);
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
