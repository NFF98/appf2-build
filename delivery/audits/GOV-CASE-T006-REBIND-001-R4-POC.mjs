// GOV-CASE-T006-REBIND-001/R4 isolated PoC: NOT A PROTECTED GATE, NO MUTATIONS.
// Reproduce in exact canonical appf2-build checkout pinned in results JSON:
// node delivery/audits/GOV-CASE-T006-REBIND-001-R4-POC.mjs
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
const repo=process.cwd(),rd=p=>fs.readFileSync(path.join(repo,p),"utf8"),read=p=>JSON.parse(rd(p));
const ids=["BS-P1-001","BS-P1-003","BS-P1-004","BS-P1-016","BS-P1-021","BS-P1-024","BS-P1-025"];
const c={queue:read("delivery/backlog/QUEUE.json"),tasks:read("delivery/sprints/SP-P1-003/tasks.json"),sprint:read("delivery/sprints/SP-P1-003/manifest.json"),build:read("build-spec/CURRENT.json"),current:read("delivery/CURRENT-SPRINT.json"),manifest:Object.fromEntries(ids.map(id=>[id,read("build-spec/baselines/"+id+"/manifest.json")])),registry:Object.fromEntries(ids.map(id=>[id,read("build-spec/baselines/"+id+"/registries/acceptance-test-registry.json")]))};
const p=Object.fromEntries(ids.map(id=>[id,c.manifest[id].file_inventory.find(f=>f.path==="registries/acceptance-test-registry.json").sha256]));
for(const id of ids){const rel="build-spec/baselines/"+id+"/registries/acceptance-test-registry.json";const observed=createHash("sha256").update(fs.readFileSync(path.join(repo,rel))).digest("hex");if(observed!==p[id])throw Error("PINNED_SOURCE_DIGEST_FAILURE "+id)}

const norm=x=>Array.isArray(x)?x.map(norm):x&&typeof x==="object"?Object.fromEntries(Object.keys(x).sort().map(k=>[k,norm(x[k])])):x;
const same=(a,b)=>JSON.stringify(norm(a))===JSON.stringify(norm(b));
const seteq=(a,b)=>Array.isArray(a)&&a.length===new Set(a).size&&a.length===b.length&&a.every(x=>b.includes(x));
const entry=(c,id,a)=>c.registry[id]?.entries?.find(e=>e.acceptance_id===a);
const changed=(c,item,from,to)=>item.acceptance_links.filter(l=>{const a=entry(c,from,l.acceptance_id),b=entry(c,to,l.acceptance_id);return !a||!b||a.test_id!==l.test_id||b.test_id!==l.test_id||!same(a,b)}).map(l=>l.acceptance_id);
const baselineLocked=c=>c.build.active_baseline==="BS-P1-024"&&
 c.build.implementation_enabled===false&&c.current.status==="HOLD"&&c.current.active_task===null;
const legacyTasksLocked=(c,t001,t007)=>t001?.status==="CLOSED"&&t007?.status==="CLOSED"&&
 c.sprint.build_spec_id==="BS-P1-024"&&c.sprint.revalidation_item_ids.includes("BL-P1-008");
const exactOldRound=({c,bid,item,cursor,t007,e})=>{
 const r=item.revalidation;
 if(r.status!=="CLOSED"||!seteq(r.acceptance_ids,changed(c,item,cursor,r.target_build_spec_id)))e.push(bid+":LEGACY_INVALID");
 if(bid==="BL-P1-008"&&!lockedT007(r,t007))e.push("BL008:T007_HISTORY_CHANGED");
 return r.target_build_spec_id;
};
const lockedT007=(r,t007)=>r.task_id==="T007"&&r.sprint_id==="SP-P1-003"&&
 r.target_build_spec_id==="BS-P1-024"&&Boolean(t007?.completion_evidence?.length);
const chainValid=(c,bid,r,cursor)=>r.item_id===bid&&r.source_build_spec_id===cursor&&r.target_build_spec_id!==cursor;
const knownBaselines=(c,r)=>Boolean(c.manifest[r.source_build_spec_id]&&c.manifest[r.target_build_spec_id]);
const pinsValid=(p,r)=>r.source_registry_sha256===p[r.source_build_spec_id]&&r.target_registry_sha256===p[r.target_build_spec_id];
const mappingValid=(c,item,r)=>{
 const drift=c.registry[r.source_build_spec_id]&&c.registry[r.target_build_spec_id]?
  changed(c,item,r.source_build_spec_id,r.target_build_spec_id):[];
 const tests=(r.acceptance_ids||[]).map(a=>entry(c,"BS-P1-025",a)?.test_id);
 return seteq(r.acceptance_ids,drift)&&seteq(r.test_ids,tests);
};
const ownerValid=(task,r)=>Boolean(task&&task.build_spec_id===r.target_build_spec_id&&
 task.sprint_id===r.owner_sprint_id&&task.status==="CLOSED"&&seteq(r.acceptance_ids,task.acceptance_ids));
