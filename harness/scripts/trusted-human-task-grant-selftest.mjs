// Tests data-path integrity only. Not a real GitHub approval nor a merged PR.
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
import {inspectGitHubHumanGrant,taskScopeDigest,ENVIRONMENT,WORKFLOW}
  from "./trusted-human-task-grant.mjs";
import {inspectIssuance} from "./task-human-grant-issuance.mjs";
import {inspectLiveGitHubRequiredChecks} from "./final-ready-preflight.mjs";
const sha="a".repeat(40),base="b".repeat(40),NOW=1792000000;
const fresh=()=>{
  const task={task_id:"T009",status:"IN_PROGRESS",build_spec_id:"BS-P1-025",
    allowed_write_paths:["src/","tests/"],acceptance_links:[{acceptance_id:"A1",test_id:"T1"}]};
  const grant={schema:"APPF2-TRUSTED-TASK-GRANT-1",task_id:"T009",
    sprint_id:"SP-P1-003",build_spec_id:"BS-P1-025",
    base_sha:sha,scope_sha256:taskScopeDigest(task),
    approved_at_unix:NOW-3600,expires_at_unix:NOW-3600+30*86400};
  const sprint={active_sprint:"SP-P1-003",active_task:"T009",
    active_build_spec:"BS-P1-025",status:"ACTIVE"};
  const build={active_baseline:"BS-P1-025",implementation_enabled:true};
  const run={event:"workflow_dispatch",conclusion:"success",head_sha:sha,
    head_branch:"main",created_at:new Date((NOW-3600)*1000).toISOString(),
    display_title:"APPF2-L1|T009|SP-P1-003|"+grant.scope_sha256,
    path:"NFF98/appf2-build/"+WORKFLOW+"@refs/heads/main",
    repository:{full_name:"NFF98/appf2-build"}};
  const review={state:"approved",user:{login:"NFF98"},
    environments:[{name:ENVIRONMENT}]};
  const approvals=[review];
  const environment={name:ENVIRONMENT,protection_rules:[{type:"required_reviewers",
    reviewers:[{type:"User",reviewer:{login:"NFF98"}}]}]};
  const pr={state:"open",base:{ref:"main"},
    head:{sha:"c".repeat(40)},body:"Task: T009\nTask-Grant-Run: 123"};
  return {run,approvals,environment,grant,original:JSON.parse(JSON.stringify(grant)),
    task,sprint,build,pr,ancestor:true,now:NOW};
};
export function runTrustedGrantSelfTests(){
  let total=0;
  const yes=x=>{const r=inspectGitHubHumanGrant(x);assert.equal(r.ok,true,r.errors.join("|"));total++;};
  const no=(mutate)=>{const x=fresh();mutate(x);
    const r=inspectGitHubHumanGrant(x);assert.equal(r.ok,false,"fake grant admitted");total++;};
  yes(fresh());
  no(x=>{x.environment.protection_rules=[];});
  no(x=>{x.environment.protection_rules[0].reviewers=[{type:"User",reviewer:{login:"GPT"}}];});
  no(x=>{x.approvals=[];});
  no(x=>{x.approvals[0].user.login="GPT";});
  no(x=>{x.approvals.push({state:"rejected",user:{login:"NFF98"},
    environments:[{name:ENVIRONMENT}]});});
  no(x=>{x.run.event="push";});
  no(x=>{x.run.head_branch="unsafe-feature";});
  no(x=>{x.run.created_at="not-a-time";});
  no(x=>{x.run.conclusion="failure";});
  no(x=>{x.run.path="NFF98/appf2-build/.github/workflows/fake.yml@main";});
  no(x=>{x.run.repository.full_name="other/fake";});
  no(x=>{x.grant.schema="LEGACY";});
  no(x=>{x.grant.scope_sha256="f".repeat(64);});
  no(x=>{x.grant.base_sha="not-a-SHA";});
  no(x=>{x.grant.expires_at_unix+=1;});
  no(x=>{x.run.display_title="APPF2-L1|T008|SP-P1-003|"+x.grant.scope_sha256;});
  no(x=>{x.task.allowed_write_paths=["src/","tests/","secrets/"];});
  no(x=>{x.task.status="BLOCKED";});
  no(x=>{x.sprint.active_task="T008";});
  no(x=>{x.build.implementation_enabled=false;});
  no(x=>{x.build.active_baseline="BS-P1-026";});
  no(x=>{x.pr.body="Task: T008\nTask-Grant-Run: 123";});
  no(x=>{x.pr.state="closed";});
  no(x=>{x.pr.base.ref="other";});
  no(x=>{x.ancestor=false;});
  const sameHead=fresh();sameHead.run.head_sha=sameHead.pr.head.sha;yes(sameHead);
  no(x=>{x.now=x.grant.expires_at_unix+1;});
  no(x=>{x.grant.approved_at_unix="not-human";});
  const issuing=fresh(),input={task_id:issuing.grant.task_id,
    sprint_id:issuing.grant.sprint_id,scope_sha256:issuing.grant.scope_sha256,
    head_sha:issuing.run.head_sha};
  const v=inspectIssuance({...issuing,input,now:NOW});
  assert.equal(v.ok,true,v.errors.join("|"));total++;
  const before=fresh();before.task.status="PLANNED";
  before.sprint.active_sprint=null;before.sprint.active_task=null;before.sprint.status="HOLD";
  before.build.implementation_enabled=false;
  assert.equal(inspectIssuance({...before,input,now:NOW}).ok,true,
    "Human grant must happen BEFORE activation, not require duplicate approval");total++;
  before.sprint.active_task="T008";
  assert.equal(inspectIssuance({...before,input,now:NOW}).ok,false);total++;
  const rawChecks=["ci","attack","governance","Analyze JavaScript / TypeScript"]
    .map((name,i)=>({name,id:i+100,head_sha:sha,status:"completed",
      conclusion:"success",app:{slug:"github-actions"}}));
  const full=rows=>inspectLiveGitHubRequiredChecks({head:sha,checks:{check_runs:rows}});
  assert.equal(full(rawChecks).length,0);total++;
  const reject=rows=>{assert.notEqual(full(rows).length,0);total++;};
  reject(rawChecks.slice(0,3));
  reject(rawChecks.map((x,i)=>i?x:{...x,head_sha:base}));
  reject(rawChecks.map((x,i)=>i?x:{...x,conclusion:"skipped"}));
  reject(rawChecks.map((x,i)=>i?x:{...x,status:"in_progress"}));
  reject(rawChecks.map((x,i)=>i?x:{...x,app:{slug:"unknown-bot"}}));
  reject([...rawChecks,{...rawChecks[0],id:999,conclusion:"failure"}]);
  return total;
}
if(import.meta.url===pathToFileURL(process.argv[1]||"").href)
  console.log("可信 Human Grant："+runTrustedGrantSelfTests()+" 項合成正負測試 PASS；run-name/SHA 綁定為合成測試，真人 Environment E2E 尚未證明");
