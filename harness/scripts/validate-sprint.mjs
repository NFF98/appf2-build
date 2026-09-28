import fs from "node:fs";
import path from "node:path";
import { canPreserveCompletedBaseline } from "./baseline-lineage.mjs";

const root=process.cwd(), errors=[];
const read=r=>JSON.parse(fs.readFileSync(path.join(root,r),"utf8"));
const exists=r=>fs.existsSync(path.join(root,r));
const cs=read("delivery/CURRENT-SPRINT.json");
const cb=read("build-spec/CURRENT.json");
const backlog=read("delivery/backlog/QUEUE.json");
const skillRegistry=read("skills/REGISTRY.json");
const pkg=read("package.json");
const registeredSkills=new Set((skillRegistry.skills||[]).map(x=>x.id));
const planningSkills=new Set((skillRegistry.skills||[]).filter(x=>x.actor==="PLANNING_AGENT" || x.phase==="SPRINT_PLANNING").map(x=>x.id));
const sprintStates=new Set(["PLANNED","ACTIVE","BLOCKED","REVIEW","CLOSED"]);
const taskStates=new Set(["PLANNED","IN_PROGRESS","BLOCKED","REVIEW","VERIFIED","CLOSED"]);
const protectedPrefixes=["build-spec/","harness/","ci/","deploy/","releases/","skills/",".cursor/",".github/","delivery/backlog/","delivery/sprints/","delivery/CURRENT-SPRINT.json","delivery/templates/","delivery/deltas/","package.json","tsconfig.build.json"];
const backlogById=new Map((backlog.items||[]).map(x=>[x.backlog_item_id,x]));

const registryFor=baselineId=>{
  const mp="build-spec/baselines/"+baselineId+"/manifest.json";
  if(!exists(mp)){errors.push("Sprint references missing Build Spec "+baselineId); return new Map();}
  const m=read(mp);
  if(m.status!=="LOCKED") errors.push("Sprint Build Spec must be LOCKED: "+baselineId);
  const rp="build-spec/baselines/"+baselineId+"/"+m.acceptance_registry;
  if(!exists(rp)){errors.push("Missing Acceptance registry for "+baselineId); return new Map();}
  return new Map((read(rp).entries||[]).filter(e=>e.contract_status==="ACTIVE" && e.required_for_build_freeze===true).map(e=>[e.acceptance_id,e]));
};

const sprintRoot=path.join(root,"delivery/sprints");
const sprintDirs=fs.existsSync(sprintRoot)
  ? fs.readdirSync(sprintRoot,{withFileTypes:true}).filter(x=>x.isDirectory() && /^SP-P\d+-\d{3}$/.test(x.name)).map(x=>x.name)
  : [];
const validateActiveTaskDependencies=(active,taskById)=>{
  for(const dep of active.blocked_by||[]){
    const d=taskById.get(dep);
    if(d && !["VERIFIED","CLOSED"].includes(d.status)){
      errors.push("active_task "+active.task_id+" blocked_by unfinished Task "+dep+" ("+d.status+")");
    }
  }
};
const validateActiveTask=td=>{
  const taskById=new Map((td.tasks||[]).map(t=>[t.task_id,t]));
  const active=taskById.get(cs.active_task);
  if(!active){
    errors.push("active_task not found: "+cs.active_task);
    return;
  }
  const allowed={ACTIVE:new Set(["IN_PROGRESS"]),REVIEW:new Set(["REVIEW"]),BLOCKED:new Set(["BLOCKED"])};
  if(!allowed[cs.status]?.has(active.status)) errors.push("active_task status "+active.status+" incompatible with Sprint "+cs.status);
  validateActiveTaskDependencies(active,taskById);
};
const validateActiveSprint=v=>{
  const {m,td}=v;
  if(!cb.implementation_enabled) errors.push("Active Sprint requires implementation_enabled=true");
  if(cs.active_build_spec!==cb.active_baseline || m.build_spec_id!==cb.active_baseline) errors.push("Active Sprint Build Spec mismatch");
  if(!["ACTIVE","BLOCKED","REVIEW"].includes(cs.status)) errors.push("CURRENT active Sprint status must be ACTIVE/BLOCKED/REVIEW");
  if(m.status==="PLANNED") errors.push("Active Sprint manifest may not remain PLANNED");
  if(m.entry_gate?.user_approved!==true || !m.entry_gate?.approval_ref) errors.push("Active Sprint requires Human approval reference");
  validateActiveTask(td);
  const activeCount=(td.tasks||[]).filter(t=>["IN_PROGRESS","REVIEW"].includes(t.status)).length;
  if(activeCount>1) errors.push("Only one Task may be IN_PROGRESS/REVIEW at a time");
};

