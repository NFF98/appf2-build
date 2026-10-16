// Real GitHub API unauthorized negative integration; NOT a positive Human E2E.
// Uses read-only Actions token. All five delegated paths MUST reject PR #401.
import {execFileSync} from "node:child_process";
import {pathToFileURL} from "node:url";
import {delegatedTaskExecutor} from "./task-pr-lifecycle.mjs";
import {verifyLiveGrant} from "./trusted-human-task-grant.mjs";
import {reconcileTaskEvidencePr,liveTaskClosureCheck,
  writeExistingProtectedClosureCandidate} from "./evidence-ledger-report.mjs";

const REPO="NFF98/appf2-build";
const PR=Number(process.env.APPF2_NEGATIVE_PR_NUMBER);
const TOKEN=process.env.GH_TOKEN;
const hex40=s=>/^[a-f0-9]{40}$/.test(s||"");
const localHead=()=>execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
const gh=async endpoint=>{
  const response=await fetch("https://api.github.com/repos/"+REPO+endpoint,{headers:{
    accept:"application/vnd.github+json",
    authorization:"Bearer "+TOKEN,
    "X-GitHub-Api-Version":"2026-03-10",
    "User-Agent":"appf2-real-negative-github-e2e"
  }});
  if(!response.ok)throw Error("LIVE GITHUB FETCH FAILURE "+response.status+" "+endpoint);
  return response.json();
};
const snapshot=async()=>{
  const [pr,main,branch]=await Promise.all([
    gh("/pulls/"+PR),gh("/branches/main"),
    gh("/branches/governance/task-one-approval-20261016")
  ]);
  return {pr,main:main?.commit?.sha,branch:branch?.commit?.sha};
};
const safeNegativePrecondition=(s,head)=>[
  s.pr?.number===PR,s.pr?.state==="open",s.pr?.draft===true,
  s.pr?.head?.sha===head,s.branch===head,
  s.pr?.base?.ref==="main",s.pr?.base?.sha===s.main,
  s.pr?.head?.repo?.full_name===REPO,
  s.main!==head,hex40(s.main),hex40(head),
  !/^Task-Grant-Run:/m.test(s.pr?.body||"")
].every(Boolean);
const mustDeny=async (label,invoke,message)=>{
  let received="";
  try{await invoke();}catch(e){received=String(e?.message||e);}
  if(!message.test(received))
    throw Error("LIVE NEGATIVE FAIL ["+label+"]: unexpected admission/error: "+
      (received||"ADMITTED"));
  console.log("LIVE NEGATIVE EXPECTED HARD_STOP: "+label);
};
export async function verifyLiveUnauthorizedNegative(){
  if(!TOKEN||!Number.isSafeInteger(PR)||PR!==401)
    throw Error("LIVE NEGATIVE STOP: require exact Draft PR 401 and token");
  const head=localHead(),before=await snapshot();
  if(!safeNegativePrecondition(before,head))
    throw Error("LIVE NEGATIVE STOP: GitHub main/draft HEAD or scope drift");
  await mustDeny("original Human grant absent",
    ()=>verifyLiveGrant({pr:before.pr,token:TOKEN}),
    /Task-Grant-Run 缺失/);
  await mustDeny("delegated CHECK must reject missing grant",
    ()=>delegatedTaskExecutor({prNumber:PR,token:TOKEN,action:"CHECK"}),
    /Task-Grant-Run 缺失/);
  await mustDeny("Evidence apply must reject wrong Task lease",
    ()=>reconcileTaskEvidencePr({prNumber:PR,token:TOKEN,apply:true}),
    /active Task lease missing or wrong scope/);
  await mustDeny("Closure check must reject missing grant",
    ()=>liveTaskClosureCheck({prNumber:PR,token:TOKEN}),
    /Task-Grant-Run 缺失/);
  await mustDeny("Closure apply must reject non-Main checkout",
    ()=>writeExistingProtectedClosureCandidate({
      sourcePrNumber:PR,controlPrNumber:PR,token:TOKEN,apply:true}),
    /executor checkout must match live Main/);
  const after=await snapshot();
  if(after.main!==before.main||after.branch!==before.branch||
    after.pr?.head?.sha!==before.pr.head.sha||after.pr?.state!==before.pr.state)
    throw Error("LIVE NEGATIVE FAIL: protected main/PR drift after test");
  console.log("LIVE GITHUB NEGATIVE INTEGRATION: 5/5 REAL API HARD_STOP PASS; "+
    "Main/PR unchanged. Human positive approval/Merge/Closure NOT_RUN.");
}
if(import.meta.url===pathToFileURL(process.argv[1]||"").href)
  verifyLiveUnauthorizedNegative().catch(e=>{
    console.error("LIVE NEGATIVE INTEGRATION FAILED: "+e.message);
    process.exitCode=1;
  });
