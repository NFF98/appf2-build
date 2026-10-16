// GOV-REFORM-20261013: Task-PR Evidence ledger as an automatic,
 // read-only report. No Evidence or Task files are mutated. The report is not a PASS.
import fs from "node:fs";
import {spawnSync,execFileSync} from "node:child_process";
import {verifyLiveGrant} from "./trusted-human-task-grant.mjs";
import {pathToFileURL} from "node:url";

export function reportContext(event, current){
  const body=event?.pull_request?.body||"";
  const match=/^Task:\s*(T\d{3})\b/m.exec(body);
  if(!event?.pull_request || !match) return {status:"NOT_RUN_NO_TASK_PR"};
  const id=match[1];
  if(!current.active_sprint) return {status:"NOT_RUN_NO_ACTIVE_SPRINT",task_id:id};
  return {status:"READY_TO_REPORT",task_id:id,sprint_id:current.active_sprint};
}

const EVIDENCE_STATUSES=new Set(["PASS","FAIL","INFO"]);
const TASK_STATES=new Set(["IN_PROGRESS","REVIEW"]);
const hex40=s=>/^[a-f0-9]{40}$/.test(s||"");
const readJson=p=>JSON.parse(fs.readFileSync(p,"utf8"));
const activeLease=(s,b,t)=>s?.active_sprint&&s.active_task===t?.task_id&&
  s.active_build_spec===t?.build_spec_id&&b?.active_baseline===t?.build_spec_id&&
  b?.implementation_enabled===true&&["ACTIVE","REVIEW"].includes(s.status);
const distinctList=x=>Array.isArray(x)&&new Set(x).size===x.length;
const zeroList=x=>Array.isArray(x)&&x.length===0;
const ledgerScopeOK=(l,t,s)=>[l?.task_id===t?.task_id,l?.sprint_id===s].every(Boolean);
const referenceNameOK=(e,id)=>[e?.evidence_id===id,
  /^EV-SP-P\d+-\d{3}-T\d{3}-\d{3}$/.test(id)].every(Boolean);
const validDocumentState=e=>[e?.schema_version===2,
  EVIDENCE_STATUSES.has(e?.status),hex40(e?.source_commit)].every(Boolean);
const documentScopeOK=(e,t,s)=>[e?.sprint_id===s,
  e?.task_id===t?.task_id,e?.build_spec_id===t?.build_spec_id].every(Boolean);
