import fs from "node:fs";
import path from "node:path";
import { canPreserveCompletedBaseline, acceptanceSemanticDriftIds, isBaselineAncestor, revalidationHistoryChain } from "./baseline-lineage.mjs";
import { hasPersistentProceduralWaiver } from "./human-exception.mjs";

const root=process.cwd(), errors=[];
const read=r=>JSON.parse(fs.readFileSync(path.join(root,r),"utf8"));
const exists=r=>fs.existsSync(path.join(root,r));
const current=read("build-spec/CURRENT.json");
const queue=read("delivery/backlog/QUEUE.json");
const currentSprint=read("delivery/CURRENT-SPRINT.json");
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
const t006T008PermittedBaselines=new Set(["BS-P1-025","BS-P1-026"]);
const t008PendingIds=new Set(["BL-P1-008","BL-P1-010","BL-P1-031"]);
// Only the original SP-P1-003 T006/T008 unfinished revalidations may remain IN_PROGRESS.
// A BLOCKED pause is never a test/review/closure PASS and cannot activate T008.
const matchesT006PausePhase=(sprint,t006)=>
  (sprint?.status==="ACTIVE" && t006?.status==="IN_PROGRESS") ||
  (sprint?.status==="REVIEW" && t006?.status==="REVIEW") ||
  (sprint?.status==="BLOCKED" && t006?.status==="BLOCKED");
const matchesPendingT008Binding=({id,r,task,baseline})=>
  t006T008PermittedBaselines.has(baseline) &&
  t008PendingIds.has(id) && r?.status==="IN_PROGRESS" &&
  r.sprint_id==="SP-P1-003" && r.task_id==="T008" && r.target_build_spec_id===baseline &&
  task?.task_id==="T008" && task.status==="BLOCKED";
const matchesT006PauseContext=({sprint,t006,baseline})=>
  sprint?.active_sprint==="SP-P1-003" &&
  sprint.active_task==="T006" &&
  sprint.active_build_spec===baseline &&
  matchesT006PausePhase(sprint,t006);
const exactPendingT008Pause=({id,r,task,t006,current,sprint})=>{
  const baseline=current?.active_baseline;
  return matchesPendingT008Binding({id,r,task,baseline}) &&
    matchesT006PauseContext({sprint,t006,baseline});
};
const testExactPendingT008Pause=()=>{
  const fixture=()=>({
    id:"BL-P1-008",r:{status:"IN_PROGRESS",sprint_id:"SP-P1-003",task_id:"T008",target_build_spec_id:"BS-P1-025"},
    task:{task_id:"T008",status:"BLOCKED"},t006:{status:"IN_PROGRESS"},
    current:{active_baseline:"BS-P1-025"},
    sprint:{active_sprint:"SP-P1-003",active_task:"T006",active_build_spec:"BS-P1-025",status:"ACTIVE"}
  });
  const tests=[
    ["BS025 current",true,x=>x],
    ["BS025 blocked",true,x=>{x.sprint.status="BLOCKED";x.t006.status="BLOCKED";return x;}],
    ["BS026 blocked",true,x=>{x.sprint.status="BLOCKED";x.t006.status="BLOCKED";x.sprint.active_build_spec="BS-P1-026";x.current.active_baseline="BS-P1-026";x.r.target_build_spec_id="BS-P1-026";return x;}],
    ["BS025 review",true,x=>{x.sprint.status="REVIEW";x.t006.status="REVIEW";return x;}],
    ["foreign Sprint",false,x=>{x.sprint.active_sprint="SP-P1-004";return x;}],
    ["foreign baseline",false,x=>{x.current.active_baseline="BS-P1-027";return x;}],
    ["foreign backlog",false,x=>{x.id="BL-P1-027";return x;}],
    ["unblocked T008",false,x=>{x.task.status="IN_PROGRESS";return x;}],
    ["fake completed revalidation",false,x=>{x.r.status="CLOSED";return x;}],
    ["stale target",false,x=>{x.r.target_build_spec_id="BS-P1-024";return x;}],
    ["T006 not blocked",false,x=>{x.sprint.status="BLOCKED";return x;}],
    ["T006 prematurely verified",false,x=>{x.sprint.status="BLOCKED";x.t006.status="VERIFIED";return x;}],
    ["wrong active Task",false,x=>{x.sprint.active_task="T008";return x;}]
  ];
  for(const [name,want,change] of tests)if(exactPendingT008Pause(change(fixture()))!==want)throw Error("P0 pause synthetic FAIL "+name);
  return tests.length;
};
console.log("- P0 T006/T008 BS025/026 bounded pause synthetic: "+testExactPendingT008Pause()+"/13 PASS (synthetic only).");
const isPendingT008PauseCandidate=({id,r,task,current,sprint})=>
  t008PendingIds.has(id) && r?.status==="IN_PROGRESS" &&
  r.task_id==="T008" && r.sprint_id==="SP-P1-003" &&
  task?.task_id==="T008" && task.status==="BLOCKED" &&
  t006T008PermittedBaselines.has(current.active_baseline) &&
  r.target_build_spec_id===current.active_baseline &&
  sprint.active_sprint==="SP-P1-003" && sprint.active_task==="T006";
