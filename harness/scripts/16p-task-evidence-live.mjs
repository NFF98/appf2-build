// #1/#6/#E: read real merged GitHub PRs, Main canonical Task and all referenced
// Evidence files. No PR, Registry, Main or Human authorization is ever mutated.
import fs from "node:fs";
import {execFileSync,spawnSync} from "node:child_process";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {reportContext,planTaskEvidenceReferences} from "./evidence-ledger-report.mjs";
import {buildEvidenceLedger} from "./evidence-ledger.mjs";
import {taskIdentityOfPr} from "./task-pr-lifecycle.mjs";
const repository=process.env.GITHUB_REPOSITORY||"NFF98/appf2-build";
const pathOfTask="delivery/sprints/SP-P1-003/tasks.json";
const sprint="SP-P1-003";
function api(route){
 return JSON.parse(execFileSync("gh",["api","repos/"+repository+"/"+route],{
  encoding:"utf8",timeout:30000,maxBuffer:30000000,
  env:process.env
 }));
}
const decode=x=>Buffer.from(String(x?.content||"").replace(/\s/g,""),"base64");
const hard=(condition,reason)=>{if(!condition)throw Error("REAL_EVIDENCE_HARD_STOP: "+reason)};
function actualMainFile(relative,sha){
 const remote=api("contents/"+relative+"?ref="+sha);
 const bytes=decode(remote);
 // GitHub Main is canonical. A pending control transition may differ from Main.
 // Verify real GitHub bytes against the immutable local Main Git object.
 const localMain=execFileSync("git",["show",sha+":"+relative],{
  encoding:null,timeout:15000,maxBuffer:30000000});
 hard(bytes.equals(localMain),"Main bytes differ from exact local Main Git object for "+relative);
 return JSON.parse(bytes.toString("utf8"));
}
const ancestry=(source,main)=>spawnSync("git",["merge-base","--is-ancestor",source,main],
 {encoding:"utf8",timeout:15000}).status===0;
/** Product HOLD is not an active Sprint. reportContext stays fail-closed (NOT_RUN). */
export const productHoldSprint=s=>s?.status==="HOLD"&&s.active_sprint===null&&
 s.active_task===null&&s.active_build_spec===null;
export const t008CanonicalUnderMain=(mainSprint,task)=>{
 const historic=mainSprint?.active_sprint===sprint&&task?.task_id==="T008";
 return historic||(productHoldSprint(mainSprint)&&task?.task_id==="T008");
};
/** HOLD: historic Task PR must stay NOT_RUN. Live Sprint: still READY_TO_REPORT. */
export const historicReporterAccepted=(productHold,status)=>productHold?
 status==="NOT_RUN_NO_ACTIVE_SPRINT":status==="READY_TO_REPORT";
export const historicMergeChainOk=(ident,primary,evidencePr)=>ident?.ok===true&&
 ident.task_id==="T008"&&primary?.merged===true&&evidencePr?.merged===true&&
 evidencePr?.base?.sha===primary?.merge_commit_sha&&
 String(evidencePr?.body||"").includes("T008");
