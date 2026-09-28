import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { canPreserveCompletedBaseline } from "./baseline-lineage.mjs";

const root=process.cwd(), errors=[];
const read=r=>JSON.parse(fs.readFileSync(path.join(root,r),"utf8"));
const evidenceDir=path.join(root,"delivery/evidence");
const files=fs.existsSync(evidenceDir)?fs.readdirSync(evidenceDir).filter(f=>f.endsWith(".json")):[];
const kinds=new Set(["TEST_RESULT","COMMAND_RESULT","REVIEW","SCREENSHOT","VISUAL_DIFF","ACCESSIBILITY","BUILD_ARTIFACT","DEPLOYMENT","RUNTIME_TRACE"]);
const statuses=new Set(["PASS","FAIL","INFO"]);
const ciPolicy=read("ci/policy.json");
const qualityPolicy=read("harness/policy/engineering-quality.json");
const requiredReviewChecks=qualityPolicy.required_review_checks||[];
const seen=new Set(), evidence=new Map(), taskMap=new Map();
const validateReviewEvidence=e=>{
  if(e.kind!=="REVIEW") return;
  if(!e.review_checks || typeof e.review_checks!=="object"){
    errors.push(e.evidence_id+" REVIEW requires review_checks");
  }else{
    for(const key of requiredReviewChecks){
      if(e.review_checks[key]!=="PASS") errors.push(e.evidence_id+" REVIEW check must PASS: "+key);
    }
  }
  if(!Array.isArray(e.blocking_findings)) errors.push(e.evidence_id+" REVIEW blocking_findings must be array");
  else if(e.status==="PASS" && e.blocking_findings.length) errors.push(e.evidence_id+" PASS REVIEW cannot contain blocking_findings");
};

const sprintRoot=path.join(root,"delivery/sprints");
if(fs.existsSync(sprintRoot)){
  for(const s of fs.readdirSync(sprintRoot,{withFileTypes:true}).filter(x=>x.isDirectory() && /^SP-P\d+-\d{3}$/.test(x.name))){
    const tp=path.join(sprintRoot,s.name,"tasks.json");
    if(!fs.existsSync(tp)) continue;
    const td=JSON.parse(fs.readFileSync(tp,"utf8"));
    for(const t of td.tasks||[]) taskMap.set(s.name+"/"+t.task_id,t);
  }
}

const isAncestor=sha=>{
  if(!/^[0-9a-f]{40}$/.test(sha||"") || /^0+$/.test(sha||"")) return false;
  try{execFileSync("git",["cat-file","-e",sha+"^{commit}"],{stdio:"ignore"}); return true;}
  catch{return false;}
};