const matchingPairs=(e,pairs)=>[
  Array.isArray(e?.acceptance_ids),Array.isArray(e?.test_ids),
  e?.acceptance_ids?.length===e?.test_ids?.length
].every(Boolean) && e.acceptance_ids.every((a,i)=>pairs.get(a)===e.test_ids[i]);
const normalizeError=(errors,ok,msg)=>{if(!ok)errors.push(msg);};
const reviewReference=({errors,id,docs,task,sprintId,pairs})=>{
  const e=docs.get(id),deny=(ok,msg)=>normalizeError(errors,ok,msg+": "+id);
  deny(referenceNameOK(e,id),"Missing exact canonical Evidence");
  deny(validDocumentState(e),"Evidence invalid schema/status/source SHA");
  deny(documentScopeOK(e,task,sprintId),"Evidence scope differs");
  deny(matchingPairs(e,pairs),"Evidence AC/Test linkage differs");
};
const completeReferencePlan=(prior,proposed)=>{
  const add=proposed.filter(id=>!prior.includes(id));
  return {ok:true,status:add.length?"READY_TO_APPEND_REFERENCES":"ALREADY_NORMALIZED",
    errors:[],add,changed:add.length>0,completion_evidence:[...prior,...add]};
};
/** Only update existing Task Evidence IDs; no PASS fabrication or Task closure. */
export function planTaskEvidenceReferences({task,sprintId,ledger,existingEvidence}={}){
  const errors=[],deny=(ok,msg)=>normalizeError(errors,ok,msg);
  const prior=task?.completion_evidence,proposed=ledger?.suggested_completion_evidence;
  deny(TASK_STATES.has(task?.status),"Task is not IN_PROGRESS/REVIEW");
  deny(distinctList(prior),"Task existing references malformed/duplicated");
  deny(ledgerScopeOK(ledger,task,sprintId),"Evidence ledger Task/Sprint mismatch");
  deny(distinctList(proposed),"Evidence references missing/duplicated");
  deny(zeroList(ledger?.duplicates),"Ambiguous duplicated Evidence");
  deny(zeroList(ledger?.stale),"Stale Evidence");
  deny(zeroList(ledger?.dangling_refs),"Dangling references");
  const documents=Array.isArray(existingEvidence)?existingEvidence:[];
  const docs=new Map(documents.map(e=>[e?.evidence_id,e]));
  deny(docs.size===documents.length,"Canonical Evidence IDs duplicated");
  const pairs=new Map((task?.acceptance_links||[]).map(x=>[x.acceptance_id,x.test_id]));
  for(const id of [...(prior||[]),...(proposed||[])])
    reviewReference({errors,id,docs,task,sprintId,pairs});
  if(errors.length)return {ok:false,status:"HARD_STOP",errors,add:[],changed:false};
  return completeReferencePlan(prior,proposed);
}
const gh=async (endpoint,token,options={})=>{
  const res=await fetch("https://api.github.com"+endpoint,{
    method:options.method||"GET",
    headers:{accept:"application/vnd.github+json",authorization:"Bearer "+token,
      "X-GitHub-Api-Version":"2026-03-10","User-Agent":"appf2-evidence-normalize",
      ...(options.body?{"content-type":"application/json"}:{})},
    ...(options.body?{body:JSON.stringify(options.body)}:{})
  });
  if(!res.ok)throw Error("Evidence normalization GitHub API HARD_STOP "+
    res.status+" "+endpoint);
  return res.json();
};
const ledgerFor=(sprintId,taskId)=>{
  const run=spawnSync(process.execPath,["harness/scripts/evidence-ledger.mjs",
    "--sprint",sprintId,"--task",taskId,"--json"],
  {encoding:"utf8",timeout:30000});
  if(run.status!==0)throw Error("Evidence ledger not executable: "+
    (run.stderr||run.stdout||"unknown").slice(0,350));
  return JSON.parse(run.stdout);
};
const evidenceDocuments=()=>fs.readdirSync("delivery/evidence")
  .filter(x=>x.endsWith(".json")).map(x=>readJson("delivery/evidence/"+x));
const samePrBranch=(pr,head)=>[
  pr?.state==="open",pr?.head?.sha===head,hex40(head),
  pr?.head?.ref!=="main",pr?.head?.repo?.full_name==="NFF98/appf2-build",
  pr?.base?.repo?.full_name==="NFF98/appf2-build",pr?.base?.ref==="main"
].every(Boolean);
const validReconcileRequest=({prNumber,token})=>
  [Number.isSafeInteger(prNumber),prNumber>0,Boolean(token)].every(Boolean);
const shouldNotWrite=(plan,apply)=>[!plan?.ok,!plan?.changed,!apply].some(Boolean);
const normalizeTaskRow=(task,id,plan)=>task.task_id===id
  ?{...task,completion_evidence:plan.completion_evidence}:task;
const updatedTaskDoc=(doc,id,plan)=>({...doc,tasks:doc.tasks.map(
  t=>normalizeTaskRow(t,id,plan))});
const exactTaskBytes=(content,path)=>Buffer.from(
  (content.content||"").replace(/\s/g,""),"base64").toString("utf8")===
  fs.readFileSync(path,"utf8");
