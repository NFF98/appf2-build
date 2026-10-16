// Only after GitHub Environment human approval. No repo write, no auto-merge.
// Github's live reviewer history is the authoritative signed-by-platform Human source.
import fs from "node:fs";
import {pathToFileURL} from "node:url";
import {ENVIRONMENT,WORKFLOW,HUMAN,taskScopeDigest} from "./trusted-human-task-grant.mjs";
const read=p=>JSON.parse(fs.readFileSync(p,"utf8"));
async function gh(path,token){
  const r=await fetch("https://api.github.com"+path,{headers:{
    Accept:"application/vnd.github+json",
    Authorization:"Bearer "+token,
    "X-GitHub-Api-Version":"2026-03-10",
    "User-Agent":"appf2-one-time-human-issuance"
  }});
  if(!r.ok)throw Error("GitHub genuine review verification unavailable: "+r.status);
  return r.json();
}
export function inspectIssuance({run,approvals,environment,grant,task,sprint,build,input,now}){
  const errors=[],assert=(x,msg)=>{if(!x)errors.push(msg);};
  const reviewers=(environment?.protection_rules||[]).filter(r=>r.type==="required_reviewers")
    .flatMap(r=>r.reviewers||[]);
  assert(environment?.name===ENVIRONMENT &&
    reviewers.some(r=>r.type==="User"&&r.reviewer?.login===HUMAN),
    "未設定 GitHub Required reviewer：不得發出 Human 授權");
  const reviews=Array.isArray(approvals)?approvals.filter(a=>
    a.environments?.some(e=>e.name===ENVIRONMENT)):[];
  assert(reviews.length>0&&reviews.at(-1)?.state==="approved"&&
    reviews.at(-1)?.user?.login===HUMAN,"缺少 GitHub 真人批准");
  assert(run?.event==="workflow_dispatch"&&run?.head_sha===input.head_sha&&
    run?.path?.split("@")[0]?.endsWith("/"+WORKFLOW)&&
    run?.repository?.full_name==="NFF98/appf2-build",
    "不是指定的 workflow/source commit");
  assert(grant?.schema==="APPF2-TRUSTED-TASK-GRANT-1"&&
    grant?.task_id===input.task_id&&grant?.sprint_id===input.sprint_id&&
    grant?.scope_sha256===input.scope_sha256,
    "所見授權內容不等於 Human 審核的 Task/scope");
  assert(grant?.task_id===task?.task_id&&grant?.build_spec_id===task?.build_spec_id&&
    grant?.scope_sha256===taskScopeDigest(task),
    "Task 正式 scope/映射已改變");
  // The Human grant MUST precede Task Activation. Do not demand an earlier
  // Human Activation (which would silently create two separate approvals).
  const noOtherActiveTask=(sprint?.active_task===null ||
    sprint?.active_task===grant?.task_id) &&
    (sprint?.active_sprint===null || sprint?.active_sprint===grant?.sprint_id);
  assert(noOtherActiveTask&&
    ["PLANNED","IN_PROGRESS","REVIEW"].includes(task?.status)&&
    (build?.active_baseline===grant?.build_spec_id ||
      task?.build_spec_id===grant?.build_spec_id),
    "已有其他 ACTIVE Task/Sprint、或候選 Task/Build Spec 無效，禁止預先授權");
  assert(Number.isSafeInteger(grant?.approved_at_unix)&&
    Number.isSafeInteger(grant?.expires_at_unix)&&
    now>=grant?.approved_at_unix&&now<=grant?.expires_at_unix&&
    grant?.expires_at_unix-grant?.approved_at_unix<=30*86400,
    "核准有效期有誤");
  return {ok:!errors.length,decision:errors.length?"HARD_STOP":"GITHUB_HUMAN_GRANT_ISSUED",
    errors};
}
async function cli(){
  const env=process.env,token=env.GH_TOKEN;
  if(!token||!env.GITHUB_RUN_ID||!env.HUMAN_TASK_ID||
    !env.HUMAN_SPRINT_ID||!env.HUMAN_SCOPE_SHA256)throw Error("missing Actions context");
  const grant=read("delivery/task-grants/"+env.HUMAN_TASK_ID+".json");
  const sprint=read("delivery/CURRENT-SPRINT.json"),build=read("build-spec/CURRENT.json");
  const task=read("delivery/sprints/"+grant.sprint_id+"/tasks.json").tasks
    .find(x=>x.task_id===env.HUMAN_TASK_ID);
  const base="/repos/NFF98/appf2-build";
  const [run,approvals,environment]=await Promise.all([
    gh(base+"/actions/runs/"+env.GITHUB_RUN_ID,token),
    gh(base+"/actions/runs/"+env.GITHUB_RUN_ID+"/approvals",token),
    gh(base+"/environments/"+ENVIRONMENT,token)
  ]);
  const result=inspectIssuance({run,approvals,environment,grant,task,sprint,build,
    input:{task_id:env.HUMAN_TASK_ID,sprint_id:env.HUMAN_SPRINT_ID,
      scope_sha256:env.HUMAN_SCOPE_SHA256,head_sha:env.GITHUB_SHA},
    now:Math.floor(Date.now()/1000)});
  if(!result.ok)throw Error(result.errors.join("; "));
  console.log("GitHub Environment 真人一次授權：VERIFIED "+JSON.stringify({
    task_id:grant.task_id,source_run:Number(env.GITHUB_RUN_ID),source_sha:env.GITHUB_SHA
  }));
}
if(import.meta.url===pathToFileURL(process.argv[1]||"").href)
  cli().catch(e=>{console.error("HUMAN GRANT ISSUANCE: HARD STOP "+e.message);process.exitCode=1;});
