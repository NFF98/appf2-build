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
export function inspectGitHubHumanGrant({run,approvals,environment,grant,original,task,sprint,build,pr,ancestor,now}){
  const errors=[],deny=(p,s)=>{if(!p)errors.push(s);};
  const reviewers=(environment?.protection_rules||[]).filter(x=>x.type==="required_reviewers")
    .flatMap(x=>x.reviewers||[]);
  deny(environment?.name===ENVIRONMENT &&
    reviewers.some(x=>x.type==="User"&&x.reviewer?.login===HUMAN),
    "GitHub Environment 未設定 NFF98 為 Required reviewer");
  deny(run?.event==="workflow_dispatch"&&run?.conclusion==="success"&&
    run?.repository?.full_name==="NFF98/appf2-build" &&
    run?.path?.split("@")[0]?.endsWith("/"+WORKFLOW) && hex40(run?.head_sha),
    "非官方成功的 Human grant workflow");
  const review=Array.isArray(approvals)?approvals.filter(x=>
    x.environments?.some(e=>e.name===ENVIRONMENT)):[];
  deny(review.length>0 && review.at(-1)?.state==="approved" &&
    review.at(-1)?.user?.login===HUMAN,"GitHub 環境真實核准事件不存在或已撤回");
  deny(grant?.schema==="APPF2-TRUSTED-TASK-GRANT-1"&&
    taskIdOK(grant?.task_id)&&hex64(grant?.scope_sha256)&&hex40(grant?.base_sha),
    "Task 核准描述不合法");
  deny(original!==null && typeof original==="object"&&
    JSON.stringify(original)===JSON.stringify(grant),"核准後 Task 授權內容遭修改");
  deny(task?.task_id===grant?.task_id && task?.build_spec_id===grant?.build_spec_id &&
    sprint?.active_sprint===grant?.sprint_id &&
    sprint?.active_task===grant?.task_id &&
    sprint?.active_build_spec===grant?.build_spec_id &&
    build?.active_baseline===grant?.build_spec_id &&
    build?.implementation_enabled===true &&
    ["ACTIVE","REVIEW"].includes(sprint?.status)&&
    ["IN_PROGRESS","REVIEW"].includes(task?.status),
    "Task、Sprint、Build Spec 或執行權已改變");
  deny(task && grant?.scope_sha256===taskScopeDigest(task),"AC/Test/Allowed write scope 不一致");
  deny(pr?.state==="open"&&pr?.base?.ref==="main"&&
    /^Task:\s*T\d{3}\b/m.test(pr?.body||"")&&
    new RegExp("^Task:\\s*"+grant?.task_id+"\\b","m").test(pr?.body||""),
    "PR 不屬於該已授權 Task");
  deny(ancestor===true && hex40(pr?.head?.sha),
    "Human 批准 SHA 必須是現有 Task 分支祖先（可為同一 HEAD）且後續未修改授權");
  deny(Number.isSafeInteger(now)&&Number.isSafeInteger(grant?.approved_at_unix)&& Number.isSafeInteger(grant?.expires_at_unix) &&
    now>=grant?.approved_at_unix && now<=grant.expires_at_unix &&
    grant.expires_at_unix-grant.approved_at_unix<=30*86400,
    "Task 授權已過期或不合法");
  return {ok:errors.length===0,decision:errors.length===0?"VERIFIED_GITHUB_HUMAN_APPROVAL":"HARD_STOP",errors};
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