const taskFromPr=pr=>/^Task:\s*(T\d{3})\b/m.exec(pr?.body||"")?.[1];
const taskFromDoc=(doc,id)=>(doc.tasks||[]).find(t=>t.task_id===id);
const didCommitWrite=out=>hex40(out?.commit?.sha);
export async function reconcileTaskEvidencePr({prNumber,token,apply=false}={}){
  if(!validReconcileRequest({prNumber,token}))
    throw Error("HARD_STOP: missing PR number or GitHub token");
  const repo="/repos/NFF98/appf2-build";
  const pr=await gh(repo+"/pulls/"+prNumber,token);
  const head=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
  if(!samePrBranch(pr,head))throw Error("HARD_STOP: stale, fork, merged or Main PR");
  const sprint=readJson("delivery/CURRENT-SPRINT.json"),
    build=readJson("build-spec/CURRENT.json");
  const taskId=taskFromPr(pr);
  const path="delivery/sprints/"+sprint.active_sprint+"/tasks.json";
  const doc=readJson(path),task=taskFromDoc(doc,taskId);
  if(!activeLease(sprint,build,task))
    throw Error("HARD_STOP: active Task lease missing or wrong scope");
  const ledger=ledgerFor(sprint.active_sprint,taskId);
  const plan=planTaskEvidenceReferences({task,sprintId:sprint.active_sprint,
    ledger,existingEvidence:evidenceDocuments()});
  if(shouldNotWrite(plan,apply))return {...plan,action:apply?"NO_MUTATION":"PLAN_ONLY",
    head_sha:head,pr_number:prNumber};
  // Directly check live Environment approval; a caller boolean is NEVER enough.
  await verifyLiveGrant({pr,token});
  const content=await gh(repo+"/contents/"+path+"?ref="+head,token);
  if(!exactTaskBytes(content,path))
    throw Error("HARD_STOP: local Task bytes differ from live GitHub HEAD");
  const fresh=await gh(repo+"/pulls/"+prNumber,token);
  if(!samePrBranch(fresh,head))throw Error("HARD_STOP: PR HEAD moved during normalization");
  const updated=updatedTaskDoc(doc,taskId,plan);
  const response=await gh(repo+"/contents/"+path,token,{method:"PUT",body:{
    branch:pr.head.ref,sha:content.sha,
    message:"Task "+taskId+": normalize existing canonical Evidence references (no status change)",
    content:Buffer.from(JSON.stringify(updated,null,2)+"\n").toString("base64")}});
  if(!didCommitWrite(response))
    throw Error("HARD_STOP: canonical PR evidence update commit was not verified");
  return {...plan,action:"COMMITTED_TO_SAME_TASK_PR_NOT_MAIN",pr_number:prNumber,
    previous_head:head,new_head:response.commit.sha,
    note:"New HEAD invalidates earlier CI/BCE; revalidate before Merge. No closure."};
}


const exactClosureSource=(pr,grant)=>[
  pr?.state==="closed",pr?.merged===true,
  /^[a-f0-9]{40}$/.test(pr?.merge_commit_sha||""),
  grant?.ok===true,grant?.decision==="VERIFIED_GITHUB_HUMAN_APPROVAL",
  grant?.phase==="POST_MERGE_CLOSURE",grant?.mergedOnMain===true,
  grant?.current_head===pr?.head?.sha
].every(Boolean);
const completeCanonicalLedger=l=>[
  l?.evidence_readiness==="EVIDENCE_COMPLETE_FOR_CLOSURE_CONTROL",
  l?.missing_review===false,
  Array.isArray(l?.missing_pairs)&&l.missing_pairs.length===0,
  Array.isArray(l?.missing_commands)&&l.missing_commands.length===0,
  Array.isArray(l?.duplicates)&&l.duplicates.length===0,
  Array.isArray(l?.stale)&&l.stale.length===0,
  Array.isArray(l?.dangling_refs)&&l.dangling_refs.length===0,
  Array.isArray(l?.unreferenced)&&l.unreferenced.length===0
].every(Boolean);
const closureTaskIdentity=({task,sprint,build,ledger})=>[
  task?.status==="REVIEW",task?.task_id===sprint?.active_task,
  task?.build_spec_id===sprint?.active_build_spec,
  task?.build_spec_id===build?.active_baseline,
  sprint?.status==="REVIEW",Boolean(sprint?.active_sprint),
  build?.implementation_enabled===true,
  ledger?.task_id===task?.task_id,ledger?.sprint_id===sprint?.active_sprint
].every(Boolean);
const specialClosureSequence=({task,sprint})=>
  sprint?.active_sprint==="SP-P1-003"&&["T006","T008"].includes(task?.task_id);