for(const file of files){
  const e=JSON.parse(fs.readFileSync(path.join(evidenceDir,file),"utf8"));
  if(e.schema_version!==2) errors.push((e.evidence_id||file)+" evidence schema_version must be 2");
  if(!/^EV-SP-P\d+-\d{3}-T\d{3}-\d{3}$/.test(e.evidence_id||"")) errors.push("Invalid evidence_id: "+file);
  if(file!==e.evidence_id+".json") errors.push("Evidence filename must equal evidence_id: "+file);
  if(seen.has(e.evidence_id)) errors.push("Duplicate evidence_id: "+e.evidence_id); seen.add(e.evidence_id);
  if(!kinds.has(e.kind)) errors.push(e.evidence_id+" invalid kind");
  if(!statuses.has(e.status)) errors.push(e.evidence_id+" invalid status");
  for(const k of ["build_spec_id","sprint_id","task_id","locator","recorded_at","source_commit"]) if(!e[k]) errors.push(e.evidence_id+" missing "+k);
  if(!Array.isArray(e.acceptance_ids)) errors.push(e.evidence_id+" acceptance_ids must be array");
  if(!Array.isArray(e.test_ids)) errors.push(e.evidence_id+" test_ids must be array");
  if(e.sha256!==null && !/^[0-9a-f]{64}$/.test(e.sha256||"")) errors.push(e.evidence_id+" invalid sha256");
  if(!/^[0-9a-f]{40}$/.test(e.source_commit||"") || /^0+$/.test(e.source_commit||"")) errors.push(e.evidence_id+" invalid source_commit");
  else if(!isAncestor(e.source_commit)) errors.push(e.evidence_id+" source_commit not found in repository history: "+e.source_commit);

  const task=taskMap.get(e.sprint_id+"/"+e.task_id);
  if(!task) errors.push(e.evidence_id+" binds unknown Sprint/Task");
  else{
    const evidenceLinks=(e.acceptance_ids||[]).map((acceptance_id,index)=>({acceptance_id,test_id:(e.test_ids||[])[index]}));
    const legacyCompatible=e.build_spec_id!==task.build_spec_id &&
      canPreserveCompletedBaseline(root,e.build_spec_id,task.build_spec_id,evidenceLinks);
    if(e.build_spec_id!==task.build_spec_id && !legacyCompatible) errors.push(e.evidence_id+" build_spec binding mismatch");
    const mapped=new Map((task.acceptance_links||[]).map(x=>[x.acceptance_id,x.test_id]));
    if((e.acceptance_ids||[]).length!==(e.test_ids||[]).length) errors.push(e.evidence_id+" acceptance_ids/test_ids length mismatch");
    for(let i=0;i<(e.acceptance_ids||[]).length;i++){
      const aid=e.acceptance_ids[i], tid=e.test_ids[i];
      if(!mapped.has(aid) || mapped.get(aid)!==tid) errors.push(e.evidence_id+" contains unmapped AC/Test pair "+aid+" ↔ "+tid);
    }
    const requiredCommands=new Set([
      ...(ciPolicy.required_on_every_implementation_change||[]).map(x=>"npm run "+x),
      ...(task.required_commands||[])
    ]);
    if(e.kind==="TEST_RESULT" && (!(e.acceptance_ids||[]).length || !(e.test_ids||[]).length)) errors.push(e.evidence_id+" TEST_RESULT requires mapped AC/Test pair(s)");
    if(e.kind==="COMMAND_RESULT"){
      if(typeof e.command!=="string" || !requiredCommands.has(e.command)) errors.push(e.evidence_id+" COMMAND_RESULT command is not required by Task/global CI: "+e.command);
    }
    validateReviewEvidence(e);
  }
  evidence.set(e.evidence_id,e);
}

for(const [key,t] of taskMap){
  const [sprintId,taskId]=key.split("/");
  if(!Array.isArray(t.completion_evidence)) errors.push(key+" completion_evidence must be array");
  const refs=(t.completion_evidence||[]).map(id=>evidence.get(id)).filter(Boolean);
  for(const eid of t.completion_evidence||[]){
    const e=evidence.get(eid);
    if(!e) errors.push(key+" references missing evidence "+eid);
    else if(e.sprint_id!==sprintId || e.task_id!==taskId || e.build_spec_id!==t.build_spec_id) errors.push(eid+" binding mismatch");
  }

  if(["REVIEW","VERIFIED","CLOSED"].includes(t.status)){
    const requiredPairs=(t.acceptance_links||[]).map(x=>x.acceptance_id+"::"+x.test_id);
    const passedPairs=new Set();
    for(const e of refs.filter(e=>e.kind==="TEST_RESULT" && e.status==="PASS")){
      for(let i=0;i<(e.acceptance_ids||[]).length;i++) passedPairs.add(e.acceptance_ids[i]+"::"+e.test_ids[i]);
    }
    for(const pair of requiredPairs) if(!passedPairs.has(pair)) errors.push(key+" missing PASS TEST_RESULT Evidence for "+pair);

    const requiredCommands=new Set([
      ...(ciPolicy.required_on_every_implementation_change||[]).map(x=>"npm run "+x),
      ...(t.required_commands||[])
    ]);
    const passedCommands=new Set(refs.filter(e=>e.kind==="COMMAND_RESULT" && e.status==="PASS").map(e=>e.command));
    for(const cmd of requiredCommands) if(!passedCommands.has(cmd)) errors.push(key+" missing PASS COMMAND_RESULT Evidence for "+cmd);
  }

  if(["VERIFIED","CLOSED"].includes(t.status)){
    const reviews=refs.filter(e=>e.kind==="REVIEW" && e.status==="PASS");
    if(!reviews.length) errors.push(key+" verified/closed without PASS Engineering/Semantic REVIEW Evidence");
  }
}

if(errors.length){console.error("EVIDENCE GATE: FAIL");errors.forEach(e=>console.error("- "+e));process.exit(1);}
console.log("EVIDENCE GATE: PASS");
