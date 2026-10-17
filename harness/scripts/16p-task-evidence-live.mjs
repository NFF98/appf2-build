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
function verifyHistoricalPrs(mainSprint){
 const primary=api("pulls/386"),evidencePr=api("pulls/387"),current=api("pulls/404");
 const ident=taskIdentityOfPr(primary);
 const historicValid=ident.ok&&ident.task_id==="T008"&&
  primary.merged===true&&evidencePr.merged===true&&
  evidencePr.base?.sha===primary.merge_commit_sha&&
  String(evidencePr.body||"").includes("T008");
 hard(historicValid,"real #386 and #387 merge chain or Task declaration invalid");
 hard(taskIdentityOfPr(current).ok===false,"governance PR accepted as Product");
 hard(reportContext({pull_request:primary},mainSprint).status==="READY_TO_REPORT",
  "valid historic Task PR rejected by Evidence reporter");
 hard(reportContext({pull_request:current},mainSprint).status==="NOT_RUN_NO_TASK_PR",
  "governance PR accepted by Evidence reporter");
 return {primary,evidencePr};
}
function loadMainEvidence(task,mainSha){
 const ids=task.completion_evidence||[],unique=new Set(ids);
 hard(ids.length===14&&unique.size===14,"T008 canonical Evidence list not 14 unique IDs");
 const inventory=api("contents/delivery/evidence?ref="+mainSha);
 hard(Array.isArray(inventory),"Main Evidence inventory unavailable");
 const filenames=inventory.filter(e=>e.name?.startsWith("EV-SP-P1-003-T008-")&&
  e.name?.endsWith(".json")).map(e=>e.name);
 hard(filenames.length===14&&filenames.every(f=>ids.includes(f.slice(0,-5))),
  "Existing T008 Evidence files conflict with canonical Task refs");
 return {ids,unique,docs:ids.map(id=>actualMainFile("delivery/evidence/"+id+".json",mainSha))};
}
function run(){
 hard(repository==="NFF98/appf2-build","unexpected repository");
 const mainSha=api("branches/main")?.commit?.sha;
 hard(/^[a-f0-9]{40}$/.test(mainSha||""),"Main SHA absent");
 const mainSprint=actualMainFile("delivery/CURRENT-SPRINT.json",mainSha);
 const taskDoc=actualMainFile(pathOfTask,mainSha);
 const task=taskDoc.tasks?.find(x=>x.task_id==="T008");
 hard(mainSprint.active_sprint===sprint&&task?.task_id==="T008","T008 not canonical");
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
if(import.meta.url===pathToFileURL(process.argv[1]||"").href){
 try{run();}catch(e){console.error("16P LIVE EVIDENCE FAIL "+e.message);process.exitCode=1;}
}