/** Pure closure preflight. It never changes statuses, creates PRs or fabricates PASS. */
export function planTaskClosureReadiness({task,sprint,build,ledger,grant,pr}={}){
  const errors=[],deny=(ok,msg)=>{if(!ok)errors.push(msg);};
  deny(exactClosureSource(pr,grant),"Live merged PR / Human grant Main ancestry not proven");
  deny(closureTaskIdentity({task,sprint,build,ledger}),
    "Canonical REVIEW Task/Sprint/Build binding not ready");
  deny(completeCanonicalLedger(ledger),
    "Canonical Evidence missing, duplicated, stale, unreferenced or lacking PASS review");
  deny(!specialClosureSequence({task,sprint}),
    "SP-P1-003 T006/T008 require separate Human L3 closure-order resolution");
  return {ok:errors.length===0,
    decision:errors.length?"HARD_STOP":"ELIGIBLE_FOR_SEPARATE_PROTECTED_CONTROL_REVIEW",
    errors,task_id:task?.task_id,sprint_id:sprint?.active_sprint,
    mutates:false,closure_performed:false};
}
export async function liveTaskClosureCheck({prNumber,token}={}){
  if(!validReconcileRequest({prNumber,token}))
    throw Error("HARD_STOP: invalid closure query");
  const repo="/repos/NFF98/appf2-build";
  const pr=await gh(repo+"/pulls/"+prNumber,token);
  const grant=await verifyLiveGrant({pr,token,phase:"POST_MERGE_CLOSURE"});
  const sprint=readJson("delivery/CURRENT-SPRINT.json"),
    build=readJson("build-spec/CURRENT.json"),
    taskId=taskFromPr(pr);
  const task=taskFromDoc(readJson("delivery/sprints/"+sprint.active_sprint+"/tasks.json"),taskId);
  const ledger=task?ledgerFor(sprint.active_sprint,taskId):null;
  return {...planTaskClosureReadiness({task,sprint,build,ledger,grant,pr}),
    pr_number:prNumber,merged_commit:pr?.merge_commit_sha,
    note:"Read-only post-merge preflight. Separate protected control transition and Human L3 remain required."};
}


// Closure mutation is deliberately separate from ordinary product implementation.
// The only write target is an already-open, dedicated, SAME-TASK CONTROL PR branch.
// A Human L3 change, Main branch push, unauthorized status, or unrelated file fails closed.
const ONLY_BUILD_REPO="NFF98/appf2-build";
const prControlIdentity=(source,control,id)=>[
  source?.number!==control?.number,
  control?.state==="open",control?.draft===true,
  control?.base?.ref==="main",control?.base?.repo?.full_name===ONLY_BUILD_REPO,
  control?.head?.repo?.full_name===ONLY_BUILD_REPO,control?.head?.ref!=="main",
  /^[a-f0-9]{40}$/.test(control?.head?.sha||""),
  new RegExp("^Task:\\s*"+id+"\\s*$","m").test(control?.body||""),
  new RegExp("^Closure-Source-PR:\\s*"+source?.number+"\\s*$","m").test(control?.body||"")
].every(Boolean);
const exactControlFileInventory=(files,path)=>Array.isArray(files)&&
  files.length===1&&files[0]?.filename===path &&
  ["modified"].includes(files[0]?.status);
const sameTaskExceptStatus=(a,b,id)=>[
  a?.task_id===id,b?.task_id===id,
  JSON.stringify({...a,status:null})===JSON.stringify({...b,status:null})
].every(Boolean);
/** Only the eligible reviewed Task's status can become CLOSED. */
export function planProtectedClosureMutation({plan,mainDoc,controlDoc,taskId}={}){
  const errors=[],deny=(ok,msg)=>{if(!ok)errors.push(msg);};
  deny(plan?.ok===true&&plan?.decision==="ELIGIBLE_FOR_SEPARATE_PROTECTED_CONTROL_REVIEW",
    "Independent post-merge closure plan was not eligible");
  deny(/^T\d{3}$/.test(taskId||"")&&plan?.task_id===taskId,"Closure Task ID mismatch");
  deny(mainDoc?.sprint_id===plan?.sprint_id&&controlDoc?.sprint_id===plan?.sprint_id,
    "Canonical Sprint ID mismatch");
  deny(Array.isArray(mainDoc?.tasks)&&Array.isArray(controlDoc?.tasks)&&
    mainDoc?.tasks?.length===controlDoc?.tasks?.length,
    "Canonical Task inventory altered");
  const before=mainDoc?.tasks||[],existing=controlDoc?.tasks||[];
  const targets=before.filter(t=>t.task_id===taskId);
  deny(targets.length===1&&targets[0]?.status==="REVIEW",
    "Canonical Main must have exactly one REVIEW Task");
  deny(existing.filter(t=>t.task_id===taskId).length===1,
    "Control PR Task must exist exactly once");
  const byId=new Map(existing.map(t=>[t.task_id,t]));
  deny(new Set(existing.map(t=>t.task_id)).size===existing.length,
    "Duplicate Task IDs in control branch");
  deny(before.every(t=>byId.has(t.task_id)&&sameTaskExceptStatus(t,byId.get(t.task_id),t.task_id)),
    "Control branch changed Task content beyond status");
  deny(before.every(t=>t.task_id===taskId||t.status===byId.get(t.task_id)?.status),
    "Control branch changed another Task status");
  deny(["REVIEW","CLOSED"].includes(byId.get(taskId)?.status),
    "Control branch status outside permitted closure transition");
  if(errors.length)return {ok:false,decision:"HARD_STOP",errors,changed:false};
  const updated={...mainDoc,tasks:before.map(t=>t.task_id===taskId?{...t,status:"CLOSED"}:t)};
  const changed=JSON.stringify(updated)!==JSON.stringify(controlDoc);
  return {ok:true,decision:changed?"READY_FOR_PROTECTED_BRANCH_WRITE":"ALREADY_PROPOSED",
    errors:[],changed,task_id:taskId,sprint_id:plan.sprint_id,
    updated,closure_performed:false};
}
const githubContentJson=c=>JSON.parse(Buffer.from(
  (c?.content||"").replace(/\s/g,""),"base64").toString("utf8"));
