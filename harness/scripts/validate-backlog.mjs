import fs from "node:fs";
import path from "node:path";

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
    if(item.build_spec_id!==current.active_baseline) errors.push(id+" baseline mismatch");
    if(!/^F\d{2}$/.test(item.function_id||"")) errors.push(id+" invalid function_id");
    if(!states.has(item.status)) errors.push(id+" invalid status");
    if(!priorities.has(item.priority)) errors.push(id+" invalid priority");
    if(item.product_decision_allowed!==false) errors.push(id+" product_decision_allowed must be false");
    if(!Array.isArray(item.dependencies)) errors.push(id+" dependencies must be an array");
    if(!Array.isArray(item.acceptance_links)||!item.acceptance_links.length) errors.push(id+" requires Acceptance/Test mapping");

    for(const link of item.acceptance_links||[]){
      const e=ac.get(link.acceptance_id);
      if(!e){
        errors.push(id+" unknown/inactive Acceptance "+link.acceptance_id);
        continue;
      }
      if(e.function_id && e.function_id!==item.function_id) errors.push(id+" Acceptance "+link.acceptance_id+" belongs to "+e.function_id+", not "+item.function_id);
      if(e.test_id!==link.test_id) errors.push(id+" Test mismatch for "+link.acceptance_id);

      const previous=claimed.get(link.acceptance_id);
      if(previous) errors.push("Acceptance "+link.acceptance_id+" claimed by multiple backlog items: "+previous+", "+id);
      else claimed.set(link.acceptance_id,id);
    }

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
