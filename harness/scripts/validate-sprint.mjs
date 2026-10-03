import fs from "node:fs";
import path from "node:path";
import { canPreserveCompletedBaseline, acceptanceSemanticDriftIds, isBaselineAncestor } from "./baseline-lineage.mjs";

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
const testMaintenanceModes=new Set(["BASELINE_FIXTURE_REBIND"]);
const backlogById=new Map((backlog.items||[]).map(x=>[x.backlog_item_id,x]));
const pathAllowed=(p,allowed)=>allowed.some(a=>a.endsWith("/")?p.startsWith(a):p===a);

const registryFor=baselineId=>{
  const mp="build-spec/baselines/"+baselineId+"/manifest.json";
  if(!exists(mp)){errors.push("Sprint references missing Build Spec "+baselineId); return new Map();}
  const m=read(mp);
  if(m.status!=="LOCKED") errors.push("Sprint Build Spec must be LOCKED: "+baselineId);
  const rp="build-spec/baselines/"+baselineId+"/"+m.acceptance_registry;
  if(!exists(rp)){errors.push("Missing Acceptance registry for "+baselineId); return new Map();}
  return new Map((read(rp).entries||[]).filter(e=>e.contract_status==="ACTIVE" && e.required_for_build_freeze===true).map(e=>[e.acceptance_id,e]));
};