const validateRevalidationTaskStatus=(r,task,id)=>{
  const allowed=allowedRevalidationTaskStatuses[r.status];
  // Unrelated fixture/sprint revalidations must never dereference a missing T006 tasks file.
  // Only the three exact pending T008 records need the T006 companion status.
  const pauseCandidate=isPendingT008PauseCandidate({id,r,task,current,sprint:currentSprint});
  const taskPath="delivery/sprints/SP-P1-003/tasks.json";
  const t006=pauseCandidate && exists(taskPath)
    ? (read(taskPath).tasks||[]).find(t=>t.task_id==="T006") : null;
  const boundedPause=pauseCandidate && exactPendingT008Pause({id,r,task,t006,current,sprint:currentSprint});
  if(allowed && !allowed.has(task.status) && !boundedPause){
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

const sameIdSet=(values,expected)=>{
  const ids=new Set(Array.isArray(values)?values:[]);
  const wanted=new Set(expected);
  return ids.size===wanted.size && [...wanted].every(x=>ids.has(x));
};
const resolveHistoricalRevalidationTask=(r,id)=>{
  if(!/^SP-P\d+-\d{3}$/.test(r?.sprint_id||"") || !/^T\d{3}$/.test(r?.task_id||"")) return null;
  const tp="delivery/sprints/"+r.sprint_id+"/tasks.json";
  if(!exists(tp)) return null;
  const task=(read(tp).tasks||[]).find(t=>t.task_id===r.task_id)||null;
  if(!task || task.status!=="CLOSED" || task.build_spec_id!==r.target_build_spec_id){
    errors.push(id+" historical revalidation must reference the CLOSED Task at its target Build Spec");
    return null;
  }
  return task;
};
const historicalRevalidationCarryForwardIds=(item,id,currentBaseline)=>{
  const r=item.revalidation;
  if(!r || r.status!=="CLOSED" || r.target_build_spec_id===currentBaseline) return null;
  if(!isBaselineAncestor(root,item.build_spec_id,r.target_build_spec_id) || !isBaselineAncestor(root,r.target_build_spec_id,currentBaseline)) return null;
  const targetDrift=acceptanceSemanticDriftIds(root,item.build_spec_id,r.target_build_spec_id,item.acceptance_links);
  if(!targetDrift.length || !sameIdSet(r.acceptance_ids,targetDrift)) return null;
  const laterDrift=acceptanceSemanticDriftIds(root,r.target_build_spec_id,currentBaseline,item.acceptance_links);
  if(laterDrift.length) return null;
  const task=resolveHistoricalRevalidationTask(r,id);
  if(!task) return null;
  for(const aid of targetDrift){
    if(!(task.acceptance_links||[]).some(x=>x.acceptance_id===aid)){
      errors.push(id+" historical revalidation Task "+r.task_id+" does not claim "+aid);
      return null;
    }
  }
  return new Set(targetDrift);
};
const resolveChainedRevalidationIds=(item,id,currentBaseline,chain)=>{
  for(const e of chain.errors) errors.push(id+" "+e);
  if(chain.errors.length) return new Set();
  for(const r of chain.entries){
    const task=resolveHistoricalRevalidationTask(r,id);
    if(!task){ errors.push(id+" revalidation_history entry must reference an existing CLOSED Task"); continue; }
    for(const aid of r.acceptance_ids){
      if(!(task.acceptance_links||[]).some(x=>x.acceptance_id===aid)) errors.push(id+" historical revalidation Task "+r.task_id+" does not claim "+aid);
    }
  }
  const laterDrift=acceptanceSemanticDriftIds(root,chain.end,currentBaseline,item.acceptance_links);
  if(!laterDrift.length){ errors.push(id+" revalidation_history requires semantic drift after "+chain.end); return new Set(); }
  const ids=validateRevalidation(item,id,currentBaseline,laterDrift);
  for(const r of chain.entries) for(const aid of r.acceptance_ids) ids.add(aid);
  return ids;
};
const resolveItemRevalidationIds=(item,id,currentBaseline)=>{
  if(item.revalidation_history!==undefined && item.status!=="DONE") errors.push(id+" revalidation_history requires DONE");
  if(item.build_spec_id===currentBaseline) return new Set();
  const chain=item.status==="DONE"?revalidationHistoryChain(root,item,currentBaseline):null;
  if(chain) return resolveChainedRevalidationIds(item,id,currentBaseline,chain);
  const legacyDone=item.status==="DONE" && canPreserveCompletedBaseline(root,item.build_spec_id,currentBaseline,item.acceptance_links);
  if(legacyDone) return new Set();
  if(item.status==="DONE"){
    const carried=historicalRevalidationCarryForwardIds(item,id,currentBaseline);
    if(carried) return carried;
    const drift=acceptanceSemanticDriftIds(root,item.build_spec_id,currentBaseline,item.acceptance_links);
    if(drift.length) return validateRevalidation(item,id,currentBaseline,drift);
  }
  errors.push(id+" baseline mismatch");
  return new Set();
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
    const revalidationIds=resolveItemRevalidationIds(item,id,current.active_baseline);
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

// BS-P1-025 single-Sprint T006/T008 sequencing guard.
// This only gates *status transitions*. T008's independently checked TEST_RESULT,
// COMMAND_RESULT and REVIEW Evidence still must pass validate-evidence.mjs.
// The authentic Human Closure approval and exact PR approval remain separate.
const t008ExactFourAcceptancePairs=[
  ["F01-AC-013","TEST-F01-API-001"],
  ["F01-AC-016","TEST-F01-API-003"],
  ["F01-AC-017","TEST-F01-SEC-007"],
  ["F07-AC-004","TEST-F07-004"]
];
const t008ExactRevalidations=[
  ["BL-P1-008",["F01-AC-017"]],
  ["BL-P1-010",["F01-AC-013","F01-AC-016"]],
  ["BL-P1-031",["F07-AC-004"]]
];
const exactT008AcceptancePairs=links=>{
  const actual=(links||[]).map(l=>`${l.acceptance_id}::${l.test_id}`);
  return actual.length===4 && new Set(actual).size===4 &&
    t008ExactFourAcceptancePairs.every(([aid,tid])=>actual.includes(`${aid}::${tid}`));
};
const exactT008ClosedRevalidation=(r,expectedIds,baseline)=>
  r?.target_build_spec_id===baseline &&
  r.sprint_id==="SP-P1-003" &&
  r.task_id==="T008" &&
  r.status==="CLOSED" &&
  Array.isArray(r.acceptance_ids) &&
  r.acceptance_ids.length===expectedIds.length &&
  expectedIds.every(aid=>r.acceptance_ids.includes(aid));

// GOV-T006-F06-DEFER-T008-001: owner-approved F06 Preview deferral for T008 execution only.
// No F00-AC-037 PASS waiver; T008 four mapped acceptance checks stay mandatory.
const f06DeferCasePath="delivery/constitutional-cases/GOV-T006-F06-DEFER-T008-001.json";
const f06DeferEvidence=Array.from({length:21},(_,i)=>
  "EV-SP-P1-003-T006-"+String(i+1).padStart(3,"0"));
const ownerF06DeferSprintMatches=(t008,baseline,sprint)=>
  baseline==="BS-P1-025" && sprint?.active_sprint==="SP-P1-003" &&
  sprint.active_build_spec==="BS-P1-025" && sprint.active_task==="T008" &&
  ((sprint.status==="ACTIVE"&&t008?.status==="IN_PROGRESS") ||
    (sprint.status==="REVIEW"&&t008?.status==="REVIEW"));
const ownerF06DeferEvidenceMatches=t006=>
  Array.isArray(t006?.completion_evidence) &&
  t006.completion_evidence.length===f06DeferEvidence.length &&
  new Set(t006.completion_evidence).size===f06DeferEvidence.length &&
  f06DeferEvidence.every(e=>t006.completion_evidence.includes(e));
const ownerF06DeferCaseMatches=docket=>
  docket?.case_id==="GOV-T006-F06-DEFER-T008-001" &&
  docket.base_sha==="e495237d85ceaa2ae7c2c62d32678dcac4fa133b" &&
  docket.deferred_acceptance_id==="F00-AC-037" &&
  docket.deferred_test_id==="TEST-F00-037" &&
  docket.deferred_scope==="F06_PREVIEW_ORIGIN_ONLY" &&
  docket.owner_product_progress_value===95 &&
  /^[a-f0-9]{64}$/.test(docket.candidate_digest_sha256||"");
const ownerF06DeferApprovalMatches=docket=>{
  const a=docket?.human_approval||{};
  return a.case_id===docket?.case_id &&
    a.decision==="APPROVE_EXACT_CANDIDATE" &&
    a.scope==="EXACT_PR_DIFF" && a.source_kind==="DIRECT_HUMAN_MESSAGE" &&
    a.candidate_digest_sha256===docket.candidate_digest_sha256 &&
    typeof a.human_message_ref==="string" && !!a.human_message_ref.trim();
};
const ownerF06DeferAllowsT008=(t006,t008,baseline,sprint,docket)=>
  ownerF06DeferSprintMatches(t008,baseline,sprint) &&
  t006?.status==="BLOCKED" && t006.build_spec_id==="BS-P1-025" &&
  t008.build_spec_id==="BS-P1-025" &&
  exactT008AcceptancePairs(t008.acceptance_links) &&
  ownerF06DeferEvidenceMatches(t006) &&
  ownerF06DeferCaseMatches(docket) &&
  ownerF06DeferApprovalMatches(docket);
const testOwnerF06DeferT008=()=>{
  const fixture=()=>{
    const d={case_id:"GOV-T006-F06-DEFER-T008-001",base_sha:"e495237d85ceaa2ae7c2c62d32678dcac4fa133b",
      deferred_acceptance_id:"F00-AC-037",deferred_test_id:"TEST-F00-037",
      deferred_scope:"F06_PREVIEW_ORIGIN_ONLY",owner_product_progress_value:95,
      candidate_digest_sha256:"f".repeat(64)};
    d.human_approval={case_id:d.case_id,decision:"APPROVE_EXACT_CANDIDATE",
      scope:"EXACT_PR_DIFF",source_kind:"DIRECT_HUMAN_MESSAGE",
      candidate_digest_sha256:d.candidate_digest_sha256,
      human_message_ref:"SYNTHETIC-NOT-REAL-APPROVAL"};
    return {baseline:"BS-P1-025",docket:d,
      sprint:{active_sprint:"SP-P1-003",active_build_spec:"BS-P1-025",active_task:"T008",status:"ACTIVE"},
      t006:{status:"BLOCKED",build_spec_id:"BS-P1-025",completion_evidence:[...f06DeferEvidence]},
      t008:{status:"IN_PROGRESS",build_spec_id:"BS-P1-025",
        acceptance_links:t008ExactFourAcceptancePairs.map(([acceptance_id,test_id])=>({acceptance_id,test_id}))}};
  };
  const cases=[
    ["exact",true,x=>x],
    ["review stage",true,x=>{x.sprint.status="REVIEW";x.t008.status="REVIEW";return x;}],
    ["pending approval",false,x=>{delete x.docket.human_approval;return x;}],
    ["bot impersonation",false,x=>{x.docket.human_approval.source_kind="BOT";return x;}],
    ["digest tamper",false,x=>{x.docket.human_approval.candidate_digest_sha256="a".repeat(64);return x;}],
    ["wrong base",false,x=>{x.docket.base_sha="a".repeat(40);return x;}],
    ["other task",false,x=>{x.sprint.active_task="T009";return x;}],
    ["other sprint",false,x=>{x.sprint.active_sprint="SP-P1-004";return x;}],
    ["other baseline",false,x=>{x.baseline="BS-P1-026";return x;}],
    ["T006 not blocked",false,x=>{x.t006.status="VERIFIED";return x;}],
    ["T008 not active",false,x=>{x.t008.status="BLOCKED";return x;}],
    ["T008 falsely closed",false,x=>{x.t008.status="CLOSED";return x;}],
    ["wrong T008 test",false,x=>{x.t008.acceptance_links[0].test_id="FAKE";return x;}],
    ["missing evidence",false,x=>{x.t006.completion_evidence.pop();return x;}],
    ["duplicate evidence",false,x=>{x.t006.completion_evidence[0]=x.t006.completion_evidence[1];return x;}],
    ["fake F06 test switch",false,x=>{x.docket.deferred_test_id="TEST-F00-039";return x;}],
    ["fake PPV",false,x=>{x.docket.owner_product_progress_value=100;return x;}],
    ["wrong stage",false,x=>{x.sprint.status="BLOCKED";return x;}]
  ];
  for(const [label,want,edit] of cases){
    const x=edit(fixture());
    if(ownerF06DeferAllowsT008(x.t006,x.t008,x.baseline,x.sprint,x.docket)!==want)
      throw Error("OWNER F06/T008 CASE FAILED: "+label);
  }
  return cases.length;
};
console.log("- F06 defer T008 bounded positive/negative: "+testOwnerF06DeferT008()+"/18 PASS (synthetic).");
const f06DeferDocket=exists(f06DeferCasePath)?read(f06DeferCasePath):null;

function t006T008PreclosureErrors(t006,t008,baseline,closeOrderWaived=false) {
  const errors=[];
  if(["IN_PROGRESS","REVIEW","VERIFIED"].includes(t008?.status) &&
     t006?.status!=="VERIFIED" &&
      !ownerF06DeferAllowsT008(t006,t008,baseline,currentSprint,f06DeferDocket)) {
    errors.push("T008 execution/review requires T006 product VERIFIED with independent T006 Evidence");
  }
  if(t008?.status==="CLOSED" &&
     !["REVIEW","VERIFIED","CLOSED"].includes(t006?.status) && !closeOrderWaived) {
    errors.push("T008 CLOSED requires T006 product already independently reviewed");
  }
  return errors;
}
function t006ClosureRevalidationErrors(items,baseline) {
  const errors=[];
  const byId=new Map((items||[]).map(x=>[x.backlog_item_id,x]));
  for(const [id,ids] of t008ExactRevalidations) {
    if(!exactT008ClosedRevalidation(byId.get(id)?.revalidation,ids,baseline)) {
      errors.push("T006 final CLOSED requires exact T008 CLOSED BS-P1-025 revalidation: "+id);
    }
  }
  return errors;
}
function t006FinalClosureErrors(t008,items,baseline) {
  const errors=[];
  if(t008?.status!=="CLOSED") errors.push("T006 final CLOSED forbidden until T008 is CLOSED");
  if(!Array.isArray(t008?.completion_evidence) || !t008.completion_evidence.length) {
    errors.push("T006 final CLOSED requires T008 completion_evidence; evidence gate validates actual PASS records");
  }
  if(!exactT008AcceptancePairs(t008?.acceptance_links)) {
    errors.push("T006 final CLOSED requires T008 owning exactly four BS-P1-025 AC/Test pairs");
  }
  return errors.concat(t006ClosureRevalidationErrors(items,baseline));
}
// GOV-REFORM-20261013: only a merged, exact Human CLOSURE_DEFERRAL docket may defer this
// procedural ordering rule; Evidence PASS, AC/Test mapping and revalidation rules still apply.
const t008CloseOrderWaived=()=>hasPersistentProceduralWaiver({
  root,gateId:"BACKLOG_T008_CLOSE_AFTER_T006_REVIEW",taskId:"T008",sprintId:"SP-P1-003"
});
function checkT006T008Order(t006,t008,items,baseline,closeOrderWaived=false) {
  const errors=t006T008PreclosureErrors(t006,t008,baseline,closeOrderWaived);
  return t006?.status==="CLOSED" ? errors.concat(t006FinalClosureErrors(t008,items,baseline)) : errors;
}
function testT006T008Order() {
  const ids=[["F01-AC-013","TEST-F01-API-001"],["F01-AC-016","TEST-F01-API-003"],["F01-AC-017","TEST-F01-SEC-007"],["F07-AC-004","TEST-F07-004"]];
  const base=()=>({
    t006:{task_id:"T006",status:"CLOSED"},
    t008:{task_id:"T008",status:"CLOSED",completion_evidence:["SYNTHETIC-ONLY"],acceptance_links:ids.map(([acceptance_id,test_id])=>({acceptance_id,test_id}))},
    items:[
      {backlog_item_id:"BL-P1-008",revalidation:{target_build_spec_id:"BS-P1-025",status:"CLOSED",sprint_id:"SP-P1-003",task_id:"T008",acceptance_ids:["F01-AC-017"]}},
      {backlog_item_id:"BL-P1-010",revalidation:{target_build_spec_id:"BS-P1-025",status:"CLOSED",sprint_id:"SP-P1-003",task_id:"T008",acceptance_ids:["F01-AC-013","F01-AC-016"]}},
      {backlog_item_id:"BL-P1-031",revalidation:{target_build_spec_id:"BS-P1-025",status:"CLOSED",sprint_id:"SP-P1-003",task_id:"T008",acceptance_ids:["F07-AC-004"]}}
    ]
  });
  const cases=[
    ["valid final CLOSED",true,x=>x],
    ["T006 product work first, T008 BLOCKED",true,x=>{x.t006.status="IN_PROGRESS";x.t008.status="BLOCKED";return x;}],
    ["T006 product review first, T008 BLOCKED",true,x=>{x.t006.status="REVIEW";x.t008.status="BLOCKED";return x;}],
    ["legal T008 active after T006 VERIFIED",true,x=>{x.t006.status="VERIFIED";x.t008.status="IN_PROGRESS";return x;}],
    ["T008 reopened with T006 BLOCKED",false,x=>{x.t006.status="BLOCKED";x.t008.status="IN_PROGRESS";return x;}],
    ["T008 closed before T006 product proof",false,x=>{x.t006.status="IN_PROGRESS";return x;}],
    ["T008 closed while T006 BLOCKED under merged Human CLOSURE_DEFERRAL",true,x=>{x.t006.status="BLOCKED";x.waived=true;return x;}],
    ["premature T006 CLOSED T008 open",false,x=>{x.t008.status="IN_PROGRESS";return x;}],
    ["unclosed BL-P1-008",false,x=>{x.items[0].revalidation.status="IN_PROGRESS";return x;}],
    ["unclosed BL-P1-010",false,x=>{x.items[1].revalidation.status="VERIFIED";return x;}],
    ["missing BL-P1-031",false,x=>{x.items.pop();return x;}],
    ["foreign T008 revalidation owner",false,x=>{x.items[0].revalidation.task_id="T007";return x;}],
    ["wrong revalidation baseline",false,x=>{x.items[1].revalidation.target_build_spec_id="BS-P1-024";return x;}],
    ["T008 has no evidence",false,x=>{x.t008.completion_evidence=[];return x;}],
    ["T008 omits one AC/Test",false,x=>{x.t008.acceptance_links.pop();return x;}],
    ["wrong T008 test ID",false,x=>{x.t008.acceptance_links[0].test_id="WRONG";return x;}],
    ["BS026 closed exact bindings",true,x=>{x.baseline="BS-P1-026";for(const i of x.items)i.revalidation.target_build_spec_id=x.baseline;return x;}],
    ["BS026 stale target must fail",false,x=>{x.baseline="BS-P1-026";return x;}]
  ];
  for(const [name,shouldPass,modify] of cases){const x=modify(base());const actual=checkT006T008Order(x.t006,x.t008,x.items,x.baseline||"BS-P1-025",x.waived===true).length===0;if(actual!==shouldPass)throw Error("T006/T008 order guard synthetic regression FAILED: "+name);}
  return cases.length;
}

if(t006T008PermittedBaselines.has(current.active_baseline) &&
   exists("delivery/sprints/SP-P1-003/tasks.json")){
  const tasks=read("delivery/sprints/SP-P1-003/tasks.json").tasks||[];
  const t006=tasks.find(x=>x.task_id==="T006");
  const t008=tasks.find(x=>x.task_id==="T008");
  for(const e of checkT006T008Order(t006,t008,queue.items||[],current.active_baseline,t008CloseOrderWaived())){
    errors.push("SP-P1-003 BS025 T006/T008 closure order: "+e);
  }
}
console.log("- T006/T008 closure-order fail-closed synthetic regressions: "+testT006T008Order()+"/"+18+" PASS (synthetic, not Task acceptance).");

if(errors.length){
  console.error("BACKLOG GATE: FAIL");
  errors.forEach(e=>console.error("- "+e));
  process.exit(1);
}
console.log("BACKLOG GATE: PASS");
