// 16P protected prewrite entry point. Only explicit, verified operations may write.
// A local check is not human approval; direct GitHub UI/other clients cannot be gated here.
import fs from "node:fs";
import {execFileSync} from "node:child_process";
import {pathToFileURL} from "node:url";
import {preflight,prCreationDecision} from "./gpt-preflight.mjs";
import {reconcileTaskEvidencePr,liveTaskClosureCheck} from "./evidence-ledger-report.mjs";
import {delegatedTaskExecutor,taskIdentityOfPr} from "./task-pr-lifecycle.mjs";
import {GOVERNANCE_REFORM_POLICY_PATH} from "./human-exception.mjs";
import {loadMainSixteenPLeaseAuthority} from "./16p-acceptance-lease.mjs";

const read=p=>JSON.parse(fs.readFileSync(p,"utf8"));
const taskOfPr=p=>taskIdentityOfPr(p).task_id;
const fail=(decision,reason,extra={})=>({ok:false,decision,reason,write_performed:false,...extra});
const repoName=()=>process.env.GITHUB_REPOSITORY||"NFF98/appf2-build";
const auth=()=>process.env.GH_TOKEN||process.env.GITHUB_TOKEN;
function api(path){
 if(!auth())throw Error("HARD_STOP: GH_TOKEN required");
 return JSON.parse(execFileSync("gh",["api","repos/"+repoName()+"/"+path],
  {encoding:"utf8",timeout:20000,maxBuffer:15000000,env:process.env}));
}
function inventory(){
 if(!auth())throw Error("HARD_STOP: GH_TOKEN required");
 const rows=JSON.parse(execFileSync("gh",["pr","list","--repo",repoName(),
  "--state","open","--limit","200","--json","number,title,body,isDraft"],{
  encoding:"utf8",timeout:20000,maxBuffer:12000000,env:process.env}));
 if(!Array.isArray(rows)||rows.length>=200)throw Error("HARD_STOP: live open PR inventory missing/truncated");
 return rows;
}
// GitHub's open-PR inventory is insufficient for a "one Task -> one PR" rule:
// after a merge the Task may remain REVIEW while its primary PR is closed.
// Read every historical PR (max 1000) before considering another write.
function taskPrHistory(){
 if(!auth())throw Error("HARD_STOP: GH_TOKEN required for closed/merged PR inventory");
 const rows=JSON.parse(execFileSync("gh",["pr","list","--repo",repoName(),
  "--state","all","--limit","1000","--json","number,title,body,state,mergedAt"],{
   encoding:"utf8",timeout:60000,maxBuffer:20000000,env:process.env}));
 if(!Array.isArray(rows)||rows.length>=1000||
   rows.some(x=>!Number.isSafeInteger(x.number)||x.number<=0||
    typeof x.title!=="string"||typeof x.body!=="string"))
  throw Error("HARD_STOP: incomplete/malformed Task PR historical inventory");
 return rows;
}

function canonical(){
 const sprint=read("delivery/CURRENT-SPRINT.json"),build=read("build-spec/CURRENT.json");
 const tasks=sprint.active_sprint?read("delivery/sprints/"+sprint.active_sprint+"/tasks.json").tasks:[];
 // Main-approved lease authority only — never local working-tree CURRENT.json.
 return {sprint,build,tasks,policy:read(GOVERNANCE_REFORM_POLICY_PATH).pr_guard,
  sixteenPAuthority:loadMainSixteenPLeaseAuthority({})};
}
// Query historical primary PRs before the lease preflight even after HOLD.
const historicalPrimaryPrs=(taskId,allPrs)=>Array.isArray(allPrs)?
 allPrs.filter(row=>taskIdentityOfPr(row).task_id===taskId)
  .map(row=>({number:row.number,state:row.state,merged:!!row.mergedAt}))
  .sort((a,b)=>a.number-b.number):[];