const sameIdSet=(values,expected)=>{
  const ids=new Set(Array.isArray(values)?values:[]);
  const wanted=new Set(expected);
  return ids.size===wanted.size && [...wanted].every(x=>ids.has(x));
};
// A CLOSED Task kept at an ancestor Build Spec may keep a claim outside the current selected Backlog only
// when a DONE Backlog item holds the CLOSED revalidation that Task performed, that revalidation covered exactly
// the original→target semantic drift, and target→current introduces no further drift.
const isTaskHistoricalRevalidation=(item,sid,task,currentBaseline)=>{
  const r=item.revalidation;
  return item.status==="DONE" && r?.status==="CLOSED" &&
    r.sprint_id===sid && r.task_id===task.task_id && r.target_build_spec_id===task.build_spec_id &&
    r.target_build_spec_id!==currentBaseline &&
    isBaselineAncestor(root,item.build_spec_id,r.target_build_spec_id) &&
    isBaselineAncestor(root,r.target_build_spec_id,currentBaseline);
};
const historicalRevalidationCarryForwardIds=(sid,task,currentBaseline)=>{
  const carried=new Set();
  const claimed=new Set((task.acceptance_links||[]).map(x=>x.acceptance_id));
  for(const item of backlog.items||[]){
    if(!isTaskHistoricalRevalidation(item,sid,task,currentBaseline)) continue;
    const r=item.revalidation;
    const targetDrift=acceptanceSemanticDriftIds(root,item.build_spec_id,r.target_build_spec_id,item.acceptance_links);
    if(!targetDrift.length || !sameIdSet(r.acceptance_ids,targetDrift) || !targetDrift.every(aid=>claimed.has(aid))) continue;
    if(acceptanceSemanticDriftIds(root,r.target_build_spec_id,currentBaseline,item.acceptance_links).length) continue;
    for(const aid of targetDrift) carried.add(aid);
  }
  return carried;
};
const recordHistoricalCarryClaims=(carryClaims,sid,task,currentBaseline)=>{
  for(const aid of historicalRevalidationCarryForwardIds(sid,task,currentBaseline)) carryClaims.set(aid,task.task_id);
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
const maintenanceLabel=ctx=>ctx.sid+"/"+ctx.task.task_id;
const validMaintenanceFile=file=>typeof file==="string" && /^tests\/.+\.(?:test|spec)\.(?:ts|tsx)$/.test(file) && !file.includes("..") && !file.includes("*");
const validBuildSpecId=id=>/^BS-P\d+-\d{3}$/.test(id||"");
const validateMaintenanceIdentity=(a,ctx)=>{
  const label=maintenanceLabel(ctx);
  const key=(a.test_id||"")+"::"+(a.file||"");
  if(ctx.seen.has(key)) errors.push(label+" duplicate test maintenance authorization "+key);
  ctx.seen.add(key);
  if(!/^TEST-[A-Z0-9-]+$/.test(a.test_id||"")) errors.push(label+" invalid maintenance test_id "+a.test_id);
  if(!testMaintenanceModes.has(a.mode)) errors.push(label+" invalid test maintenance mode "+a.mode);
};
const validateMaintenanceFile=(a,ctx)=>{
  const label=maintenanceLabel(ctx);
  if(!validMaintenanceFile(a.file)){
    errors.push(label+" invalid maintenance test file "+a.file);
    return;
  }
  if(!pathAllowed(a.file,ctx.task.allowed_write_paths||[])) errors.push(label+" maintenance test file outside allowed_write_paths: "+a.file);
};
const validateMaintenanceBaseline=(a,ctx)=>{
  const label=maintenanceLabel(ctx);
  if(!validBuildSpecId(a.from_build_spec) || !validBuildSpecId(a.to_build_spec)) errors.push(label+" maintenance authorization requires valid from/to Build Spec");
  if(a.to_build_spec!==ctx.task.build_spec_id) errors.push(label+" maintenance to_build_spec must equal Task Build Spec");
  if(a.from_build_spec===a.to_build_spec) errors.push(label+" maintenance from/to Build Spec must differ");
  if(ctx.targetManifest && ctx.targetManifest.supersedes!==a.from_build_spec) errors.push(label+" maintenance from_build_spec must be the direct superseded baseline");
};
const validateMaintenanceOwnership=(a,ctx)=>{
  const label=maintenanceLabel(ctx);
  if(ctx.ownedTestIds.has(a.test_id)) errors.push(label+" maintenance authorization may not duplicate Task-owned Test ID "+a.test_id);
  if(!ctx.activeByTestId.has(a.test_id)) errors.push(label+" maintenance authorization references unknown/inactive Test ID "+a.test_id);
};
const validateMaintenanceAuthorization=(a,ctx)=>{
  if(!a || typeof a!=="object"){
    errors.push(maintenanceLabel(ctx)+" invalid test maintenance authorization");
    return;
  }
  validateMaintenanceIdentity(a,ctx);
  validateMaintenanceFile(a,ctx);
  validateMaintenanceBaseline(a,ctx);
  validateMaintenanceOwnership(a,ctx);
};
const validateTestMaintenanceAuthorizations=(task,sid,activeAcceptance)=>{
  const auths=task.test_maintenance_authorizations;
  if(auths===undefined) return;
  if(!Array.isArray(auths)){
    errors.push(sid+"/"+task.task_id+" test_maintenance_authorizations must be array");
    return;
  }
  const targetManifestPath="build-spec/baselines/"+task.build_spec_id+"/manifest.json";
  const ctx={
    task,sid,seen:new Set(),
    ownedTestIds:new Set((task.acceptance_links||[]).map(x=>x.test_id)),
    targetManifest:exists(targetManifestPath)?read(targetManifestPath):null,
    activeByTestId:new Map([...activeAcceptance.values()].map(x=>[x.test_id,x]))
  };
  for(const a of auths) validateMaintenanceAuthorization(a,ctx);
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

  const revalidationIds=new Set();
  const revalidationByAcceptance=new Map();
  if(m.revalidation_item_ids!==undefined && !Array.isArray(m.revalidation_item_ids)) errors.push(sid+" revalidation_item_ids must be array");
  for(const bid of m.revalidation_item_ids||[]){
    if(revalidationIds.has(bid)) errors.push(sid+" duplicate revalidation item "+bid);
    revalidationIds.add(bid);
    if(selectedIds.has(bid)) errors.push(sid+" revalidation item must not duplicate selected backlog item "+bid);
    const bi=backlogById.get(bid);
    if(!bi){ errors.push(sid+" unknown revalidation backlog item "+bid); continue; }
    if(bi.status!=="DONE") errors.push(sid+" revalidation backlog item must preserve DONE history: "+bid);
    const r=bi.revalidation;
    if(!r || r.target_build_spec_id!==m.build_spec_id || r.sprint_id!==sid){
      errors.push(sid+" invalid revalidation metadata for "+bid);
      continue;
    }
    if(!/^T\d{3}$/.test(r.task_id||"")) errors.push(sid+" revalidation "+bid+" invalid task_id");
    if(!Array.isArray(r.acceptance_ids)||!r.acceptance_ids.length) errors.push(sid+" revalidation "+bid+" requires acceptance_ids");
    for(const aid of r.acceptance_ids||[]){
      const a=activeAcceptance.get(aid);
      if(!a){ errors.push(sid+" revalidation "+bid+" unknown/inactive Acceptance "+aid); continue; }
      if(expectedPairs.has(aid)) errors.push(sid+" revalidation Acceptance duplicates selected backlog coverage: "+aid);
      expectedPairs.set(aid,a.test_id);
      revalidationByAcceptance.set(aid,{backlog_item_id:bid,task_id:r.task_id,status:r.status});
    }
  }

  const taskIds=new Set(), claims=new Map(), taskById=new Map(), taskBacklogs=new Set();
  const historicalCarryClaims=new Map();
  for(const t of td.tasks||[]){
    taskById.set(t.task_id,t);
    if(!/^T\d{3}$/.test(t.task_id||"")) errors.push(sid+" invalid task_id "+t.task_id);
    if(taskIds.has(t.task_id)) errors.push(sid+" duplicate task ID "+t.task_id); taskIds.add(t.task_id);
    if(!taskStates.has(t.status)) errors.push(sid+"/"+t.task_id+" invalid task status");
    if(m.status==="PLANNED" && t.status!=="PLANNED") errors.push(sid+"/"+t.task_id+" must remain PLANNED before activation");
    if(t.build_spec_id!==m.build_spec_id){
      const legacyClosed=t.status==="CLOSED" && canPreserveCompletedBaseline(root,t.build_spec_id,m.build_spec_id,t.acceptance_links);
      if(!legacyClosed) errors.push(sid+"/"+t.task_id+" baseline mismatch");
      else recordHistoricalCarryClaims(historicalCarryClaims,sid,t,m.build_spec_id);
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
    validateTestMaintenanceAuthorizations(t,sid,activeAcceptance);
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
  let carriedClaimCount=0;
  for(const [aid,claim] of claims){
    if(expectedPairs.has(aid)) continue;
    if(historicalCarryClaims.get(aid)===claim.task_id){ carriedClaimCount++; continue; }
    errors.push(sid+" Task claims Acceptance outside selected Backlog/revalidation: "+aid);
  }
  if(claims.size-carriedClaimCount!==expectedPairs.size) errors.push(sid+" Acceptance coverage mismatch: "+(claims.size-carriedClaimCount)+" / "+expectedPairs.size);
  for(const [aid,r] of revalidationByAcceptance){
    const claim=claims.get(aid);
    if(claim && claim.task_id!==r.task_id) errors.push(sid+" revalidation "+aid+" must be owned by Task "+r.task_id+", not "+claim.task_id);
  }

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

  if(m.status==="CLOSED"){
    for(const t of td.tasks||[]){
      if(t.status!=="CLOSED") errors.push(sid+" CLOSED Sprint requires every Task CLOSED: "+t.task_id+" is "+t.status);
    }
    for(const bid of selectedIds){
      const bi=backlogById.get(bid);
      if(bi && bi.status!=="DONE") errors.push(sid+" CLOSED Sprint requires every selected Backlog DONE: "+bid+" is "+bi.status);
    }
    for(const bid of revalidationIds){
      const bi=backlogById.get(bid);
      if(bi && !["VERIFIED","CLOSED"].includes(bi.revalidation?.status)) errors.push(sid+" CLOSED Sprint requires revalidation complete: "+bid+" is "+bi.revalidation?.status);
    }
    if(cs.active_sprint===sid) errors.push(sid+" CLOSED Sprint cannot remain CURRENT active_sprint");
  }
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