export const evidenceCountOk=ids=>Array.isArray(ids)&&ids.length===14&&new Set(ids).size===14;
function verifyHistoricalPrs(mainSprint){
 const primary=api("pulls/386"),evidencePr=api("pulls/387"),current=api("pulls/404");
 const productHold=productHoldSprint(mainSprint);
 hard(historicMergeChainOk(taskIdentityOfPr(primary),primary,evidencePr),
  "real #386 and #387 merge chain or Task declaration invalid");
 hard(taskIdentityOfPr(current).ok===false,"governance PR accepted as Product");
 hard(historicReporterAccepted(productHold,reportContext({pull_request:primary},mainSprint).status),
  productHold?"HOLD must keep Evidence reporter blocked for historic Task PR":
   "valid historic Task PR rejected by Evidence reporter");
 hard(reportContext({pull_request:current},mainSprint).status==="NOT_RUN_NO_TASK_PR",
  "governance PR accepted by Evidence reporter");
 return {primary,evidencePr};
}
function loadMainEvidence(task,mainSha){
 const ids=task.completion_evidence||[];
 hard(evidenceCountOk(ids),"T008 canonical Evidence list not 14 unique IDs");
 const inventory=api("contents/delivery/evidence?ref="+mainSha);
 hard(Array.isArray(inventory),"Main Evidence inventory unavailable");
 const filenames=inventory.filter(e=>e.name?.startsWith("EV-SP-P1-003-T008-")&&
  e.name?.endsWith(".json")).map(e=>e.name);
 hard(filenames.length===14&&filenames.every(f=>ids.includes(f.slice(0,-5))),
  "Existing T008 Evidence files conflict with canonical Task refs");
 return {ids,unique:new Set(ids),docs:ids.map(id=>actualMainFile("delivery/evidence/"+id+".json",mainSha))};
}
function run(){
 hard(repository==="NFF98/appf2-build","unexpected repository");
 const mainSha=api("branches/main")?.commit?.sha;
 hard(/^[a-f0-9]{40}$/.test(mainSha||""),"Main SHA absent");
 const mainSprint=actualMainFile("delivery/CURRENT-SPRINT.json",mainSha);
 const taskDoc=actualMainFile(pathOfTask,mainSha);
 const task=taskDoc.tasks?.find(x=>x.task_id==="T008");
 hard(t008CanonicalUnderMain(mainSprint,task),"T008 not canonical");
 const {primary,evidencePr}=verifyHistoricalPrs(mainSprint);
 const {ids,unique,docs}=loadMainEvidence(task,mainSha);
 const ci=actualMainFile("ci/policy.json",mainSha);
 const policy=actualMainFile("harness/policy/governance-reform.json",mainSha);
 const commands=[...(ci.required_on_every_implementation_change||[]).map(s=>"npm run "+s),
  ...(task.required_commands||[])];
 const ledger=buildEvidenceLedger({task,sprintId:sprint,evidenceList:docs,
  requiredCommands:new Set(commands),
  isAncestor:sha=>ancestry(sha,mainSha),proofLevels:policy.evidence_proof_levels});
 const normalized=planTaskEvidenceReferences({task,sprintId:sprint,ledger,
  existingEvidence:docs});
 const receipt={schema:"APPF2-T008-REAL-CANONICAL-EVIDENCE-1",main_sha:mainSha,
  source_pr:386,evidence_pr:387,source_merge_sha:primary.merge_commit_sha,
  evidence_merge_sha:evidencePr.merge_commit_sha,task_status:task.status,
  identity_positive:true,identity_governance_negative:true,
  actual_github_evidence_files_read:docs.length,
  expected_canonical_evidence_count:ids.length,all_unique:unique.size===ids.length,
  ledger_readiness:ledger.evidence_readiness,missing_pairs:ledger.missing_pairs,
  missing_commands:ledger.missing_commands,missing_review:ledger.missing_review,
  duplicates:ledger.duplicates,stale:ledger.stale,dangling:ledger.dangling_refs,
  unreferenced:ledger.unreferenced,proof_levels:ledger.proof_levels,
  normalization_plan_ok:normalized.ok,normalization_plan_status:normalized.status,
  normalization_needed:normalized.changed,normalization_errors:normalized.errors,
  protected_write_executed:false,complete_single_pr_e2e:false,task_closed:false,
  verdict:normalized.ok&&!normalized.changed?"CANONICAL_ALREADY_NORMALIZED_READ_ONLY":
   "REQUIRES_FURTHER_VERIFICATION"};
 const out=process.env.TASK_EVIDENCE_RECEIPT||path.join(process.env.RUNNER_TEMP||"/tmp",
  "16p-t008-canonical-live.json");
 fs.writeFileSync(out,JSON.stringify(receipt,null,2)+"\n");
 console.log("16P REAL T008 EVIDENCE "+JSON.stringify(receipt));
 hard(normalized.ok&&normalized.changed===false,
   "GitHub Main evidence not correctly normalized; see receipt");
 hard(task.status==="REVIEW","Must preserve Task status; no closure inferred");
}
const expectStop=(fn,part)=>{
 let message="";
 try{fn();}catch(e){message=String(e.message||"");}
 if(!message.includes("REAL_EVIDENCE_HARD_STOP")||!message.includes(part))
  throw Error("NEGATIVE_FAILED_OPEN: "+part+" got "+message);
};
/** Synthetic only. Does not call GitHub and does not change reportContext. */
export function runHoldCompatSelftest(){
 const hold={status:"HOLD",active_sprint:null,active_task:null,active_build_spec:null};
 const live={status:"REVIEW",active_sprint:sprint,active_task:"T008",active_build_spec:"BS-P1-025"};
 const t008Pr={title:"T008: historical evidence",body:"Task: T008\n"};
 const govPr={title:"governance fix",body:"no task declaration"};
 const holdCtx=reportContext({pull_request:t008Pr},hold);
 const liveCtx=reportContext({pull_request:t008Pr},live);
 const govCtx=reportContext({pull_request:govPr},hold);
 hard(holdCtx.status==="NOT_RUN_NO_ACTIVE_SPRINT","reportContext HOLD contract drifted");
 hard(liveCtx.status==="READY_TO_REPORT","reportContext live Sprint contract drifted");
 hard(govCtx.status==="NOT_RUN_NO_TASK_PR","reportContext governance contract drifted");
 hard(historicReporterAccepted(true,holdCtx.status),"HOLD historic reporter");
 hard(historicReporterAccepted(false,liveCtx.status),"live historic reporter");
 hard(t008CanonicalUnderMain(hold,{task_id:"T008"}),"HOLD T008 canonical");
 hard(t008CanonicalUnderMain(live,{task_id:"T008"}),"live T008 canonical");
 const ids=[...Array(14)].map((_,i)=>"EV-SP-P1-003-T008-"+String(i+1).padStart(3,"0"));
 hard(evidenceCountOk(ids),"14 unique evidence");
 const ident={ok:true,task_id:"T008"},primary={merged:true,merge_commit_sha:"abc"};
 const evidencePr={merged:true,base:{sha:"abc"},body:"includes T008"};
 hard(historicMergeChainOk(ident,primary,evidencePr),"historic merge chain");
 hard(taskIdentityOfPr(govPr).ok===false,"governance identity stays negative");
 hard({status:"REVIEW"}.status==="REVIEW","T008 REVIEW preserved");
 expectStop(()=>hard(historicReporterAccepted(true,"READY_TO_REPORT"),
  "HOLD must keep Evidence reporter blocked for historic Task PR"),
  "HOLD must keep Evidence reporter blocked");
 expectStop(()=>hard(historicReporterAccepted(false,"NOT_RUN_NO_ACTIVE_SPRINT"),
  "valid historic Task PR rejected by Evidence reporter"),
  "valid historic Task PR rejected");
 expectStop(()=>hard(t008CanonicalUnderMain(hold,null),"T008 not canonical"),"T008 not canonical");
 expectStop(()=>hard(t008CanonicalUnderMain(
  {status:"HOLD",active_sprint:null,active_task:"T016",active_build_spec:null},{task_id:"T008"}),
  "T008 not canonical"),"T008 not canonical");
 expectStop(()=>hard(t008CanonicalUnderMain(
  {status:"ACTIVE",active_sprint:"SP-P1-004"},{task_id:"T008"}),"T008 not canonical"),
  "T008 not canonical");
 expectStop(()=>hard(evidenceCountOk(ids.slice(0,13)),
  "T008 canonical Evidence list not 14 unique IDs"),"not 14 unique");
 expectStop(()=>hard(evidenceCountOk([...ids.slice(0,13),ids[0]]),
  "T008 canonical Evidence list not 14 unique IDs"),"not 14 unique");
 expectStop(()=>hard(historicMergeChainOk(ident,{merged:false,merge_commit_sha:"abc"},evidencePr),
  "real #386 and #387 merge chain or Task declaration invalid"),"merge chain");
 expectStop(()=>hard(historicMergeChainOk(ident,primary,
  {merged:true,base:{sha:"other"},body:"T008"}),
  "real #386 and #387 merge chain or Task declaration invalid"),"merge chain");
 expectStop(()=>hard(historicMergeChainOk({ok:false,task_id:null},primary,evidencePr),
  "real #386 and #387 merge chain or Task declaration invalid"),"merge chain");
 expectStop(()=>hard(taskIdentityOfPr(t008Pr).ok===false,"governance PR accepted as Product"),
  "governance PR accepted as Product");
 expectStop(()=>hard({status:"CLOSED"}.status==="REVIEW",
  "Must preserve Task status; no closure inferred"),"Must preserve Task status");
 console.log("16P T008 HOLD COMPAT positive=11 negative=12 PASS (synthetic; reportContext unchanged)");
}
if(import.meta.url===pathToFileURL(process.argv[1]||"").href){
 const entry=process.argv.includes("--selftest")?runHoldCompatSelftest:run;
 try{entry();}catch(e){
  console.error((process.argv.includes("--selftest")?"16P T008 HOLD COMPAT SELFTEST FAIL ":"16P LIVE EVIDENCE FAIL ")+e.message);
  process.exitCode=1;
 }
}