const evidenceValid=(ev,r)=>Boolean(ev&&ev.status==="PASS"&&ev.owner_task_id===r.owner_task_id&&
 ev.target_build_spec_id===r.target_build_spec_id&&seteq(ev.acceptance_ids,r.acceptance_ids)&&
 seteq(ev.test_ids,r.test_ids)&&ev.trusted_locator&&ev.source_commit);
function inspectRoundShape({c,p,rounds,bid,item,r,cursor,seq,e}){
 if(r.sequence!==seq)e.push(bid+":SEQUENCE_REPLAY");
 if(!chainValid(c,bid,r,cursor))e.push(bid+":SOURCE_CHAIN_MISMATCH");
 if(!knownBaselines(c,r))e.push(bid+":UNKNOWN_BASELINE");
 if(r.target_build_spec_id!=="BS-P1-025")e.push(bid+":TARGET_BASELINE_WRONG");
 if(!pinsValid(p,r))e.push(bid+":REGISTRY_DIGEST_MISMATCH");
 if(!mappingValid(c,item,r))e.push(bid+":INCOMPLETE_DRIFT_OR_TEST");
 if(r.status!=="CLOSED")e.push(bid+":UNFINISHED_NOT_PROOF");
 if(!ownerValid(rounds.tasks?.[r.owner_task_id],r))e.push(bid+":FOREIGN_OR_UNCLOSED_OWNER");
 if(!Array.isArray(r.evidence_ids)||!r.evidence_ids.length)e.push(bid+":MISSING_EVIDENCE");
}
function inspectRoundOwnership(bid,r,state){
 for(const a of r.acceptance_ids||[]){
  if(state.claims.has(a))state.errors.push(bid+":DUPLICATE_ACCEPTANCE_OWNER");
  state.claims.set(a,r.owner_task_id);
 }
 if(state.used.has(r.replay_nonce)||!r.replay_nonce)state.errors.push(bid+":REPLAY_NONCE");
 state.used.add(r.replay_nonce);
}
function inspectProof({bid,r,id,rounds,c,mode,state}){
 if(state.used.has("ev:"+id))state.errors.push(bid+":EVIDENCE_REPLAY");
 state.used.add("ev:"+id);
 const ev=rounds.evidence?.[id];
 if(!evidenceValid(ev,r))state.errors.push(bid+":EVIDENCE_UNVERIFIED");
 if(mode==="PRODUCTION"&&(typeof c.verifyEvidence!=="function"||c.verifyEvidence(id,ev,r)!==true)){
  state.errors.push(bid+":EXTERNAL_TRUSTED_EVIDENCE_VERIFIER_REQUIRED");
 }
}
function inspectItem({c,p,rounds,mode,bid,t007,state}){
 const item=c.queue.items.find(x=>x.backlog_item_id===bid);
 if(!item||item.status!=="DONE"){state.errors.push(bid+":HISTORICAL_ITEM_MISSING");return}
 let cursor=item.build_spec_id;
 if(item.revalidation)cursor=exactOldRound({c,bid,item,cursor,t007,e:state.errors});
 const list=rounds.rounds?.[bid]||[];
 for(const [i,r] of list.entries()){
  inspectRoundShape({c,p,rounds,bid,item,r,cursor,seq:i+1,e:state.errors});
  inspectRoundOwnership(bid,r,state);
  for(const id of r.evidence_ids||[])inspectProof({bid,r,id,rounds,c,mode,state});
  cursor=r.target_build_spec_id;
 }
 if(changed(c,item,cursor,"BS-P1-025").length)state.errors.push(bid+":UNRESOLVED_VERSION_DRIFT");
}
function audit(c,p,rounds,mode){
 const state={errors:[],claims:new Map(),used:new Set()};
 const t001=c.tasks.tasks.find(x=>x.task_id==="T001");
 const t007=c.tasks.tasks.find(x=>x.task_id==="T007");
 if(!baselineLocked(c))state.errors.push("CANONICAL_HOLD_CHANGED");
 if(!legacyTasksLocked(c,t001,t007))state.errors.push("LEGACY_TASK_OR_SPRINT_MUTATED");
 for(const bid of ["BL-P1-008","BL-P1-010","BL-P1-031","BL-P1-032"]){
  inspectItem({c,p,rounds,mode,bid,t007,state});
 }
 return {ok:state.errors.length===0,errors:[...new Set(state.errors)]};
}
function synthetic(c,p){
 const d={rounds:{},tasks:{},evidence:{}};
 for(const [bid,source,ac,task] of [["BL-P1-008","BS-P1-024",["F01-AC-017"],"T008"],["BL-P1-010","BS-P1-021",["F01-AC-013","F01-AC-016"],"T009"],["BL-P1-031","BS-P1-001",["F07-AC-004"],"T010"]]){
  const tests=ac.map(a=>entry(c,"BS-P1-025",a).test_id),id="POC-ONLY-EV-"+task;
  d.rounds[bid]=[{sequence:1,item_id:bid,source_build_spec_id:source,target_build_spec_id:"BS-P1-025",source_registry_sha256:p[source],target_registry_sha256:p["BS-P1-025"],acceptance_ids:ac,test_ids:tests,owner_task_id:task,owner_sprint_id:"SP-P1-004",status:"CLOSED",evidence_ids:[id],replay_nonce:"POC-ONLY-"+task}];
  d.tasks[task]={sprint_id:"SP-P1-004",build_spec_id:"BS-P1-025",status:"CLOSED",acceptance_ids:ac};
  d.evidence[id]={status:"PASS",owner_task_id:task,target_build_spec_id:"BS-P1-025",acceptance_ids:ac,test_ids:tests,trusted_locator:"TEST-DOUBLE-NOT-CI",source_commit:"SIMULATED-NOT-GIT-SHA",test_double:true,independently_verified:false};
 }
 return d;
}
function scenarios(c,p){
 const d=synthetic(c,p),clone=x=>JSON.parse(JSON.stringify(x)),tests=[];
 const run=(name,expected,mutator,mode="ISOLATED")=>{const v=clone(d);if(mutator)mutator(v);const r=audit(c,p,v,mode);tests.push({name,expected,actual:r.ok,match:expected===r.ok,errors:r.errors})};
 run("P01_TWO_ROUNDS_SYNTHETIC",true);
 run("P02_BL032_PRESERVED_SYNTHETIC",true);
 run("N01_NO_NEW_PROOF",false,x=>{x.rounds={};x.tasks={};x.evidence={}});
 run("N02_BAD_SOURCE",false,x=>x.rounds["BL-P1-008"][0].source_build_spec_id="BS-P1-021");
 run("N03_BAD_TARGET",false,x=>x.rounds["BL-P1-008"][0].target_build_spec_id="BS-P1-024");
 run("N04_FAKE_PASS_PLANNED",false,x=>x.rounds["BL-P1-008"][0].status="PLANNED");
 run("N05_TASK_NOT_CLOSED",false,x=>x.tasks.T008.status="PLANNED");
 run("N06_DUPLICATE_OWNER",false,x=>{x.rounds["BL-P1-010"][0].acceptance_ids.push("F01-AC-017");x.rounds["BL-P1-010"][0].test_ids.push("TEST-F01-SEC-007")});
 run("N07_MISSING_EVIDENCE",false,x=>x.rounds["BL-P1-008"][0].evidence_ids=[]);
 run("N08_FALSE_EVIDENCE_STATUS",false,x=>x.evidence["POC-ONLY-EV-T008"].status="UNVERIFIED");
 run("N09_REPLAY_NONCE",false,x=>x.rounds["BL-P1-010"][0].replay_nonce="POC-ONLY-T008");
 run("N10_REPLAY_EVIDENCE",false,x=>x.rounds["BL-P1-010"][0].evidence_ids=["POC-ONLY-EV-T008"]);
 run("N11_BAD_DIGEST",false,x=>x.rounds["BL-P1-008"][0].target_registry_sha256="0".repeat(64));
 run("N12_FOREIGN_TASK",false,x=>x.rounds["BL-P1-008"][0].owner_task_id="T007");
 run("N13_BAD_TEST_ID",false,x=>x.rounds["BL-P1-008"][0].test_ids=["TEST-FAKE"]);
 run("N14_PARTIAL_DRIFT",false,x=>x.rounds["BL-P1-010"][0].acceptance_ids=["F01-AC-013"]);
 run("N15_SYNTHETIC_NEVER_PRODUCTION",false,null,"PRODUCTION");
 run("N16_FLAG_ONLY_CANNOT_OVERRIDE_TEST_DOUBLE",false,x=>x.evidence["POC-ONLY-EV-T008"].independently_verified=true,"PRODUCTION");
 run("N17_FORGED_VERIFY_FLAG_AND_FAKE_LOCATOR",false,x=>{for(const ev of Object.values(x.evidence)){ev.test_double=false;ev.independently_verified=true;ev.trusted_locator="FORGED-CLAIM-ONLY";}},"PRODUCTION");
 return {total:tests.length,matched:tests.filter(x=>x.match).length,all_expected:tests.every(x=>x.match),tests,warning:"A TEST DOUBLE can mimic a future PASS only in ISOLATED mode. Never production approval."};
}

const results=scenarios(c,p);console.log(JSON.stringify(results,null,2));if(!results.all_expected)process.exitCode=1;