const proofOfControlBase=(control,main)=>[
  control?.base?.sha===main,
  /^[a-f0-9]{40}$/.test(main||""),
  control?.head?.sha!==main
].every(Boolean);
const taskControlPath=plan=>"delivery/sprints/"+plan.sprint_id+"/tasks.json";
const taskForPlan=(id,sprint)=>taskFromDoc(
  readJson("delivery/sprints/"+sprint.active_sprint+"/tasks.json"),id);
const matchingLocalMain=(sha)=>execFileSync("git",["rev-parse","HEAD"],
  {encoding:"utf8"}).trim()===sha;
const verifyControlInventory=async (repo,number,path,token)=>{
  const files=await gh(repo+"/pulls/"+number+"/files?per_page=100",token);
  if(!exactControlFileInventory(files,path))
    throw Error("HARD_STOP: existing control PR must modify only canonical Task document");
};
const fetchTaskControls=async (repo,path,main,branch,token)=>{
  const [base,target]=await Promise.all([
    gh(repo+"/contents/"+path+"?ref="+main,token),
    gh(repo+"/contents/"+path+"?ref="+encodeURIComponent(branch),token)
  ]);
  return {base,target,mainDoc:githubContentJson(base),controlDoc:githubContentJson(target)};
};
const assertControlSource=(source,control,plan,main,checkoutSha)=>{
  if(!prControlIdentity(source,control,plan.task_id)||
    !proofOfControlBase(control,main)||checkoutSha!==main)
    throw Error("HARD_STOP: unauthorized control PR/base/ref/checkout");
};
export async function writeExistingProtectedClosureCandidate({
  sourcePrNumber,controlPrNumber,token,apply=false}={}){
  if(!validReconcileRequest({prNumber:sourcePrNumber,token})||
    !validReconcileRequest({prNumber:controlPrNumber,token}))
    throw Error("HARD_STOP: explicit valid source/control PR IDs required");
  const repo="/repos/"+ONLY_BUILD_REPO;
  const [source,control,mainBranch]=await Promise.all([
    gh(repo+"/pulls/"+sourcePrNumber,token),
    gh(repo+"/pulls/"+controlPrNumber,token),
    gh(repo+"/branches/main",token)
  ]);
  const main=mainBranch?.commit?.sha;
  if(!hex40(main)||!matchingLocalMain(main))
    throw Error("HARD_STOP: executor checkout must match live Main");
  // This includes original Task Human grant, a verified merge on Main,
  // canonical mapped Evidence, plus separate L3 block on Sprint3 T006/T008.
  const verified=await liveTaskClosureCheck({prNumber:sourcePrNumber,token});
  if(!verified.ok)return {...verified,write_action:"HARD_STOP",closure_performed:false};
  assertControlSource(source,control,verified,main,main);
  const path=taskControlPath(verified);
  await verifyControlInventory(repo,controlPrNumber,path,token);
  const {target,mainDoc,controlDoc}=await fetchTaskControls(repo,path,main,
    control.head.ref,token);
  const mutation=planProtectedClosureMutation({plan:verified,mainDoc,controlDoc,
    taskId:verified.task_id});
  if(!mutation.ok||!mutation.changed||!apply)
    return {...mutation,write_action:"NO_MUTATION",control_pr:controlPrNumber};
  // Optimistic concurrency: no changed PR HEAD or target blob since inspection.
  const [freshControl,freshMain]=await Promise.all([
    gh(repo+"/pulls/"+controlPrNumber,token),gh(repo+"/branches/main",token)]);
  if(freshControl?.head?.sha!==control.head.sha ||
    freshMain?.commit?.sha!==main)
    throw Error("HARD_STOP: control PR or Main moved before protected write");
  const written=await gh(repo+"/contents/"+path,token,{method:"PUT",body:{
    branch:control.head.ref,sha:target.sha,
    message:"Task "+verified.task_id+": propose evidence-verified protected closure (not Main)",
    content:Buffer.from(JSON.stringify(mutation.updated,null,2)+"\n").toString("base64")
  }});
  if(!hex40(written?.commit?.sha))
    throw Error("HARD_STOP: GitHub did not acknowledge control branch commit");
  return {ok:true,decision:"CONTROL_PR_UPDATED_NEEDS_FULL_CI_AND_PROTECTED_MERGE",
    write_action:"CONTROL_PR_BRANCH_ONLY",source_pr:sourcePrNumber,
    control_pr:controlPrNumber,head_sha:written.commit.sha,
    closure_performed:false,main_unmodified_by_this_call:true};
}

