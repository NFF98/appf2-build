// Only after GitHub Environment human approval. No repo write, no auto-merge.
// Github's live reviewer history is the authoritative signed-by-platform Human source.
import fs from "node:fs";
import {pathToFileURL} from "node:url";
import {ENVIRONMENT,WORKFLOW,HUMAN,taskScopeDigest,grantFromRun} from "./trusted-human-task-grant.mjs";
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
const requiredHumanReviewer=env=>{
  const r=(env?.protection_rules||[]).filter(x=>x.type==="required_reviewers")
    .flatMap(x=>x.reviewers||[]);
  return env?.name===ENVIRONMENT &&
    r.some(x=>x.type==="User"&&x.reviewer?.login===HUMAN);
};
const approvedHumanReview=approvals=>{
  const rows=Array.isArray(approvals)?approvals.filter(a=>
    a.environments?.some(e=>e.name===ENVIRONMENT)):[];
  return rows.length>0&&rows.at(-1)?.state==="approved"&&
    rows.at(-1)?.user?.login===HUMAN;
};
const exactIssuanceRun=(run,input)=>run?.event==="workflow_dispatch"&&
  run?.head_sha===input?.head_sha&&
  run?.path?.split("@")[0]?.endsWith("/"+WORKFLOW)&&
  run?.head_branch==="main" &&
  run?.repository?.full_name==="NFF98/appf2-build";
const inputMatchesGrant=(g,input)=>g?.schema==="APPF2-TRUSTED-TASK-GRANT-1"&&
  g?.task_id===input.task_id&&g?.sprint_id===input.sprint_id&&
  g?.scope_sha256===input.scope_sha256;
const canonicalTaskMatchesGrant=(g,task)=>g?.task_id===task?.task_id&&
  g?.build_spec_id===task?.build_spec_id&&g?.scope_sha256===taskScopeDigest(task);
const issuanceScopeMatch=(g,input,task)=>
  inputMatchesGrant(g,input)&&canonicalTaskMatchesGrant(g,task);
const noDifferentTaskInExecution=(s,g)=>
  (s?.active_task===null||s?.active_task===g?.task_id)&&
  (s?.active_sprint===null||s?.active_sprint===g?.sprint_id);
const leaseEligibleBeforeOrAfterActivation=(g,task,sprint,build)=>
  noDifferentTaskInExecution(sprint,g)&&
  ["PLANNED","IN_PROGRESS","REVIEW"].includes(task?.status)&&
  (build?.active_baseline===g?.build_spec_id ||
    task?.build_spec_id===g?.build_spec_id);
const issueTimeValid=(g,now)=>Number.isSafeInteger(g?.approved_at_unix)&&
  Number.isSafeInteger(g?.expires_at_unix)&&
  now>=g?.approved_at_unix&&now<=g?.expires_at_unix&&
  g.expires_at_unix-g.approved_at_unix<=30*86400;
export function inspectIssuance({run,approvals,environment,grant,task,sprint,build,input,now}){
  const errors=[],deny=(v,msg)=>{if(!v)errors.push(msg);};
  deny(requiredHumanReviewer(environment),"GitHub Required reviewer 未設定");
  deny(approvedHumanReview(approvals),"缺少 GitHub 真人核准");
  deny(exactIssuanceRun(run,input),"workflow/source commit 不一致");
  deny(issuanceScopeMatch(grant,input,task),"Human 所見 Task/Scope 與正式映射不一致");
  const canonical=grantFromRun(run,task);
  deny(canonical!==null&&JSON.stringify(grant)===JSON.stringify(canonical),
    "Workflow 真實 run-name / SHA / timestamp 與 Task 授權不一致");
  deny(leaseEligibleBeforeOrAfterActivation(grant,task,sprint,build),
    "已有另一 ACTIVE Task 或未合法規劃");
  deny(issueTimeValid(grant,now),"Human 授權逾期");
  return {ok:!errors.length,decision:errors.length?"HARD_STOP":"GITHUB_HUMAN_GRANT_ISSUED",errors};
}
async function cli(){
  const env=process.env,token=env.GH_TOKEN;
  if(!token||!env.GITHUB_RUN_ID||!env.HUMAN_TASK_ID||
    !env.HUMAN_SPRINT_ID||!env.HUMAN_SCOPE_SHA256)throw Error("missing Actions context");
  const sprint=read("delivery/CURRENT-SPRINT.json"),build=read("build-spec/CURRENT.json");
  const task=read("delivery/sprints/"+env.HUMAN_SPRINT_ID+"/tasks.json").tasks
    .find(x=>x.task_id===env.HUMAN_TASK_ID);
  const base="/repos/NFF98/appf2-build";
  const [run,approvals,environment]=await Promise.all([
    gh(base+"/actions/runs/"+env.GITHUB_RUN_ID,token),
    gh(base+"/actions/runs/"+env.GITHUB_RUN_ID+"/approvals",token),
    gh(base+"/environments/"+ENVIRONMENT,token)
  ]);
  const grant=grantFromRun(run,task);
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