const validated=new Map();
for(const sid of sprintDirs){
  const mp="delivery/sprints/"+sid+"/manifest.json", tp="delivery/sprints/"+sid+"/tasks.json";
  if(!exists(mp)||!exists(tp)){errors.push(sid+" missing manifest.json or tasks.json"); continue;}
  const m=read(mp), td=read(tp);
  validated.set(sid,{m,td});
  if(m.sprint_id!==sid || td.sprint_id!==sid) errors.push(sid+" Sprint ID mismatch");
  if(!sprintStates.has(m.status)) errors.push(sid+" invalid manifest status");
  if(!/^BS-P\d+-\d{3}$/.test(m.build_spec_id||"")) errors.push(sid+" invalid build_spec_id");
  if(!Array.isArray(m.backlog_item_ids)||!m.backlog_item_ids.length) errors.push(sid+" requires manifest.backlog_item_ids");
  if(!Array.isArray(td.tasks)||!td.tasks.length) errors.push(sid+" has no tasks");
  const activeAcceptance=registryFor(m.build_spec_id);
  const selectedIds=new Set(), expectedPairs=new Map();
  for(const bid of m.backlog_item_ids||[]){
    if(selectedIds.has(bid)) errors.push(sid+" duplicate manifest backlog item "+bid);
    selectedIds.add(bid);
    const bi=backlogById.get(bid);
    if(!bi){errors.push(sid+" unknown backlog item "+bid); continue;}
    if(bi.build_spec_id!==m.build_spec_id){
      const legacyDone=bi.status==="DONE" && canPreserveCompletedBaseline(root,bi.build_spec_id,m.build_spec_id,bi.acceptance_links);
      if(!legacyDone) errors.push(sid+" backlog baseline mismatch "+bid);
    }
    if(m.status==="PLANNED"){
      if(bi.status!=="READY") errors.push(sid+" PLANNED backlog must be READY: "+bid+" is "+bi.status);
      if(bi.sprint_id) errors.push(sid+" PLANNED backlog must not already have sprint_id: "+bid);
    }else{
      if(!["SPRINTED","BLOCKED","DONE"].includes(bi.status)) errors.push(sid+" active/closed backlog must be SPRINTED/BLOCKED/DONE: "+bid);
      if(bi.sprint_id!==sid) errors.push(sid+" backlog sprint_id mismatch: "+bid);
    }
    for(const a of bi.acceptance_links||[]) expectedPairs.set(a.acceptance_id,a.test_id);
    for(const dep of bi.dependencies||[]){
      if(selectedIds.has(dep)) continue;
      const d=backlogById.get(dep);
      if(!d) errors.push(sid+" backlog "+bid+" has unknown dependency "+dep);
      else if(!(m.backlog_item_ids||[]).includes(dep) && d.status!=="DONE") errors.push(sid+" backlog "+bid+" depends on unfinished item outside Sprint: "+dep);
    }
  }

  const taskIds=new Set(), claims=new Map(), taskById=new Map(), taskBacklogs=new Set();
  for(const t of td.tasks||[]){
    taskById.set(t.task_id,t);
    if(!/^T\d{3}$/.test(t.task_id||"")) errors.push(sid+" invalid task_id "+t.task_id);
    if(taskIds.has(t.task_id)) errors.push(sid+" duplicate task ID "+t.task_id); taskIds.add(t.task_id);
    if(!taskStates.has(t.status)) errors.push(sid+"/"+t.task_id+" invalid task status");
    if(m.status==="PLANNED" && t.status!=="PLANNED") errors.push(sid+"/"+t.task_id+" must remain PLANNED before activation");
    if(t.build_spec_id!==m.build_spec_id){
      const legacyClosed=t.status==="CLOSED" && canPreserveCompletedBaseline(root,t.build_spec_id,m.build_spec_id,t.acceptance_links);
      if(!legacyClosed) errors.push(sid+"/"+t.task_id+" baseline mismatch");
    }
    if(t.product_decision_allowed!==false) errors.push(sid+"/"+t.task_id+" product_decision_allowed must be false");
    if(!Array.isArray(t.scope)||!t.scope.length || !Array.isArray(t.non_scope)||!t.non_scope.length) errors.push(sid+"/"+t.task_id+" requires scope and non_scope");
    if(!Array.isArray(t.backlog_item_ids)||!t.backlog_item_ids.length) errors.push(sid+"/"+t.task_id+" missing backlog mapping");
    for(const bid of t.backlog_item_ids||[]){
      taskBacklogs.add(bid);
      if(!selectedIds.has(bid)) errors.push(sid+"/"+t.task_id+" references backlog outside manifest: "+bid);
    }
    if(!Array.isArray(t.acceptance_links)||!t.acceptance_links.length) errors.push(sid+"/"+t.task_id+" missing Acceptance/Test mapping");
    for(const link of t.acceptance_links||[]){
      const a=activeAcceptance.get(link.acceptance_id);
      if(!a) errors.push(sid+"/"+t.task_id+" unknown/inactive Acceptance "+link.acceptance_id);
      else if(a.test_id!==link.test_id) errors.push(sid+"/"+t.task_id+" Test ID mismatch for "+link.acceptance_id+": expected "+a.test_id);
      const prev=claims.get(link.acceptance_id);
      if(prev) errors.push(sid+" Acceptance claimed by multiple Tasks: "+link.acceptance_id+" :: "+prev+", "+t.task_id);
      else claims.set(link.acceptance_id,{test_id:link.test_id,task_id:t.task_id});
    }
    if(!Array.isArray(t.allowed_write_paths)||!t.allowed_write_paths.length) errors.push(sid+"/"+t.task_id+" missing allowed_write_paths");
    for(const p of t.allowed_write_paths||[]){
      if(typeof p!=="string" || !p || p.startsWith("/") || p.includes("..")) errors.push(sid+"/"+t.task_id+" invalid allowed_write_path: "+p);
      if(protectedPrefixes.some(x=>p.startsWith(x)) || p==="AGENTS.md") errors.push(sid+"/"+t.task_id+" may not write governance path: "+p);
    }
    if(!Array.isArray(t.required_commands)||!t.required_commands.length) errors.push(sid+"/"+t.task_id+" missing required_commands");
    if(Array.isArray(t.required_commands) && !t.required_commands.includes("npm run gate")) errors.push(sid+"/"+t.task_id+" must require npm run gate");
    for(const cmd of t.required_commands||[]){
      const mm=/^npm run ([A-Za-z0-9:_-]+)$/.exec(cmd);
      if(!mm) errors.push(sid+"/"+t.task_id+" required_commands must be exact npm run scripts: "+cmd);
      else if(!pkg.scripts?.[mm[1]]) errors.push(sid+"/"+t.task_id+" references missing npm script: "+mm[1]);
    }
    if(!Array.isArray(t.required_skills)||!t.required_skills.length) errors.push(sid+"/"+t.task_id+" missing required_skills");
    if(Array.isArray(t.required_skills) && !t.required_skills.includes("reviewer")) errors.push(sid+"/"+t.task_id+" must require reviewer");
    for(const skill of t.required_skills||[]){
      if(!registeredSkills.has(skill)) errors.push(sid+"/"+t.task_id+" unknown Skill "+skill);
      if(planningSkills.has(skill)) errors.push(sid+"/"+t.task_id+" execution Task may not require Planning Agent Skill "+skill);
    }
    if(!Array.isArray(t.blocked_by)) errors.push(sid+"/"+t.task_id+" blocked_by must be array");
    if(!Array.isArray(t.completion_evidence)) errors.push(sid+"/"+t.task_id+" completion_evidence must be array");
  }

  for(const bid of selectedIds) if(!taskBacklogs.has(bid)) errors.push(sid+" selected backlog has no Task: "+bid);
  for(const [aid,tid] of expectedPairs){
    const claim=claims.get(aid);
    if(!claim) errors.push(sid+" missing Task coverage for "+aid);
    else if(claim.test_id!==tid) errors.push(sid+" Task coverage Test mismatch for "+aid);
  }
  for(const aid of claims.keys()) if(!expectedPairs.has(aid)) errors.push(sid+" Task claims Acceptance outside selected Backlog: "+aid);
  if(claims.size!==expectedPairs.size) errors.push(sid+" Acceptance coverage mismatch: "+claims.size+" / "+expectedPairs.size);

  for(const t of td.tasks||[]){
    const seen=new Set();
    for(const dep of t.blocked_by||[]){
      if(seen.has(dep)) errors.push(sid+"/"+t.task_id+" duplicate blocked_by "+dep); seen.add(dep);
      if(dep===t.task_id) errors.push(sid+"/"+t.task_id+" cannot block on itself");
      if(!taskById.has(dep)) errors.push(sid+"/"+t.task_id+" unknown blocked_by "+dep);
    }
  }
  const visiting=new Set(), visited=new Set();
  const visit=id=>{
    if(visited.has(id)) return;
    if(visiting.has(id)){errors.push(sid+" Task dependency cycle at "+id); return;}
    visiting.add(id);
    for(const dep of taskById.get(id)?.blocked_by||[]) if(taskById.has(dep)) visit(dep);
    visiting.delete(id); visited.add(id);
  };
  for(const id of taskIds) visit(id);
}

if(cs.active_sprint===null){
  if(cs.status!=="HOLD") errors.push("No active Sprint must be HOLD");
  if(cs.active_build_spec!==null || cs.active_task!==null) errors.push("No active Sprint must not bind Build Spec/Task");
  if(cb.implementation_enabled!==false) errors.push("Implementation must be disabled when no active Sprint exists");
}else{
  const v=validated.get(cs.active_sprint);
  if(!v) errors.push("CURRENT active Sprint missing or invalid: "+cs.active_sprint);
  else validateActiveSprint(v);
}

if(errors.length){console.error("SPRINT GATE: FAIL");errors.forEach(e=>console.error("- "+e));process.exit(1);}
console.log("SPRINT GATE: PASS");