export function classifyPrecreate({taskId,openPrs,build,sprint,tasks,guard,governanceCase=null,allPrs=null,sixteenPAuthority=null}){
 if(!Array.isArray(openPrs))return fail("BLOCK_NO_INVENTORY","Live inventory required");
 if(openPrs.length>=200)return fail("BLOCK_TRUNCATED","Live PR inventory truncated");
 if(governanceCase){
  const outcome=prCreationDecision({taskKey:null,governanceCase,openPrs,guard});
  if(outcome.decision!=="NEW_PR_ALLOWED_PENDING_HUMAN_AUTHORITY")
   return fail("BLOCK_REUSE_PR","Governance case already exists / not uniquely authorized",{existing:outcome.existing});
  return fail("BLOCK_HUMAN_CREATE_AUTHORITY","Human pre-create approval must be verified independently");
 }
 if(!/^T\d{3}$/.test(taskId||""))return fail("BLOCK_TASK_ID","Task ID missing");
 // Existing merged Task PR must remain blocked after a proposed Sprint HOLD.
 const previous=historicalPrimaryPrs(taskId,allPrs);
 if(previous.length)return fail("BLOCK_REUSE_EXISTING_TASK_PR",
  "Historical Task primary PR exists; do not create a duplicate",
  {task_id:taskId,existing:previous});
 const out=preflight({build,sprint,tasks,openPrs,guard,intent:"NEW_PR",taskId,sixteenPAuthority});
 if(out.denied||out.decision!=="NEW_PR_ALLOWED_PENDING_HUMAN_AUTHORITY")
  return fail("BLOCK_NEW_PR",out.reason||out.decision,{preflight:out});
 if(!Array.isArray(allPrs))
  return fail("BLOCK_HISTORY_MISSING","Cannot prove no previously merged Task PRs",{preflight:out});
 // Do not turn 'new PR may be requested' into Human's explicit PR-create approval.
 return fail("BLOCK_HUMAN_CREATE_AUTHORITY","Task lease does not grant new PR creation on its own",{preflight:out});
}
function realPrecreate(taskId,governanceCase){
 const openPrs=inventory(),ctx=canonical();
 // Fetch history only after the Task is plausibly active; invalid Task IDs
 // already fail closed in the pure preflight and do not consume API quota.
 const allPrs=/^T\d{3}$/.test(taskId||"")?taskPrHistory():null;
 return classifyPrecreate({taskId,governanceCase,openPrs,allPrs,...ctx,guard:ctx.policy});
}
async function realEvidence(prNumber,apply){
 const source=api("pulls/"+prNumber);
 const task=taskOfPr(source);
 if(source.state!=="open"||source.base?.ref!=="main"||source.head?.repo?.full_name!==repoName()||
    !task||!/^T\d{3}$/.test(task))
  return fail("BLOCK_NOT_REAL_TASK_PR","Governance PR or wrong branch is not a Task Evidence mutation target",
   {pr_number:prNumber,source_head:source.head?.sha||null});
 // The canonical writer independently re-verifies live Human Grant, active lease,
 // provenance, Evidence documents, optimistic concurrency and exact GitHub HEAD.
 const output=await reconcileTaskEvidencePr({prNumber,token:auth(),apply});
 return {...output,ok:output.ok===true,write_performed:output.action==="COMMITTED_TO_SAME_TASK_PR_NOT_MAIN"};
}
async function realMerge(prNumber,apply){
 const pr=api("pulls/"+prNumber);
 if(pr.state!=="open"||!taskOfPr(pr))
  return fail("BLOCK_NOT_REAL_TASK_PR","Cannot delegate Merge of a governance or unbound PR");
 const result=await delegatedTaskExecutor({prNumber,token:auth(),action:apply?"MERGE":"CHECK"});
 return {...result,write_performed:result.merged===true};
}
const wasMerged=p=>[
 p?.state==="closed",p?.merged===true,
 /^[a-f0-9]{40}$/.test(p?.merge_commit_sha||"")
].every(Boolean);
const historicalMergeChain=(source,proof)=>[
 wasMerged(source),wasMerged(proof),
 proof?.base?.sha===source?.merge_commit_sha,
 source?.base?.ref==="main",proof?.base?.ref==="main",
 source?.head?.repo?.full_name===repoName(),
 proof?.head?.repo?.full_name===repoName()
].every(Boolean);
const taskHistoryOutcome=({sequence,evidenceLinked,same,closed,count})=>({
 full:[sequence,evidenceLinked,same,closed,count>0].every(Boolean),
 status:[sequence,evidenceLinked].every(Boolean)?
   "PARTIAL_TWO_PR_HISTORY_AND_CLOSURE_PENDING":"NOT_VERIFIED"
});
// Live, read-only historical Task transition audit; no simulated Merge/Closure.
function auditTaskHistory(sourceNumber,evidenceNumber){
 if(!Number.isSafeInteger(sourceNumber)||sourceNumber<=0||
    !Number.isSafeInteger(evidenceNumber)||evidenceNumber<=0)
  return fail("BLOCK_PR_NUMBER","Both real PR numbers required");
 const source=api("pulls/"+sourceNumber),proof=api("pulls/"+evidenceNumber);
 const identity=taskIdentityOfPr(source);
 if(!identity.ok)return fail("BLOCK_NOT_REAL_TASK_PR","Primary PR identity mismatch",{identity});
 const taskId=identity.task_id;
 // Real immutable Main task history survives proposed CURRENT-SPRINT HOLD.
 const remote=api("contents/delivery/sprints/SP-P1-003/tasks.json?ref=main");
 const taskDoc=JSON.parse(Buffer.from(String(remote?.content||"").replace(/\s/g,""),"base64").toString("utf8"));
 const task=taskDoc.tasks?.find(t=>t.task_id===taskId);
 const src=wasMerged(source),ev=wasMerged(proof);
 const sequence=historicalMergeChain(source,proof);
 const n=Array.isArray(task?.completion_evidence)?task.completion_evidence.length:0;
 const evidenceLinked=String(proof.body||"").includes(taskId);
 const same=sourceNumber===evidenceNumber,closed=task?.status==="CLOSED";
 const outcome=taskHistoryOutcome({sequence,evidenceLinked,same,closed,count:n});
 return {ok:true,decision:"REAL_GITHUB_TASK_HISTORY_OBSERVED",task_id:taskId,
  source_pr:sourceNumber,evidence_pr:evidenceNumber,
  source_merged:src,evidence_merged:ev,
  verified_pr_merge_sequence:sequence,linked_evidence_body:evidenceLinked,
  canonical_task_status:task?.status||"MISSING",
  canonical_evidence_count:n,same_primary_pr:same,task_closed:closed,
  complete_one_pr_e2e_verified:outcome.full,
  status:outcome.status,
  write_performed:false};
}

