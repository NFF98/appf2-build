import fs from "node:fs";
import path from "node:path";
import { canPreserveCompletedBaseline, acceptanceSemanticDriftIds } from "./baseline-lineage.mjs";

const root=process.cwd(), errors=[];
const read=r=>JSON.parse(fs.readFileSync(path.join(root,r),"utf8"));
const exists=r=>fs.existsSync(path.join(root,r));
const current=read("build-spec/CURRENT.json");
const queue=read("delivery/backlog/QUEUE.json");
const states=new Set(["QUEUED","READY","SPRINTED","BLOCKED","DONE"]);
const priorities=new Set(["P0","P1","P2","P3"]);
const validateSprintBinding=(item,id)=>{
  if(!["SPRINTED","BLOCKED","DONE"].includes(item.status)) return;
  if(!item.sprint_id || !exists("delivery/sprints/"+item.sprint_id+"/manifest.json")){
    errors.push(id+" "+item.status+" requires existing sprint_id");
    return;
  }
  const sm=read("delivery/sprints/"+item.sprint_id+"/manifest.json");
  if(!Array.isArray(sm.backlog_item_ids) || !sm.backlog_item_ids.includes(id)){
    errors.push(id+" "+item.status+" sprint_id does not include item in Sprint manifest");
  }
};
const revalidationStates=new Set(["PLANNED","IN_PROGRESS","VERIFIED","CLOSED"]);
const allowedRevalidationTaskStatuses={
  PLANNED:new Set(["PLANNED"]),
  IN_PROGRESS:new Set(["IN_PROGRESS","REVIEW"]),
  VERIFIED:new Set(["REVIEW","VERIFIED","CLOSED"]),
  CLOSED:new Set(["CLOSED"])
};
const validateRevalidationSprint=(r,id,currentBaseline)=>{
  if(!/^SP-P\d+-\d{3}$/.test(r.sprint_id||"")){
    errors.push(id+" revalidation requires existing sprint_id");
    return false;
  }
  const mp="delivery/sprints/"+r.sprint_id+"/manifest.json";
  if(!exists(mp)){
    errors.push(id+" revalidation requires existing sprint_id");
    return false;
  }
  const sm=read(mp);
  if(sm.build_spec_id!==currentBaseline) errors.push(id+" revalidation Sprint Build Spec mismatch");
  if(!Array.isArray(sm.revalidation_item_ids) || !sm.revalidation_item_ids.includes(id)){
    errors.push(id+" revalidation Sprint manifest must list item in revalidation_item_ids");
  }
  return true;
};
const resolveRevalidationTask=(r,id,currentBaseline)=>{
  if(!/^T\d{3}$/.test(r.task_id||"")){
    errors.push(id+" revalidation requires task_id");
    return null;
  }
  const tp="delivery/sprints/"+r.sprint_id+"/tasks.json";
  if(!exists(tp)){
    errors.push(id+" revalidation Sprint tasks missing");
    return null;
  }
  const td=read(tp);
  const task=(td.tasks||[]).find(t=>t.task_id===r.task_id);
  if(!task){
    errors.push(id+" revalidation task not found: "+r.task_id);
    return null;
  }
  if(task.build_spec_id!==currentBaseline) errors.push(id+" revalidation Task Build Spec mismatch");
  return task;
};
const validateRevalidationAcceptances=(r,task,id,driftIds)=>{
  const ids=new Set(Array.isArray(r.acceptance_ids)?r.acceptance_ids:[]);
  const drift=new Set(driftIds);
  if(ids.size!==drift.size || [...drift].some(x=>!ids.has(x))){
    errors.push(id+" revalidation acceptance_ids must exactly cover semantic drift");
  }
  for(const aid of ids){
    const link=(task.acceptance_links||[]).find(x=>x.acceptance_id===aid);
    if(!link) errors.push(id+" revalidation Task "+r.task_id+" does not claim "+aid);
  }
  return ids;
};
const validateRevalidationTaskStatus=(r,task,id)=>{
  const allowed=allowedRevalidationTaskStatuses[r.status];
  if(allowed && !allowed.has(task.status)){
    errors.push(id+" revalidation status "+r.status+" incompatible with Task "+r.task_id+" status "+task.status);
  }
};
const validateRevalidation=(item,id,currentBaseline,driftIds)=>{
  const r=item.revalidation;
  if(!r || r.target_build_spec_id!==currentBaseline){
    errors.push(id+" semantic drift requires revalidation.target_build_spec_id="+currentBaseline);
    return new Set();
  }
  if(!revalidationStates.has(r.status)) errors.push(id+" revalidation status invalid");
  if(!validateRevalidationSprint(r,id,currentBaseline)) return new Set();
  const task=resolveRevalidationTask(r,id,currentBaseline);
  if(!task) return new Set();
  const ids=validateRevalidationAcceptances(r,task,id,driftIds);
  validateRevalidationTaskStatus(r,task,id);
  return ids;
};

