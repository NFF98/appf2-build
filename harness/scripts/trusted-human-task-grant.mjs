// GOV-REFORM-20261013 — verifiable one-time Human Task grant.
// This reader accepts ONLY live GitHub Actions API evidence of approval to a
// protected environment. A caller-provided "human_verified:true" is NEVER proof.
import fs from "node:fs";
import crypto from "node:crypto";
import {execFileSync} from "node:child_process";
import {pathToFileURL} from "node:url";

export const ENVIRONMENT="appf2-task-human-approval";
export const WORKFLOW=".github/workflows/task-human-grant.yml";
export const HUMAN="NFF98";
const hex40=x=>/^[a-f0-9]{40}$/.test(x||"");
const hex64=x=>/^[a-f0-9]{64}$/.test(x||"");
const taskIdOK=x=>/^T\d{3}$/.test(x||"");
export const taskScopeDigest=task=>crypto.createHash("sha256").update(JSON.stringify({
  task_id:task.task_id,build_spec_id:task.build_spec_id,
  allowed_write_paths:[...(task.allowed_write_paths||[])].sort(),
  acceptance_links:[...(task.acceptance_links||[])].map(x=>({
    acceptance_id:x.acceptance_id,test_id:x.test_id
  })).sort((a,b)=>(a.acceptance_id+"::"+a.test_id).localeCompare(b.acceptance_id+"::"+b.test_id))
})).digest("hex");

// Inputs are data from authenticated API calls performed by verifyLiveGrant(), NOT caller claims.
const requiredReviewerConfigured=env=>{
  const reviewers=(env?.protection_rules||[]).filter(x=>x.type==="required_reviewers")
    .flatMap(x=>x.reviewers||[]);
  return env?.name===ENVIRONMENT &&
    reviewers.some(x=>x.type==="User"&&x.reviewer?.login===HUMAN);
};
const authenticGrantWorkflow=run=>
  run?.event==="workflow_dispatch" &&
  run?.conclusion==="success" &&
  run?.repository?.full_name==="NFF98/appf2-build" &&
  run?.path?.split("@")[0]?.endsWith("/"+WORKFLOW) &&
  hex40(run?.head_sha);
const latestApprovedEnvironmentReview=reviews=>{
  const list=Array.isArray(reviews)?reviews.filter(x=>
    x.environments?.some(e=>e.name===ENVIRONMENT)):[];
  return list.length>0 && list.at(-1)?.state==="approved" &&
    list.at(-1)?.user?.login===HUMAN;
};
const grantFormatValid=g=>g?.schema==="APPF2-TRUSTED-TASK-GRANT-1" &&
  taskIdOK(g?.task_id)&&hex64(g?.scope_sha256)&&hex40(g?.base_sha);
const grantUnchanged=(original,g)=>original!==null&&typeof original==="object"&&
  JSON.stringify(original)===JSON.stringify(g);
const activeIdentityMatches=(task,sprint,grant)=>
  task?.task_id===grant?.task_id&&
  task?.build_spec_id===grant?.build_spec_id&&
  sprint?.active_sprint===grant?.sprint_id &&
  sprint?.active_task===grant?.task_id &&
  sprint?.active_build_spec===grant?.build_spec_id;
const activeExecutionMatches=(task,sprint,build,grant)=>
  activeIdentityMatches(task,sprint,grant)&&
  build?.active_baseline===grant?.build_spec_id &&
  build?.implementation_enabled===true &&
  ["ACTIVE","REVIEW"].includes(sprint?.status)&&
  ["IN_PROGRESS","REVIEW"].includes(task?.status);
const grantedPrMatches=(pr,g)=>pr?.state==="open"&&
  pr?.base?.ref==="main"&&
  /^Task:\s*T\d{3}\b/m.test(pr?.body||"")&&
  new RegExp("^Task:\\s*"+g?.task_id+"\\b","m").test(pr?.body||"");
const ttlValid=(g,now)=>Number.isSafeInteger(now)&&
  Number.isSafeInteger(g?.approved_at_unix)&&
  Number.isSafeInteger(g?.expires_at_unix)&&
  now>=g.approved_at_unix&&now<=g.expires_at_unix&&
  g.expires_at_unix-g.approved_at_unix<=30*86400;
