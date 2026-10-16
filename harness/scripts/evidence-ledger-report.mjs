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
const reviewReference=(errors,id,docs,task,sprintId,pairs)=>{
  const e=docs.get(id),deny=(ok,msg)=>normalizeError(errors,ok,msg+": "+id);
  deny(referenceNameOK(e,id),"Missing exact canonical Evidence");
  deny(validDocumentState(e),"Evidence invalid schema/status/source SHA");
  deny(documentScopeOK(e,task,sprintId),"Evidence scope differs");
  deny(matchingPairs(e,pairs),"Evidence AC/Test linkage differs");
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
    reviewReference(errors,id,docs,task,sprintId,pairs);
  if(errors.length)return {ok:false,status:"HARD_STOP",errors,add:[],changed:false};
  const add=proposed.filter(id=>!prior.includes(id));
  return {ok:true,status:add.length?"READY_TO_APPEND_REFERENCES":"ALREADY_NORMALIZED",
    errors:[],add,changed:add.length>0,completion_evidence:[...prior,...add]};
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
export async function reconcileTaskEvidencePr({prNumber,token,apply=false}={}){
  if(!validReconcileRequest({prNumber,token}))
    throw Error("HARD_STOP: missing PR number or GitHub token");
  const repo="/repos/NFF98/appf2-build";
  const pr=await gh(repo+"/pulls/"+prNumber,token);
  const head=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
  if(!samePrBranch(pr,head))throw Error("HARD_STOP: stale, fork, merged or Main PR");
  const sprint=readJson("delivery/CURRENT-SPRINT.json"),
    build=readJson("build-spec/CURRENT.json");
  const taskId=pr.body?.match(/^Task:\s*(T\d{3})\b/m)?.[1];
  const path="delivery/sprints/"+sprint.active_sprint+"/tasks.json";
  const doc=readJson(path),task=doc.tasks?.find(t=>t.task_id===taskId);
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
  const actual=Buffer.from((content.content||"").replace(/\s/g,""),"base64");
  if(actual.toString("utf8")!==fs.readFileSync(path,"utf8"))
    throw Error("HARD_STOP: local Task bytes differ from live GitHub HEAD");
  const fresh=await gh(repo+"/pulls/"+prNumber,token);
  if(!samePrBranch(fresh,head))throw Error("HARD_STOP: PR HEAD moved during normalization");
  const updated={...doc,tasks:doc.tasks.map(t=>t.task_id===taskId
    ?{...t,completion_evidence:plan.completion_evidence}:t)};
  const response=await gh(repo+"/contents/"+path,token,{method:"PUT",body:{
    branch:pr.head.ref,sha:content.sha,
    message:"Task "+taskId+": normalize existing canonical Evidence references (no status change)",
    content:Buffer.from(JSON.stringify(updated,null,2)+"\n").toString("base64")}});
  if(!hex40(response?.commit?.sha))
    throw Error("HARD_STOP: canonical PR evidence update commit was not verified");
  return {...plan,action:"COMMITTED_TO_SAME_TASK_PR_NOT_MAIN",pr_number:prNumber,
    previous_head:head,new_head:response.commit.sha,
    note:"New HEAD invalidates earlier CI/BCE; revalidate before Merge. No closure."};
}

function cli(args){
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