const validateAcceptanceLinks=(item,id,ac,claimed,revalidationIds)=>{
  for(const link of item.acceptance_links||[]){
    const e=ac.get(link.acceptance_id);
    if(!e){
      errors.push(id+" unknown/inactive Acceptance "+link.acceptance_id);
      continue;
    }
    if(e.function_id && e.function_id!==item.function_id) errors.push(id+" Acceptance "+link.acceptance_id+" belongs to "+e.function_id+", not "+item.function_id);
    if(e.test_id!==link.test_id) errors.push(id+" Test mismatch for "+link.acceptance_id);
    if(revalidationIds.has(link.acceptance_id)) continue;
    const previous=claimed.get(link.acceptance_id);
    if(previous) errors.push("Acceptance "+link.acceptance_id+" claimed by multiple backlog items: "+previous+", "+id);
    else claimed.set(link.acceptance_id,id);
  }
};
const validateRevalidationClaims=(id,revalidationIds,ac,claimed)=>{
  for(const aid of revalidationIds){
    const e=ac.get(aid);
    if(!e){
      errors.push(id+" revalidation unknown/inactive Acceptance "+aid);
      continue;
    }
    const previous=claimed.get(aid);
    if(previous) errors.push("Acceptance "+aid+" claimed by multiple backlog items/revalidations: "+previous+", "+id+"::revalidation");
    else claimed.set(aid,id+"::revalidation");
  }
};

if(queue.schema_version!==1) errors.push("Backlog schema_version must be 1.");

if(current.active_baseline===null){
  if(queue.build_spec_id!==null || queue.status!=="HOLD" || (queue.items||[]).length) {
    errors.push("No active Build Spec requires empty HOLD backlog.");
  }
}else{
  if(queue.build_spec_id!==current.active_baseline) errors.push("Backlog Build Spec must equal active baseline.");
  if(queue.status!=="OPEN") errors.push("Active Build Spec requires Backlog status OPEN.");

  const manifest=read("build-spec/baselines/"+current.active_baseline+"/manifest.json");
  const reg=read("build-spec/baselines/"+current.active_baseline+"/"+manifest.acceptance_registry);
  const activeEntries=(reg.entries||[]).filter(e=>e.contract_status==="ACTIVE" && e.required_for_build_freeze===true);
  const ac=new Map(activeEntries.map(e=>[e.acceptance_id,e]));
  const ids=new Set();
  const claimed=new Map();

  for(const item of queue.items||[]){
    const id=item.backlog_item_id;
    if(!/^BL-P\d+-\d{3,}$/.test(id||"")) errors.push("Invalid backlog item id: "+id);
    if(ids.has(id)) errors.push("Duplicate backlog item: "+id);
    ids.add(id);

    if(typeof item.title!=="string" || !item.title.trim()) errors.push((id||"<unknown>")+" requires non-empty title");
    if(item.source!=="BUILD_SPEC") errors.push(id+" source must be BUILD_SPEC");
    let revalidationIds=new Set();
    if(item.build_spec_id!==current.active_baseline){
      const legacyDone=item.status==="DONE" && canPreserveCompletedBaseline(root,item.build_spec_id,current.active_baseline,item.acceptance_links);
      if(!legacyDone){
        const drift=item.status==="DONE" ? acceptanceSemanticDriftIds(root,item.build_spec_id,current.active_baseline,item.acceptance_links) : [];
        if(item.status==="DONE" && drift.length) revalidationIds=validateRevalidation(item,id,current.active_baseline,drift);
        else errors.push(id+" baseline mismatch");
      }
    }
    if(!/^F\d{2}$/.test(item.function_id||"")) errors.push(id+" invalid function_id");
    if(!states.has(item.status)) errors.push(id+" invalid status");
    if(!priorities.has(item.priority)) errors.push(id+" invalid priority");
    if(item.product_decision_allowed!==false) errors.push(id+" product_decision_allowed must be false");
    if(!Array.isArray(item.dependencies)) errors.push(id+" dependencies must be an array");
    if(!Array.isArray(item.acceptance_links)||!item.acceptance_links.length) errors.push(id+" requires Acceptance/Test mapping");

    validateAcceptanceLinks(item,id,ac,claimed,revalidationIds);
    validateRevalidationClaims(id,revalidationIds,ac,claimed);
    if(["QUEUED","READY"].includes(item.status) && item.sprint_id) errors.push(id+" "+item.status+" must not have sprint_id before activation");
    validateSprintBinding(item,id);
  }

  for(const item of queue.items||[]){
    const id=item.backlog_item_id;
    const depSeen=new Set();
    for(const dep of item.dependencies||[]){
      if(depSeen.has(dep)) errors.push(id+" duplicate dependency "+dep);
      depSeen.add(dep);
      if(dep===id) errors.push(id+" cannot depend on itself");
      if(!ids.has(dep)) errors.push(id+" unknown dependency "+dep);
    }
  }

  const visiting=new Set(), visited=new Set();
  const byId=new Map((queue.items||[]).map(i=>[i.backlog_item_id,i]));
  const visit=id=>{
    if(visited.has(id)) return;
    if(visiting.has(id)){ errors.push("Backlog dependency cycle detected at "+id); return; }
    visiting.add(id);
    const item=byId.get(id);
    for(const dep of item?.dependencies||[]) if(byId.has(dep)) visit(dep);
    visiting.delete(id);
    visited.add(id);
  };
  for(const id of ids) visit(id);

  for(const e of activeEntries){
    if(!claimed.has(e.acceptance_id)) errors.push("Missing ACTIVE Acceptance coverage: "+e.acceptance_id);
  }
  if(claimed.size!==activeEntries.length){
    errors.push("ACTIVE Acceptance coverage mismatch: mapped "+claimed.size+" / required "+activeEntries.length);
  }
}

if(errors.length){
  console.error("BACKLOG GATE: FAIL");
  errors.forEach(e=>console.error("- "+e));
  process.exit(1);
}
console.log("BACKLOG GATE: PASS");
