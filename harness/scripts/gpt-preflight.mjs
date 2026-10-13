// GOV-REFORM-20261013: mandatory GPT/automation preflight and PR-proliferation guard.
// Reads canonical repository state first; refuses redundant PRs, Activations,
// re-approvals and Rebinds. It never grants authority: "allowed" only means
// "not redundant"; the Human decision boundary is unchanged.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { GOVERNANCE_REFORM_POLICY_PATH } from "./human-exception.mjs";

export function taskKeyOfPr(pr,guard){
  const declared=new RegExp(guard.task_declaration_pattern,"m").exec(pr.body||"");
  if(declared) return declared[1];
  return new RegExp(guard.title_task_pattern).exec(pr.title||"")?.[1]||null;
}
export const hasPrJustification=(pr,guard)=>new RegExp(guard.justification_pattern,"m").test(pr.body||"");

export function prCreationDecision({taskKey,openPrs,guard,selfNumber=null,justified=false}){
  if(!taskKey) return {decision:"NO_TASK_DECLARED",existing:[]};
  const existing=(openPrs||[]).filter(p=>p.number!==selfNumber && taskKeyOfPr(p,guard)===taskKey).map(p=>p.number).sort((a,b)=>a-b);
  if(!existing.length) return {decision:"NEW_PR_ALLOWED",existing};
  return {decision:justified?"NEW_PR_ALLOWED_WITH_JUSTIFICATION":"REUSE_EXISTING_PR",existing};
}

const intentDecision=({intent,build,sprint,task,taskId})=>{
  const isActive=sprint.active_task===taskId && ["ACTIVE","REVIEW"].includes(sprint.status);
  switch(intent){
    case "CONTINUE_TASK_WORK":
      return isActive && build.implementation_enabled?{decision:"CONTINUE_SAME_LEASE",reason:"same active Task; no new approval needed"}:
        {decision:"STOP",reason:"Task "+taskId+" is not the ACTIVE/REVIEW Task (status "+sprint.status+", active "+sprint.active_task+")"};
    case "REQUEST_ACTIVATION":
      return isActive?{decision:"REDUNDANT_ACTIVATION_DENIED",reason:"Task already holds execution authority"}:{decision:"ACTIVATION_MAY_BE_REQUESTED",reason:"Human Activation decision required"};
    case "REQUEST_APPROVAL":
      return isActive?{decision:"REDUNDANT_APPROVAL_DENIED",reason:"same Task + same scope continues without a new grant"}:{decision:"APPROVAL_MAY_BE_REQUESTED",reason:"no active authority for this Task"};
    case "REQUEST_REBIND":
      return task && task.build_spec_id===build.active_baseline?{decision:"REBIND_NOT_REQUIRED",reason:"Task already bound to active baseline; code fixes never need Rebind"}:{decision:"REBIND_MAY_BE_REQUIRED",reason:"baseline/mapping differs; Human governance decides"};
    default:
      return {decision:"STOP",reason:"unknown intent "+intent};
  }
};
const DENIED=new Set(["STOP","REDUNDANT_ACTIVATION_DENIED","REDUNDANT_APPROVAL_DENIED","REBIND_NOT_REQUIRED","REUSE_EXISTING_PR"]);

/** Pure preflight over canonical state; returns auditable facts plus one decision. */
export function preflight({build,sprint,tasks,openPrs,guard,intent,taskId}){
  const task=(tasks||[]).find(t=>t.task_id===taskId)||null;
  const facts={
    active_baseline:build.active_baseline,implementation_enabled:build.implementation_enabled,
    active_sprint:sprint.active_sprint,sprint_status:sprint.status,active_task:sprint.active_task,
    task_status:task?.status||null,task_build_spec:task?.build_spec_id||null,
    open_prs_for_task:prCreationDecision({taskKey:taskId,openPrs,guard}).existing
  };
  const result=intent==="NEW_PR"?prCreationDecision({taskKey:taskId,openPrs,guard}):intentDecision({intent,build,sprint,task,taskId});
  return {facts,intent,task_id:taskId,...result,denied:DENIED.has(result.decision)};
}

const readJson=file=>JSON.parse(fs.readFileSync(file,"utf8"));

function prGuardCli({arg,guard,openPrs}){
  const pr=readJson(arg("event")).pull_request;
  if(!pr){console.log("PR GUARD: N/A (not a pull_request event)");return 0;}
  if(!openPrs){console.error("PR GUARD: FAIL — open PR inventory unavailable (fail closed)");return 1;}
  const limit=Number(arg("inventory-limit")||0);
  if(limit && openPrs.length>=limit){console.error("PR GUARD: FAIL — open PR inventory may be truncated at "+limit+" (fail closed)");return 1;}
  const out=prCreationDecision({taskKey:taskKeyOfPr(pr,guard),openPrs,guard,selfNumber:pr.number,justified:hasPrJustification(pr,guard)});
  console.log("PR GUARD: "+out.decision+(out.existing.length?" (existing open PR(s) for same Task: #"+out.existing.join(", #")+")":""));
  if(out.decision!=="REUSE_EXISTING_PR") return 0;
  console.error("PR GUARD: FAIL — reuse the existing Task PR or add a recorded 'PR-Justification: <REASON> <detail>' line.");
  return 1;
}
function stateCli({arg,guard,openPrs}){
  if(!openPrs) console.error("PREFLIGHT WARNING: no --open-prs inventory; PR reuse cannot be proven (treat as NOT_READY for NEW_PR).");
  const sprint=readJson("delivery/CURRENT-SPRINT.json");
  const tasks=sprint.active_sprint?readJson("delivery/sprints/"+sprint.active_sprint+"/tasks.json").tasks:[];
  const out=preflight({build:readJson("build-spec/CURRENT.json"),sprint,tasks,openPrs:openPrs||[],guard,intent:arg("intent")||"CONTINUE_TASK_WORK",taskId:arg("task")||sprint.active_task});
  console.log(JSON.stringify(out,null,2));
  return out.denied || (!openPrs && out.intent==="NEW_PR")?3:0;
}
function cli(argv){
  const arg=name=>{const i=argv.indexOf("--"+name);return i>=0?argv[i+1]:null;};
  const ctx={arg,guard:readJson(GOVERNANCE_REFORM_POLICY_PATH).pr_guard,openPrs:arg("open-prs")?readJson(arg("open-prs")):null};
  if(argv[0]==="pr-guard") return prGuardCli(ctx);
  if(argv[0]==="state") return stateCli(ctx);
  console.error("usage: gpt-preflight.mjs state --task Txxx --intent NEW_PR|CONTINUE_TASK_WORK|REQUEST_ACTIVATION|REQUEST_APPROVAL|REQUEST_REBIND [--open-prs file]\n       gpt-preflight.mjs pr-guard --event $GITHUB_EVENT_PATH --open-prs file");
  return 2;
}
if(import.meta.url===pathToFileURL(process.argv[1]||"").href) process.exit(cli(process.argv.slice(2)));