export function inspectGitHubHumanGrant({run,approvals,environment,grant,original,task,sprint,build,pr,ancestor,now}){
  const errors=[],deny=(p,m)=>{if(!p)errors.push(m);};
  deny(requiredReviewerConfigured(environment),"Environment 缺少 NFF98 Required reviewer");
  deny(authenticGrantWorkflow(run),"非官方成功的 Task Human grant workflow");
  deny(latestApprovedEnvironmentReview(approvals),"GitHub 真實核准不存在或撤銷");
  deny(grantFormatValid(grant),"Task 核准描述不合法");
  deny(grantUnchanged(original,grant),"核准後 Task 授權內容遭修改");
  deny(activeExecutionMatches(task,sprint,build,grant),"Task/Sprint/Build 執行權變更");
  deny(task&&grant?.scope_sha256===taskScopeDigest(task),"AC/Test/Allowed path Scope 不一致");
  deny(grantedPrMatches(pr,grant),"PR 不屬於已授權 Task");
  deny(ancestor===true && hex40(pr?.head?.sha),"Human 批准 SHA 非當前 Task 分支祖先");
  deny(ttlValid(grant,now),"Task 授權逾期或時間不合法");
  return {ok:errors.length===0,decision:errors.length?"HARD_STOP":"VERIFIED_GITHUB_HUMAN_APPROVAL",errors};
}
const json=p=>JSON.parse(fs.readFileSync(p,"utf8"));
const gh=async (api,token)=>{
  const res=await fetch("https://api.github.com"+api,{headers:{
    accept:"application/vnd.github+json",
    authorization:"Bearer "+token,
    "X-GitHub-Api-Version":"2026-03-10",
    "User-Agent":"appf2-trusted-grant-verify"
  }});
  if(!res.ok)throw Error("GitHub evidence fetch failed (fail closed): "+res.status+" "+api);
  return res.json();
};
export async function verifyLiveGrant({pr,token,root="."}){
  const id=pr?.body?.match(/^Task-Grant-Run:\s*(\d{1,14})\s*$/m)?.[1];
  if(!id)throw Error("Task-Grant-Run 缺失；不得擅自當作 Human 核准");
  const taskId=pr.body.match(/^Task:\s*(T\d{3})\b/m)?.[1];
  if(!taskId)throw Error("PR Task 身份缺失");
  const path="delivery/task-grants/"+taskId+".json";
  const grant=json(path),sprint=json("delivery/CURRENT-SPRINT.json");
  const build=json("build-spec/CURRENT.json");
  const task=(json("delivery/sprints/"+sprint.active_sprint+"/tasks.json").tasks||[])
    .find(t=>t.task_id===taskId);
  const prefix="/repos/NFF98/appf2-build";
  const [run,approvals,environment]=await Promise.all([
    gh(prefix+"/actions/runs/"+id,token),
    gh(prefix+"/actions/runs/"+id+"/approvals",token),
    gh(prefix+"/environments/"+ENVIRONMENT,token)
  ]);
  let original=null,ancestor=false;
  if(hex40(run?.head_sha)){
    try{
      const src=execFileSync("git",["show",run.head_sha+":"+path],{encoding:"utf8",cwd:root});
      original=JSON.parse(src);
      execFileSync("git",["merge-base","--is-ancestor",run.head_sha,
        pr.head.sha],{cwd:root,stdio:"ignore"});
      ancestor=true;
    }catch { /* HARD STOP */ }
  }
  const report=inspectGitHubHumanGrant({run,approvals,environment,grant,original,
    task,sprint,build,pr,ancestor,now:Math.floor(Date.now()/1000)});
  if(!report.ok)throw Error("可信 Human Task 授權：HARD STOP\n"+
    report.errors.join("\n"));
  return {...report,run_id:Number(id),approver:HUMAN,task_id:taskId,
    source_head:run.head_sha,current_head:pr.head.sha};
}
async function cli(){
  const token=process.env.GH_TOKEN||process.env.GITHUB_TOKEN;
  if(!token||!process.env.GITHUB_EVENT_PATH)throw Error("GH_TOKEN 或 GitHub event 不存在");
  const event=json(process.env.GITHUB_EVENT_PATH);
  if(!event.pull_request)throw Error("只准在真實 PR 事件驗證");
  const out=await verifyLiveGrant({pr:event.pull_request,token});
  console.log("TRUSTED HUMAN TASK GRANT VERIFIED: "+JSON.stringify(out));
}
if(import.meta.url===pathToFileURL(process.argv[1]||"").href)
  cli().catch(e=>{console.error("TRUSTED GRANT: FAIL "+e.message);process.exitCode=1;});