function cli(args){
  if(args[0]==="--closure-control"){
    const sourcePrNumber=Number(args[1]),controlPrNumber=Number(args[2]),
      token=process.env.GH_TOKEN||process.env.GITHUB_TOKEN;
    return writeExistingProtectedClosureCandidate({sourcePrNumber,controlPrNumber,
      token,apply:args.includes("--apply")}).then(x=>{
      console.log("CLOSURE CONTROL "+JSON.stringify(x));return x.ok?0:1;});
  }
  if(args[0]==="--closure-check"){
    const prNumber=Number(args[1]),token=process.env.GH_TOKEN||process.env.GITHUB_TOKEN;
    return liveTaskClosureCheck({prNumber,token})
      .then(out=>{console.log("CLOSURE PREFLIGHT "+JSON.stringify(out));
        return out.ok?0:1;});
  }
  if(args[0]==="--reconcile-pr"){
    const prNumber=Number(args[1]),token=process.env.GH_TOKEN||process.env.GITHUB_TOKEN;
    return reconcileTaskEvidencePr({prNumber,token,apply:args.includes("--apply")})
      .then(out=>{console.log("EVIDENCE RECONCILE "+JSON.stringify(out));
        return out.ok?0:1;});
  }
  const index=args.indexOf("--event"), outIndex=args.indexOf("--out");
  if(index<0 || outIndex<0 || !args[index+1] || !args[outIndex+1])
    throw Error("usage: evidence-ledger-report.mjs --event EVENT_JSON --out REPORT_JSON");
  const event=JSON.parse(fs.readFileSync(args[index+1],"utf8"));
  const sprint=JSON.parse(fs.readFileSync("delivery/CURRENT-SPRINT.json","utf8"));
  const ctx=reportContext(event,sprint);
  let report=ctx;
  if(ctx.status==="READY_TO_REPORT"){
    const child=spawnSync(process.execPath,["harness/scripts/evidence-ledger.mjs",
      "--sprint",ctx.sprint_id,"--task",ctx.task_id,"--json"],
      {encoding:"utf8",timeout:30000});
    report=child.status===0?{...ctx,...JSON.parse(child.stdout)}:
      {...ctx,status:"REPORT_ERROR",error:(child.stderr||"unknown").slice(0,500)};
  }
  fs.writeFileSync(args[outIndex+1],JSON.stringify(report,null,2)+"\n");
  console.log("EVIDENCE AUTO-REPORT: "+(report.evidence_readiness||report.status)+
    " (not a Task Closure or Product PASS)");
  return report.status==="REPORT_ERROR"?1:0;
}
if(import.meta.url===pathToFileURL(process.argv[1]||"").href)
  Promise.resolve(cli(process.argv.slice(2))).then(n=>{process.exitCode=n;})
    .catch(e=>{console.error("EVIDENCE RECONCILE HARD_STOP "+e.message);process.exitCode=1;});