async function realClosure(prNumber){
 const r=await liveTaskClosureCheck({prNumber,token:auth()});
 return {...r,write_performed:false};
}
export async function runOperation({operation,taskId,governanceCase,prNumber,evidencePrNumber,apply=false}={}){
 if(operation==="TASK_HISTORY_AUDIT")return auditTaskHistory(prNumber,evidencePrNumber);
 if(operation==="PR_CREATE"){
  if(apply)return fail("BLOCK_PR_CREATE_APPLY","No verified protected create authority; no PR is created");
  return realPrecreate(taskId,governanceCase);
 }
 if(!Number.isSafeInteger(prNumber)||prNumber<=0)
  return fail("BLOCK_PR_NUMBER","A real existing PR number is required");
 if(operation==="EVIDENCE_NORMALIZE")return realEvidence(prNumber,apply);
 if(operation==="TASK_MERGE")return realMerge(prNumber,apply);
 if(operation==="TASK_CLOSURE"){
  if(apply)return fail("BLOCK_CLOSURE_APPLY","Separate authenticated Human Closure authorization required");
  return realClosure(prNumber);
 }
 return fail("BLOCK_UNKNOWN_OPERATION","Unknown protected operation");
}
const a=(args,k)=>{const i=args.indexOf("--"+k);return i<0?null:args[i+1]};
async function main(args){
 const operation=a(args,"operation"),apply=args.includes("--apply");
 const out=a(args,"out");
 let result;
 try{
  result=await runOperation({operation,taskId:a(args,"task"),
   governanceCase:a(args,"governance-case"),
   prNumber:Number(a(args,"pr")),evidencePrNumber:Number(a(args,"evidence-pr")),apply});
 }catch(e){result=fail("HARD_STOP",String(e.message||e));}
 const report={schema:"APPF2-GUARDED-GITHUB-WRITE-1",operation,apply,repo:repoName(),
  ...result};
 // Fail closed on every rejected operation; no real GitHub mutation is attempted.
 if(out)fs.writeFileSync(out,JSON.stringify(report,null,2)+"\n");
 console.log("GITHUB PROTECTED WRITE PREFLIGHT "+JSON.stringify(report));
 if(!report.ok)process.exitCode=3;
}
if(import.meta.url===pathToFileURL(process.argv[1]||"").href)
 main(process.argv.slice(2)).catch(e=>{console.error("HARD_STOP "+e.message);process.exitCode=3;});
