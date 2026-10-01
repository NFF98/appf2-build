import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { canPreserveCompletedBaseline } from "../scripts/baseline-lineage.mjs";

const source=process.cwd();
const lineageUnchanged=canPreserveCompletedBaseline(source,"BS-P1-001","BS-P1-002",[{acceptance_id:"F04-AC-001",test_id:"TEST-F04-AC-001"}]);
const lineageChanged=canPreserveCompletedBaseline(source,"BS-P1-001","BS-P1-002",[{acceptance_id:"F07-AC-008",test_id:"TEST-F07-008"}]);
if(!lineageUnchanged) throw new Error("Rebaseline lineage must preserve completed work when mapped Acceptance semantics are unchanged.");
if(lineageChanged) throw new Error("Rebaseline lineage must reject completed-work carry-forward when mapped Acceptance semantics changed.");
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"appf2-attack-"));
const repo=path.join(tmp,"repo");
const results=[];

const run=(cmd,args,{cwd=repo,env={}}={})=>{
  const r=spawnSync(cmd,args,{cwd,encoding:"utf8",env:{...process.env,...env}});
  return {status:r.status??1,stdout:r.stdout||"",stderr:r.stderr||""};
};
const must=(cond,msg)=>{if(!cond) throw new Error(msg);};
const write=(rel,data)=>{
  const p=path.join(repo,rel); fs.mkdirSync(path.dirname(p),{recursive:true});
  fs.writeFileSync(p,typeof data==="string"?data:JSON.stringify(data,null,2)+"\n");
};
const read=rel=>JSON.parse(fs.readFileSync(path.join(repo,rel),"utf8"));
const sha=s=>crypto.createHash("sha256").update(s).digest("hex");
const fileSha=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const git=(...args)=>run("git",args);
const commit=msg=>{must(git("add",".").status===0,"git add failed"); const r=git("commit","-m",msg); must(r.status===0,"git commit failed: "+r.stderr); return git("rev-parse","HEAD").stdout.trim();};
const cleanTo=ref=>{must(git("reset","--hard",ref).status===0,"git reset failed"); git("clean","-fd");};

fs.cpSync(source,repo,{recursive:true,filter:p=>!p.includes(path.sep+".git")&&!p.includes(path.sep+"node_modules")&&!p.includes(path.sep+".attack-dry-run")});
fs.rmSync(path.join(repo,"delivery","sprints"),{recursive:true,force:true});
fs.mkdirSync(path.join(repo,"delivery","sprints"),{recursive:true});
fs.rmSync(path.join(repo,"delivery","evidence"),{recursive:true,force:true});
fs.mkdirSync(path.join(repo,"delivery","evidence"),{recursive:true});
must(git("init","-b","main").status===0,"git init failed");
must(git("config","core.autocrlf","false").status===0,"git core.autocrlf configuration failed");
git("config","user.name","appf2 Attack Dry Run");
git("config","user.email","attack@example.invalid");

function makeBaseline(id,{sourceCommit,supersedes=null,deltas=[],decisionRef,acceptanceEntries=null}){
  const base="build-spec/baselines/"+id;
  write(base+"/functions/demo.md","# Fake Build Contract\n\nDeterministic demo contract.\n");
  const entries=acceptanceEntries||[{acceptance_id:"F99-AC-001",test_id:"TEST-F99-001",contract_status:"ACTIVE",required_for_build_freeze:true}];
  write(base+"/registries/acceptance-test-registry.json",{
    schema_version:1,total_acceptance:entries.length,
    entries
  });
  const demoSha=fileSha(path.join(repo,base,"functions/demo.md"));
  const registrySha=fileSha(path.join(repo,base,"registries/acceptance-test-registry.json"));
  write(base+"/projection-map.json",{
    schema_version:1,baseline_id:id,phase:"PHASE_9",source_repo:"NFF98/appf2-design",source_commit:sourceCommit,
    freeze_audit:{status:"PASS",version_lock:true,source_commit:sourceCommit},
    projection_engine:{version:"MARKDOWN_EXACT_HEADING_V1",matching:"EXACT_ONLY",fuzzy_matching:false,llm_classification:false},
    entries:[
      {source_path:"working/functions/F99-demo.md",source_blob_sha:"1".repeat(40),mode:"FULL_COPY",target_path:"functions/demo.md",phase_scope:"PHASE_9_APPLICABLE_TRUTH_ONLY",freeze_audit_verification:"SELF_MARKER",output_sha256:demoSha},
      {source_path:"working/detailed-design/registries/acceptance-test-registry.json",source_blob_sha:"2".repeat(40),mode:"FULL_COPY",target_path:"registries/acceptance-test-registry.json",phase_scope:"PHASE_9_APPLICABLE_TRUTH_ONLY",freeze_audit_verification:"SELF_MARKER",output_sha256:registrySha}
    ]
  });
  const rels=["functions/demo.md","projection-map.json","registries/acceptance-test-registry.json"].sort();
  const inventory=rels.map(rel=>({path:rel,sha256:fileSha(path.join(repo,base,rel))}));
  const aggregate=sha(inventory.map(x=>x.path+":"+x.sha256+"\n").join(""));
  write(base+"/manifest.json",{
    schema_version:1,baseline_id:id,status:"LOCKED",source_repo:"NFF98/appf2-design",
    source_working_commit:sourceCommit,created_at:"2026-09-24T00:00:00Z",
    supersedes,approved_delta_ids:deltas,
    approval:{status:"USER_APPROVED",decision_ref:decisionRef},
    projection_map:"projection-map.json",
    acceptance_registry:"registries/acceptance-test-registry.json",acceptance_count:entries.length,
    file_inventory:inventory,content_sha256:aggregate
  });
}
function makeActivation(id,{previous=null,type,sourceCommit,deltas=[],decisionRef}){
  write("build-spec/activations/"+id+".json",{
    schema_version:1,baseline_id:id,previous_baseline:previous,type,status:"USER_APPROVED",
    decision_ref:decisionRef,approved_delta_ids:deltas,source_working_commit:sourceCommit,
    activated_at:"2026-09-24T00:00:00Z"
  });
}
function baseWorkState(id,status="ACTIVE",taskStatus="IN_PROGRESS"){
  write("build-spec/CURRENT.json",{schema_version:1,active_baseline:id,implementation_enabled:true,reason:"ATTACK_DRY_RUN"});
  write("delivery/backlog/QUEUE.json",{schema_version:1,build_spec_id:id,status:"OPEN",items:[{
    backlog_item_id:"BL-P9-001",source:"BUILD_SPEC",build_spec_id:id,function_id:"F99",title:"Fake task",
    status:"SPRINTED",priority:"P0",scope_contracts:["functions/demo.md"],
    acceptance_links:[{acceptance_id:"F99-AC-001",test_id:"TEST-F99-001",test_family:"behavior"}],
    dependencies:[],sprint_id:"SP-P9-001",product_decision_allowed:false
  }]});
  write("delivery/CURRENT-SPRINT.json",{
    schema_version:1,active_sprint:"SP-P9-001",active_build_spec:id,active_task:"T001",
    status,automation_mode:"SAFE_AUTOMATION",reason:"ATTACK_DRY_RUN"
  });
  write("delivery/sprints/SP-P9-001/manifest.json",{
    schema_version:1,sprint_id:"SP-P9-001",build_spec_id:id,status,backlog_item_ids:["BL-P9-001"],
    entry_gate:{build_spec_locked:true,baseline_gate_passed:true,acceptance_mapped:true,user_approved:true,approval_ref:"DRYRUN-SPRINT"}
  });
  write("delivery/sprints/SP-P9-001/tasks.json",{schema_version:3,sprint_id:"SP-P9-001",tasks:[{
    task_id:"T001",backlog_item_ids:["BL-P9-001"],title:"Fake task",status:taskStatus,build_spec_id:id,
    scope:["fake"],non_scope:["no extra scope"],acceptance_links:[{acceptance_id:"F99-AC-001",test_id:"TEST-F99-001"}],
    allowed_write_paths:["src/demo/","tests/behavior/"],required_commands:["npm run gate"],
    required_skills:["implementer","test-builder","reviewer"],parallel_safe:false,product_decision_allowed:false,
    blocked_by:[],completion_evidence:[]
  }]});
}
function expectFail(name,script,{base,head="HEAD",env:extraEnv={}}={}){
  const env={...extraEnv}; if(base) env.BASE_SHA=base; if(head) env.HEAD_SHA=head;
  const r=run("node",[script],{env});
  const pass=r.status!==0;
  results.push({name,expected:"FAIL",actual:pass?"FAIL":"PASS",ok:pass,detail:(r.stderr||r.stdout).trim().split("\n").slice(0,4).join(" | ")});
  if(!pass) throw new Error("Attack unexpectedly passed: "+name+"\n"+r.stdout+"\n"+r.stderr);
}
function expectPass(name,cmd,args,{base,head="HEAD",env:extraEnv={}}={}){
  const env={...extraEnv}; if(base) env.BASE_SHA=base; if(head) env.HEAD_SHA=head;
  const r=run(cmd,args,{env});
  const pass=r.status===0;
  results.push({name,expected:"PASS",actual:pass?"PASS":"FAIL",ok:pass,detail:(r.stderr||r.stdout).trim().split("\n").slice(0,4).join(" | ")});
  if(!pass) throw new Error("Positive case failed: "+name+"\n"+r.stdout+"\n"+r.stderr);
}
function expectHarnessPass(name,scripts,{base,head="HEAD"}={}){
  for(const script of scripts) expectPass(name+" :: "+path.basename(script),"node",[script],{base,head});
}
const governanceHarness=[
  "harness/scripts/validate-projection-map.mjs",
  "harness/scripts/validate-baseline.mjs",
  "harness/scripts/governance-gate.mjs",
  "harness/scripts/validate-activation.mjs",
  "harness/scripts/validate-backlog.mjs",
  "harness/scripts/validate-sprint.mjs",
  "harness/scripts/validate-findings.mjs",
  "harness/scripts/validate-evidence.mjs",
  "harness/scripts/validate-test-integrity.mjs",
  "harness/scripts/validate-engineering-quality.mjs",
  "harness/scripts/validate-release.mjs",
  "harness/scripts/validate-change-scope.mjs"
];

const sourceA="a".repeat(40), sourceB="b".repeat(40), sourceC="c".repeat(40);
makeBaseline("BS-P9-001",{sourceCommit:sourceA,decisionRef:"DRYRUN-INITIAL"});
makeActivation("BS-P9-001",{type:"INITIAL_FREEZE",sourceCommit:sourceA,decisionRef:"DRYRUN-INITIAL"});
baseWorkState("BS-P9-001");
write("package-lock.json",{name:"appf2-build",version:"0.0.0",lockfileVersion:3,requires:true,packages:{"":{name:"appf2-build",version:"0.0.0"}}});
const fixtureBase=commit("fixture: valid active sprint");
expectHarnessPass("valid fixture baseline",governanceHarness,{});

// Role-boundary positive/negative cases.
// Planning Agent may create Sprint planning artifacts while the repo is HOLD.
cleanTo(fixtureBase);
write("build-spec/CURRENT.json",{schema_version:1,active_baseline:"BS-P9-001",implementation_enabled:false,reason:"ROLE_PLANNING_HOLD"});
write("delivery/CURRENT-SPRINT.json",{schema_version:1,active_sprint:null,active_build_spec:null,active_task:null,status:"HOLD",automation_mode:"SAFE_AUTOMATION",reason:"ROLE_PLANNING_HOLD"});
const rolePlanningBase=commit("fixture: role planning hold");
write("delivery/sprints/SP-P9-002/manifest.json",{
  schema_version:1,sprint_id:"SP-P9-002",build_spec_id:"BS-P9-001",status:"PLANNED",goal:"role planning",scope:["fake"],non_scope:["none"],tasks_file:"tasks.json",backlog_item_ids:["BL-P9-001"],
  entry_gate:{build_spec_locked:true,baseline_gate_passed:true,acceptance_mapped:true,user_approved:false,approval_ref:null}
});
write("delivery/sprints/SP-P9-002/tasks.json",{schema_version:3,sprint_id:"SP-P9-002",tasks:[{
  task_id:"T001",backlog_item_ids:["BL-P9-001"],title:"Planned by Planning Agent",status:"PLANNED",build_spec_id:"BS-P9-001",
  scope:["fake"],non_scope:["none"],acceptance_links:[{acceptance_id:"F99-AC-001",test_id:"TEST-F99-001"}],
  allowed_write_paths:["src/demo/","tests/behavior/"],required_commands:["npm run gate"],
  required_skills:["implementer","test-builder","reviewer"],parallel_safe:false,product_decision_allowed:false,blocked_by:[],completion_evidence:[]
}]});
const rolePlanned=commit("positive: planning agent creates planned sprint");
expectPass("Planning Agent may create Sprint plan while HOLD","node",["harness/scripts/validate-change-scope.mjs"],{base:rolePlanningBase,head:rolePlanned});

// Cursor execution may not rewrite approved/active Sprint planning artifacts.
cleanTo(fixtureBase);
const activePlan=read("delivery/sprints/SP-P9-001/tasks.json");
activePlan.tasks[0].allowed_write_paths.push("src/unauthorized-expansion/");
write("delivery/sprints/SP-P9-001/tasks.json",activePlan);
const replan=commit("attack: cursor expands active task write scope");
expectFail("Cursor cannot rewrite Active Sprint Task plan","harness/scripts/validate-change-scope.mjs",{base:fixtureBase,head:replan});
cleanTo(fixtureBase);

// Planning Agent skills are not valid execution-task skills.
const plannerInjected=read("delivery/sprints/SP-P9-001/tasks.json");
plannerInjected.tasks[0].required_skills.push("task-planner");
write("delivery/sprints/SP-P9-001/tasks.json",plannerInjected);
const plannerSkill=commit("attack: cursor injects task-planner into execution task");
expectFail("Execution Task cannot require task-planner","harness/scripts/validate-sprint.mjs",{base:fixtureBase,head:plannerSkill});
cleanTo(fixtureBase);


// Build Readiness / Coding Quality attack cases.
cleanTo(fixtureBase);
write("generated/evil.json","{}\n");
const unclassifiedWrite=commit("attack: undeclared generated output");
expectFail("Fail-closed scope blocks undeclared generated/root paths","harness/scripts/validate-change-scope.mjs",{base:fixtureBase,head:unclassifiedWrite});
cleanTo(fixtureBase);

const badPkg=read("package.json"); badPkg.scripts["test:contract"]="node -e \"process.exit(0)\""; write("package.json",badPkg);
const packageRewrite=commit("attack: rewrite test command during active task");
expectFail("Active Task cannot rewrite package/test tooling","harness/scripts/validate-change-scope.mjs",{base:fixtureBase,head:packageRewrite});
cleanTo(fixtureBase);

// Planned Sprint must be machine-audited even while CURRENT-SPRINT is HOLD.
write("build-spec/CURRENT.json",{schema_version:1,active_baseline:"BS-P9-001",implementation_enabled:false,reason:"PLANNED_AUDIT"});
write("delivery/CURRENT-SPRINT.json",{schema_version:1,active_sprint:null,active_build_spec:null,active_task:null,status:"HOLD",automation_mode:"SAFE_AUTOMATION",reason:"PLANNED_AUDIT"});
const pq=read("delivery/backlog/QUEUE.json"); pq.items[0].status="READY"; delete pq.items[0].sprint_id; write("delivery/backlog/QUEUE.json",pq);
const pm=read("delivery/sprints/SP-P9-001/manifest.json"); pm.status="PLANNED"; pm.entry_gate.user_approved=false; pm.entry_gate.approval_ref=null; write("delivery/sprints/SP-P9-001/manifest.json",pm);
const pt=read("delivery/sprints/SP-P9-001/tasks.json"); pt.tasks[0].status="PLANNED"; pt.tasks[0].acceptance_links=[]; write("delivery/sprints/SP-P9-001/tasks.json",pt);
const plannedMissingAc=commit("attack: planned sprint omits mapped acceptance");
expectFail("PLANNED Sprint exact AC coverage cannot omit Acceptance","harness/scripts/validate-sprint.mjs",{base:fixtureBase,head:plannedMissingAc});
cleanTo(fixtureBase);

// CLOSED Sprint must fail closed unless every Task is CLOSED, every selected Backlog is DONE,
// and CURRENT no longer points at it as an active Sprint.
cleanTo(fixtureBase);
write("build-spec/CURRENT.json",{schema_version:1,active_baseline:"BS-P9-001",implementation_enabled:false,reason:"SPRINT_CLOSE_AUDIT"});
write("delivery/CURRENT-SPRINT.json",{schema_version:1,active_sprint:null,active_build_spec:null,active_task:null,status:"HOLD",automation_mode:"SAFE_AUTOMATION",reason:"SPRINT_CLOSE_AUDIT"});
const fakeClosedManifest=read("delivery/sprints/SP-P9-001/manifest.json"); fakeClosedManifest.status="CLOSED"; write("delivery/sprints/SP-P9-001/manifest.json",fakeClosedManifest);
const fakeClosedTasks=read("delivery/sprints/SP-P9-001/tasks.json"); fakeClosedTasks.tasks[0].status="IN_PROGRESS"; write("delivery/sprints/SP-P9-001/tasks.json",fakeClosedTasks);
const fakeClosedBacklog=read("delivery/backlog/QUEUE.json"); fakeClosedBacklog.items[0].status="DONE"; write("delivery/backlog/QUEUE.json",fakeClosedBacklog);
const closedWithOpenTask=commit("attack: close sprint with unfinished task");
expectFail("CLOSED Sprint requires every Task CLOSED","harness/scripts/validate-sprint.mjs",{base:fixtureBase,head:closedWithOpenTask});
cleanTo(fixtureBase);

write("build-spec/CURRENT.json",{schema_version:1,active_baseline:"BS-P9-001",implementation_enabled:false,reason:"SPRINT_CLOSE_AUDIT"});
write("delivery/CURRENT-SPRINT.json",{schema_version:1,active_sprint:null,active_build_spec:null,active_task:null,status:"HOLD",automation_mode:"SAFE_AUTOMATION",reason:"SPRINT_CLOSE_AUDIT"});
const fakeDoneManifest=read("delivery/sprints/SP-P9-001/manifest.json"); fakeDoneManifest.status="CLOSED"; write("delivery/sprints/SP-P9-001/manifest.json",fakeDoneManifest);
const fakeDoneTasks=read("delivery/sprints/SP-P9-001/tasks.json"); fakeDoneTasks.tasks[0].status="CLOSED"; write("delivery/sprints/SP-P9-001/tasks.json",fakeDoneTasks);
const fakeSprintedBacklog=read("delivery/backlog/QUEUE.json"); fakeSprintedBacklog.items[0].status="SPRINTED"; write("delivery/backlog/QUEUE.json",fakeSprintedBacklog);
const closedWithOpenBacklog=commit("attack: close sprint with unfinished backlog");
expectFail("CLOSED Sprint requires every selected Backlog DONE","harness/scripts/validate-sprint.mjs",{base:fixtureBase,head:closedWithOpenBacklog});
cleanTo(fixtureBase);

write("build-spec/CURRENT.json",{schema_version:1,active_baseline:"BS-P9-001",implementation_enabled:false,reason:"SPRINT_CLOSE_AUDIT"});
const activeClosedManifest=read("delivery/sprints/SP-P9-001/manifest.json"); activeClosedManifest.status="CLOSED"; write("delivery/sprints/SP-P9-001/manifest.json",activeClosedManifest);
const activeClosedTasks=read("delivery/sprints/SP-P9-001/tasks.json"); activeClosedTasks.tasks[0].status="CLOSED"; write("delivery/sprints/SP-P9-001/tasks.json",activeClosedTasks);
const activeClosedBacklog=read("delivery/backlog/QUEUE.json"); activeClosedBacklog.items[0].status="DONE"; write("delivery/backlog/QUEUE.json",activeClosedBacklog);
write("delivery/CURRENT-SPRINT.json",{schema_version:1,active_sprint:"SP-P9-001",active_build_spec:"BS-P9-001",active_task:"T001",status:"REVIEW",automation_mode:"SAFE_AUTOMATION",reason:"SPRINT_CLOSE_AUDIT"});
const closedStillActive=commit("attack: closed sprint remains current active sprint");
expectFail("CLOSED Sprint cannot remain CURRENT active_sprint","harness/scripts/validate-sprint.mjs",{base:fixtureBase,head:closedStillActive});
cleanTo(fixtureBase);

write("build-spec/CURRENT.json",{schema_version:1,active_baseline:"BS-P9-001",implementation_enabled:false,reason:"SPRINT_CLOSE_AUDIT"});
write("delivery/CURRENT-SPRINT.json",{schema_version:1,active_sprint:null,active_build_spec:null,active_task:null,status:"HOLD",automation_mode:"SAFE_AUTOMATION",reason:"SPRINT_CLOSE_AUDIT"});
const validClosedManifest=read("delivery/sprints/SP-P9-001/manifest.json"); validClosedManifest.status="CLOSED"; write("delivery/sprints/SP-P9-001/manifest.json",validClosedManifest);
const validClosedTasks=read("delivery/sprints/SP-P9-001/tasks.json"); validClosedTasks.tasks[0].status="CLOSED"; write("delivery/sprints/SP-P9-001/tasks.json",validClosedTasks);
const validClosedBacklog=read("delivery/backlog/QUEUE.json"); validClosedBacklog.items[0].status="DONE"; write("delivery/backlog/QUEUE.json",validClosedBacklog);
const validClosed=commit("positive: valid closed sprint");
expectPass("Valid CLOSED Sprint passes sprint validator","node",["harness/scripts/validate-sprint.mjs"],{base:fixtureBase,head:validClosed});
cleanTo(fixtureBase);

// Completed Acceptance semantic drift must be revalidated without rewriting closed Sprint history.
const oldAc={acceptance_id:"F99-AC-001",test_id:"TEST-F99-001",contract_status:"ACTIVE",required_for_build_freeze:true,criterion:"old semantic"};
const newAc={acceptance_id:"F99-AC-001",test_id:"TEST-F99-001",contract_status:"ACTIVE",required_for_build_freeze:true,criterion:"new semantic"};
const stableAc={acceptance_id:"F99-AC-002",test_id:"TEST-F99-002",contract_status:"ACTIVE",required_for_build_freeze:true,criterion:"stable semantic"};
const oldReg=read("build-spec/baselines/BS-P9-001/registries/acceptance-test-registry.json");
oldReg.entries=[oldAc,stableAc]; oldReg.total_acceptance=2;
write("build-spec/baselines/BS-P9-001/registries/acceptance-test-registry.json",oldReg);
makeBaseline("BS-P9-002",{sourceCommit:sourceB,supersedes:"BS-P9-001",decisionRef:"DRYRUN-REVALIDATION-FREEZE",acceptanceEntries:[newAc,stableAc]});

write("build-spec/CURRENT.json",{schema_version:1,active_baseline:"BS-P9-002",implementation_enabled:true,reason:"REVALIDATION_POSITIVE"});
write("delivery/backlog/QUEUE.json",{schema_version:1,build_spec_id:"BS-P9-002",status:"OPEN",items:[
  {
    backlog_item_id:"BL-P9-001",source:"BUILD_SPEC",build_spec_id:"BS-P9-001",function_id:"F99",title:"Historical done",
    status:"DONE",priority:"P0",scope_contracts:["functions/demo.md"],
    acceptance_links:[{acceptance_id:"F99-AC-001",test_id:"TEST-F99-001"}],dependencies:[],sprint_id:"SP-P9-001",product_decision_allowed:false,
    revalidation:{target_build_spec_id:"BS-P9-002",status:"IN_PROGRESS",sprint_id:"SP-P9-002",task_id:"T001",acceptance_ids:["F99-AC-001"]}
  },
  {
    backlog_item_id:"BL-P9-002",source:"BUILD_SPEC",build_spec_id:"BS-P9-002",function_id:"F99",title:"Current work",
    status:"SPRINTED",priority:"P0",scope_contracts:["functions/demo.md"],
    acceptance_links:[{acceptance_id:"F99-AC-002",test_id:"TEST-F99-002"}],dependencies:[],sprint_id:"SP-P9-002",product_decision_allowed:false
  }
]});
const histManifest=read("delivery/sprints/SP-P9-001/manifest.json"); histManifest.status="CLOSED"; write("delivery/sprints/SP-P9-001/manifest.json",histManifest);
const histTasks=read("delivery/sprints/SP-P9-001/tasks.json"); histTasks.tasks[0].status="CLOSED"; write("delivery/sprints/SP-P9-001/tasks.json",histTasks);
write("delivery/sprints/SP-P9-002/manifest.json",{
  schema_version:1,sprint_id:"SP-P9-002",build_spec_id:"BS-P9-002",status:"ACTIVE",goal:"revalidation",scope:["fake"],non_scope:["none"],tasks_file:"tasks.json",
  backlog_item_ids:["BL-P9-002"],revalidation_item_ids:["BL-P9-001"],
  entry_gate:{build_spec_locked:true,baseline_gate_passed:true,acceptance_mapped:true,user_approved:true,approval_ref:"DRYRUN-REVALIDATION"}
});
write("delivery/sprints/SP-P9-002/tasks.json",{schema_version:3,sprint_id:"SP-P9-002",tasks:[{
  task_id:"T001",backlog_item_ids:["BL-P9-002"],title:"Revalidate changed Acceptance",status:"IN_PROGRESS",build_spec_id:"BS-P9-002",
  scope:["revalidate"],non_scope:["none"],
  acceptance_links:[{acceptance_id:"F99-AC-002",test_id:"TEST-F99-002"},{acceptance_id:"F99-AC-001",test_id:"TEST-F99-001"}],
  allowed_write_paths:["src/demo/","tests/behavior/"],required_commands:["npm run gate"],
  required_skills:["implementer","test-builder","reviewer"],parallel_safe:false,product_decision_allowed:false,blocked_by:[],completion_evidence:[]
}]});
write("delivery/CURRENT-SPRINT.json",{schema_version:1,active_sprint:"SP-P9-002",active_build_spec:"BS-P9-002",active_task:"T001",status:"ACTIVE",automation_mode:"SAFE_AUTOMATION",reason:"REVALIDATION_POSITIVE"});
const validRevalidation=commit("positive: completed Acceptance revalidation");
expectPass("DONE semantic drift with explicit revalidation passes Backlog Gate","node",["harness/scripts/validate-backlog.mjs"],{base:fixtureBase,head:validRevalidation});
expectPass("DONE semantic drift revalidation is owned by active Sprint Task","node",["harness/scripts/validate-sprint.mjs"],{base:fixtureBase,head:validRevalidation});

const brokenQueue=read("delivery/backlog/QUEUE.json"); delete brokenQueue.items[0].revalidation; write("delivery/backlog/QUEUE.json",brokenQueue);
const missingRevalidation=commit("attack: semantic drift without revalidation");
expectFail("DONE semantic drift without revalidation is rejected","harness/scripts/validate-backlog.mjs",{base:validRevalidation,head:missingRevalidation});
cleanTo(fixtureBase);

// Active Task cannot bypass an unfinished blocked_by dependency.
const depRegistry=read("build-spec/baselines/BS-P9-001/registries/acceptance-test-registry.json");
depRegistry.entries.push({acceptance_id:"F99-AC-002",test_id:"TEST-F99-002",contract_status:"ACTIVE",required_for_build_freeze:true});
write("build-spec/baselines/BS-P9-001/registries/acceptance-test-registry.json",depRegistry);
const depQ=read("delivery/backlog/QUEUE.json");
depQ.items.push({backlog_item_id:"BL-P9-002",source:"BUILD_SPEC",build_spec_id:"BS-P9-001",function_id:"F99",title:"Blocker",status:"SPRINTED",priority:"P0",scope_contracts:["functions/demo.md"],acceptance_links:[{acceptance_id:"F99-AC-002",test_id:"TEST-F99-002"}],dependencies:[],sprint_id:"SP-P9-001",product_decision_allowed:false});
write("delivery/backlog/QUEUE.json",depQ);
const depM=read("delivery/sprints/SP-P9-001/manifest.json"); depM.backlog_item_ids.push("BL-P9-002"); write("delivery/sprints/SP-P9-001/manifest.json",depM);
const depT=read("delivery/sprints/SP-P9-001/tasks.json");
depT.tasks[0].blocked_by=["T002"];
depT.tasks.push({task_id:"T002",backlog_item_ids:["BL-P9-002"],title:"Unfinished blocker",status:"PLANNED",build_spec_id:"BS-P9-001",scope:["blocker"],non_scope:["none"],acceptance_links:[{acceptance_id:"F99-AC-002",test_id:"TEST-F99-002"}],allowed_write_paths:["src/blocker/","tests/behavior/"],required_commands:["npm run gate"],required_skills:["implementer","test-builder","reviewer"],parallel_safe:false,product_decision_allowed:false,blocked_by:[],completion_evidence:[]});
write("delivery/sprints/SP-P9-001/tasks.json",depT);
const bypassDep=commit("attack: start task before blocker is done");
expectFail("Active Task cannot bypass unfinished blocked_by Task","harness/scripts/validate-sprint.mjs",{base:fixtureBase,head:bypassDep});
cleanTo(fixtureBase);

// FAIL/INFO evidence cannot satisfy completion.
const failEv="EV-SP-P9-001-T001-001";
write("delivery/evidence/"+failEv+".json",{schema_version:2,evidence_id:failEv,kind:"TEST_RESULT",build_spec_id:"BS-P9-001",sprint_id:"SP-P9-001",task_id:"T001",acceptance_ids:["F99-AC-001"],test_ids:["TEST-F99-001"],status:"FAIL",command:null,review_checks:null,blocking_findings:[],locator:"dry-run://failed-test",sha256:null,source_commit:fixtureBase,recorded_at:"2026-09-26T00:00:00Z"});
const failTasks=read("delivery/sprints/SP-P9-001/tasks.json"); failTasks.tasks[0].status="VERIFIED"; failTasks.tasks[0].completion_evidence=[failEv]; write("delivery/sprints/SP-P9-001/tasks.json",failTasks);
const fakeEvidence=commit("attack: fail evidence closes task");
expectFail("FAIL Evidence cannot close Task","harness/scripts/validate-evidence.mjs",{base:fixtureBase,head:fakeEvidence});
cleanTo(fixtureBase);

// Review must cover the complete Engineering Quality checklist.
const reviewEv="EV-SP-P9-001-T001-002";
write("delivery/evidence/"+reviewEv+".json",{schema_version:2,evidence_id:reviewEv,kind:"REVIEW",build_spec_id:"BS-P9-001",sprint_id:"SP-P9-001",task_id:"T001",acceptance_ids:[],test_ids:[],status:"PASS",command:null,review_checks:{semantic_drift:"PASS"},blocking_findings:[],locator:"dry-run://weak-review",sha256:null,source_commit:fixtureBase,recorded_at:"2026-09-26T00:00:00Z"});
const weakReview=commit("attack: incomplete engineering review");
expectFail("Incomplete Engineering Quality REVIEW is rejected","harness/scripts/validate-evidence.mjs",{base:fixtureBase,head:weakReview});
cleanTo(fixtureBase);

// Test anti-cheat and executable Test mapping.
write("tests/behavior/cheat.test.ts",'import { test, expect } from "vitest";\ntest.skip("TEST-F99-001 fake",()=>{expect(true).toBe(true);});\n');
const skippedTest=commit("attack: skipped fake-green test");
expectFail("skip/todo/fake-green test patterns are rejected","harness/scripts/validate-engineering-quality.mjs",{base:fixtureBase,head:skippedTest});
cleanTo(fixtureBase);
expectFail("Active mapped Test ID must exist as executable test()","harness/scripts/validate-test-integrity.mjs",{base:fixtureBase,head:"HEAD",env:{REQUIRE_ACTIVE_TASK_TESTS:"1"}});

// Baseline fixture maintenance must remain exact, recorded and fail-closed.
cleanTo(fixtureBase);
const maintenanceFile="tests/behavior/maintenance.test.ts";
const maintenanceV1='import { test, expect } from "vitest";\n'+
  'test("TEST-F99-001 owned",()=>{expect("1.0.0").toBe("1.0.0");});\n'+
  'test("TEST-F99-002 foreign fixture",()=>{expect("1.0.0").toBe("1.0.0");});\n';
const maintenanceV2=maintenanceV1.replaceAll('"1.0.0"','"2.0.0"');
write(maintenanceFile,maintenanceV1);
const maintenanceBase=commit("fixture: baseline test file with foreign Test ID");
write(maintenanceFile,maintenanceV2);
const maintenanceUnauthorized=commit("attack: rebind foreign fixture without authorization");
expectFail("Foreign mapped Test fixture rebind requires exact authorization","harness/scripts/validate-test-integrity.mjs",{base:maintenanceBase,head:maintenanceUnauthorized});

cleanTo(maintenanceBase);
const maintenanceTasks=read("delivery/sprints/SP-P9-001/tasks.json");
maintenanceTasks.tasks[0].test_maintenance_authorizations=[{
  test_id:"TEST-F99-002",file:maintenanceFile,mode:"BASELINE_FIXTURE_REBIND",
  from_build_spec:"BS-P9-000",to_build_spec:"BS-P9-001"
}];
write("delivery/sprints/SP-P9-001/tasks.json",maintenanceTasks);
write(maintenanceFile,maintenanceV2);
const maintenanceAuthorized=commit("positive: exact foreign fixture rebind authorization");
expectPass("Exact Test ID + file fixture rebind authorization passes Test Integrity","node",["harness/scripts/validate-test-integrity.mjs"],{base:maintenanceBase,head:maintenanceAuthorized});

cleanTo(maintenanceBase);
const wrongMaintenanceTasks=read("delivery/sprints/SP-P9-001/tasks.json");
wrongMaintenanceTasks.tasks[0].test_maintenance_authorizations=[{
  test_id:"TEST-F99-002",file:"tests/behavior/other.test.ts",mode:"BASELINE_FIXTURE_REBIND",
  from_build_spec:"BS-P9-000",to_build_spec:"BS-P9-001"
}];
write("delivery/sprints/SP-P9-001/tasks.json",wrongMaintenanceTasks);
write(maintenanceFile,maintenanceV2);
const wrongMaintenanceFile=commit("attack: maintenance authorization bound to wrong file");
expectFail("Maintenance authorization may not authorize a different test file","harness/scripts/validate-test-integrity.mjs",{base:maintenanceBase,head:wrongMaintenanceFile});

cleanTo(fixtureBase);
const malformedMaintenanceTasks=read("delivery/sprints/SP-P9-001/tasks.json");
malformedMaintenanceTasks.tasks[0].test_maintenance_authorizations=[{
  test_id:"TEST-F99-999",file:"tests/behavior/*",mode:"ANY",
  from_build_spec:"BS-P9-001",to_build_spec:"BS-P9-001"
}];
write("delivery/sprints/SP-P9-001/tasks.json",malformedMaintenanceTasks);
const malformedMaintenance=commit("attack: malformed maintenance authorization");
expectFail("Sprint Gate rejects wildcard / wrong-mode maintenance authorization","harness/scripts/validate-sprint.mjs",{base:fixtureBase,head:malformedMaintenance});
cleanTo(fixtureBase);

// First real implementation change cannot proceed without reproducible lockfile.
cleanTo(fixtureBase);
fs.rmSync(path.join(repo,"package-lock.json"),{force:true});
write("src/demo/needs-lock.ts","export const needsLock=true;\n");
const noLock=commit("attack: implementation without lockfile");
expectFail("First implementation change requires package-lock.json","ci/run-product-ci.mjs",{base:fixtureBase,head:noLock});
cleanTo(fixtureBase);

const badProjection=read("build-spec/baselines/BS-P9-001/projection-map.json");
badProjection.freeze_audit.source_commit=sourceB;
write("build-spec/baselines/BS-P9-001/projection-map.json",badProjection);
expectFail("Projection map rejects source commit drift","harness/scripts/validate-projection-map.mjs",{});
cleanTo(fixtureBase);

write("src/outside/hack.ts","export const hack=true;\n");
const outside=commit("attack: write outside task allowlist");
expectFail("Task allowlist blocks out-of-scope source","harness/scripts/validate-change-scope.mjs",{base:fixtureBase,head:outside});
cleanTo(fixtureBase);

write("build-spec/baselines/BS-P9-001/functions/demo.md","# hacked locked contract\n");
const mutate=commit("attack: mutate locked baseline");
expectFail("Locked Build Spec byte mutation","harness/scripts/governance-gate.mjs",{base:fixtureBase,head:mutate});
cleanTo(fixtureBase);

makeBaseline("BS-P9-002",{sourceCommit:sourceB,supersedes:"BS-P9-001",deltas:["BD-999"],decisionRef:"FAKE"});
write("build-spec/CURRENT.json",{schema_version:1,active_baseline:"BS-P9-002",implementation_enabled:true,reason:"ATTACK"});
const pointer=commit("attack: switch current without activation");
expectFail("CURRENT pointer cannot switch without Activation Record","harness/scripts/validate-activation.mjs",{base:fixtureBase,head:pointer});
cleanTo(fixtureBase);

write("delivery/findings/BF-901.json",{
  schema_version:1,finding_id:"BF-901",classification:"DESIGN_DELTA_CANDIDATE",status:"BLOCKED",
  build_spec_id:"BS-P9-001",sprint_id:"SP-P9-001",task_id:"T001",expected:"A",actual:"B",
  evidence:["dry-run"],attempts:[],contract_affecting:true,delta_id:"BD-901"
});
write("delivery/deltas/BD-901.json",{
  schema_version:1,delta_id:"BD-901",type:"DESIGN_DELTA",status:"APPROVED",source_finding_ids:["BF-901"],
  affected_build_spec:"BS-P9-001",affected_tasks:["T001"],affected_contracts:[],affected_acceptance:[],
  changes_contract_semantics:true,owner:"CURSOR",user_decision_required:true,
  user_decision:{status:"APPROVED",decision_ref:"FORGED"},replacement_build_spec_required:true,
  upstream_working_commit:sourceB,replacement_build_spec:null,verification:[]
});
const fakeDelta=commit("attack: cursor self approves design delta");
expectFail("Cursor-owned DESIGN_DELTA is rejected","harness/scripts/validate-findings.mjs",{base:fixtureBase,head:fakeDelta});
cleanTo(fixtureBase);

baseWorkState("BS-P9-001","BLOCKED","BLOCKED");
write("src/demo/blocked.ts","export const blocked=true;\n");
const blockedWrite=commit("attack: blocked sprint writes code");
expectFail("BLOCKED Sprint cannot write implementation","harness/scripts/validate-change-scope.mjs",{base:fixtureBase,head:blockedWrite});
cleanTo(fixtureBase);

write("delivery/findings/BF-902.json",{
  schema_version:1,finding_id:"BF-902",classification:"IMPLEMENTATION_BUG",status:"OPEN",
  build_spec_id:"BS-P9-001",sprint_id:"SP-P9-001",task_id:"T001",expected:"pass",actual:"fail",
  evidence:["dry-run"],contract_affecting:false,delta_id:null,
  attempts:[
    {attempt_id:"A1",strategy:"same-fix",result:"FAIL",evidence:"e1"},
    {attempt_id:"A2",strategy:"same-fix",result:"FAIL",evidence:"e2"},
    {attempt_id:"A3",strategy:"same-fix",result:"FAIL",evidence:"e3"}
  ]
});
const retry=commit("attack: third same strategy retry");
expectFail("Third same-strategy retry is rejected","harness/scripts/validate-findings.mjs",{base:fixtureBase,head:retry});
cleanTo(fixtureBase);

write("releases/manifests/REL-P9-001.json",{
  schema_version:1,release_id:"REL-P9-001",status:"RELEASE_READY",build_spec_id:"BS-P9-001",
  source_commit:"c".repeat(40),sprint_ids:["SP-P9-001"],
  approval:{status:"PENDING",decision_ref:null},
  targets:[{target_id:"web",type:"CLOUDFLARE_PAGES",enabled:true,artifact_path:"dist"}],
  health_checks:[{name:"root",base_url_env:"DEPLOY_BASE_URL",path:"/",expected_status:[200]}],
  rollback:{cloudflare_code_auto:true,database_auto:false,database_strategy:"FORWARD_ONLY"}
});
const release=commit("attack: unapproved release");
expectFail("Unapproved Release is rejected","harness/scripts/validate-release.mjs",{base:fixtureBase,head:release});
cleanTo(fixtureBase);

write("delivery/CURRENT-SPRINT.json",{schema_version:1,active_sprint:null,active_build_spec:null,active_task:null,status:"HOLD",automation_mode:"SAFE_AUTOMATION",reason:"ATTACK"});
write("build-spec/CURRENT.json",{schema_version:1,active_baseline:"BS-P9-001",implementation_enabled:false,reason:"ATTACK"});
write("src/demo/hold.ts","export const hold=true;\n");
const holdWrite=commit("attack: hold writes implementation");
expectFail("HOLD cannot write product implementation","harness/scripts/validate-change-scope.mjs",{base:fixtureBase,head:holdWrite});
cleanTo(fixtureBase);

baseWorkState("BS-P9-001","BLOCKED","BLOCKED");
write("delivery/findings/BF-999.json",{
  schema_version:1,finding_id:"BF-999",classification:"DESIGN_DELTA_CANDIDATE",status:"BLOCKED",
  build_spec_id:"BS-P9-001",sprint_id:"SP-P9-001",task_id:"T001",expected:"old",actual:"needs approved change",
  evidence:["dry-run"],attempts:[],contract_affecting:true,delta_id:"BD-999"
});
write("delivery/deltas/BD-999.json",{
  schema_version:1,delta_id:"BD-999",type:"DESIGN_DELTA",status:"APPROVED",source_finding_ids:["BF-999"],
  affected_build_spec:"BS-P9-001",affected_tasks:["T001"],affected_contracts:["functions/demo.md"],affected_acceptance:["F99-AC-001"],
  changes_contract_semantics:true,owner:"HUMAN_GOVERNANCE",user_decision_required:true,
  user_decision:{status:"APPROVED",decision_ref:"DRYRUN-DELTA-APPROVAL"},replacement_build_spec_required:true,
  upstream_working_commit:sourceB,replacement_build_spec:"BS-P9-002",verification:[]
});
const blockedBase=commit("fixture: blocked for approved design delta");

// Scope-clean derived freeze source must preserve truthful upstream Working provenance.
cleanTo(blockedBase);
const derivedDelta=read("delivery/deltas/BD-999.json");
derivedDelta.freeze_source={
  type:"SCOPE_CLEAN_DERIVED",
  commit:sourceC,
  base_commit:sourceA,
  provenance_audit:"delivery/audits/SP-P1-002-A0-PHASE2-REMEDIATION.md"
};
write("delivery/deltas/BD-999.json",derivedDelta);
makeBaseline("BS-P9-002",{sourceCommit:sourceC,supersedes:"BS-P9-001",deltas:["BD-999"],decisionRef:"DRYRUN-DERIVED-FREEZE"});
const derivedResolved=read("delivery/findings/BF-999.json"); derivedResolved.status="RESOLVED"; write("delivery/findings/BF-999.json",derivedResolved);
write("build-spec/CURRENT.json",{schema_version:1,active_baseline:"BS-P9-001",implementation_enabled:false,reason:"DRYRUN_DERIVED_HOLD"});
write("delivery/CURRENT-SPRINT.json",{schema_version:1,active_sprint:null,active_build_spec:null,active_task:null,status:"HOLD",automation_mode:"SAFE_AUTOMATION",reason:"DRYRUN_DERIVED_HOLD"});
const derivedFrozenBase=commit("fixture: scope-clean derived replacement baseline awaiting activation");
makeActivation("BS-P9-002",{previous:"BS-P9-001",type:"REBASELINE",sourceCommit:sourceC,deltas:["BD-999"],decisionRef:"DRYRUN-DERIVED-ACTIVATION"});
write("build-spec/CURRENT.json",{schema_version:1,active_baseline:"BS-P9-002",implementation_enabled:false,reason:"DRYRUN_DERIVED_ACTIVE_POINTER"});
const derivedActivation=commit("positive: derived freeze provenance activation");
expectPass("Derived freeze source with truthful upstream provenance passes Activation Gate","node",["harness/scripts/validate-activation.mjs"],{base:derivedFrozenBase,head:derivedActivation});

cleanTo(derivedFrozenBase);
const forgedDerived=read("delivery/deltas/BD-999.json");
forgedDerived.freeze_source.commit="d".repeat(40);
write("delivery/deltas/BD-999.json",forgedDerived);
makeActivation("BS-P9-002",{previous:"BS-P9-001",type:"REBASELINE",sourceCommit:sourceC,deltas:["BD-999"],decisionRef:"DRYRUN-DERIVED-ACTIVATION"});
write("build-spec/CURRENT.json",{schema_version:1,active_baseline:"BS-P9-002",implementation_enabled:false,reason:"DRYRUN_DERIVED_BAD_POINTER"});
const badDerivedActivation=commit("attack: derived freeze provenance mismatch");
expectFail("Derived freeze source mismatch is rejected","harness/scripts/validate-activation.mjs",{base:derivedFrozenBase,head:badDerivedActivation});
cleanTo(blockedBase);

makeBaseline("BS-P9-002",{sourceCommit:sourceB,supersedes:"BS-P9-001",deltas:["BD-999"],decisionRef:"DRYRUN-REBASELINE-FREEZE"});
const resolved=read("delivery/findings/BF-999.json"); resolved.status="RESOLVED"; write("delivery/findings/BF-999.json",resolved);
const frozenRebaselineBase=commit("fixture: finding resolved and replacement baseline already frozen");
makeActivation("BS-P9-002",{previous:"BS-P9-001",type:"REBASELINE",sourceCommit:sourceB,deltas:["BD-999"],decisionRef:"DRYRUN-REBASELINE-ACTIVATION"});
baseWorkState("BS-P9-002","BLOCKED","BLOCKED");
write("build-spec/CURRENT.json",{schema_version:1,active_baseline:"BS-P9-002",implementation_enabled:true,reason:"APPROVED_DRYRUN_REBASELINE"});
const goodRebaseline=commit("positive: approved rebaseline remains blocked");
expectHarnessPass("Approved rebaseline transition",governanceHarness,{base:frozenRebaselineBase,head:goodRebaseline});

// Positive HOLD -> ACTIVE rebaseline: replacement baseline is already frozen, then one Human-approved
// activation/control transition may move CURRENT + Sprint/Task bindings without requiring pre-existing product tests.
cleanTo(blockedBase);
makeBaseline("BS-P9-002",{sourceCommit:sourceB,supersedes:"BS-P9-001",deltas:["BD-999"],decisionRef:"DRYRUN-REBASELINE"});
const holdResolved=read("delivery/findings/BF-999.json"); holdResolved.status="RESOLVED"; write("delivery/findings/BF-999.json",holdResolved);
write("build-spec/CURRENT.json",{schema_version:1,active_baseline:"BS-P9-001",implementation_enabled:false,reason:"DRYRUN_REBASELINE_HOLD"});
write("delivery/CURRENT-SPRINT.json",{schema_version:1,active_sprint:null,active_build_spec:null,active_task:null,status:"HOLD",automation_mode:"SAFE_AUTOMATION",reason:"DRYRUN_REBASELINE_HOLD"});
write("delivery/evidence/EV-SP-P9-001-T001-001.json",{
  schema_version:2,build_spec_id:"BS-P9-001",sprint_id:"SP-P9-001",task_id:"T001",status:"PASS",
  sha256:null,recorded_at:"2026-09-24T00:00:00Z",blocking_findings:[],source_commit:blockedBase,
  evidence_id:"EV-SP-P9-001-T001-001",kind:"TEST_RESULT",
  acceptance_ids:["F99-AC-001"],test_ids:["TEST-F99-001"],
  locator:"dryrun://historical-pre-rebaseline-evidence",command:null,review_checks:null
});
const holdRebaselineBase=commit("fixture: frozen replacement baseline awaiting HOLD rebaseline activation");

makeActivation("BS-P9-002",{previous:"BS-P9-001",type:"REBASELINE",sourceCommit:sourceB,deltas:["BD-999"],decisionRef:"DRYRUN-REBASELINE"});
baseWorkState("BS-P9-002","ACTIVE","IN_PROGRESS");
write("build-spec/CURRENT.json",{schema_version:1,active_baseline:"BS-P9-002",implementation_enabled:true,reason:"DRYRUN_REBASELINE_ACTIVE"});
const holdRebaselineHead=commit("positive: HOLD to ACTIVE approved rebaseline");
expectHarnessPass("HOLD to ACTIVE approved rebaseline",governanceHarness,{base:holdRebaselineBase,head:holdRebaselineHead});
expectPass("HOLD rebaseline control-only Product CI skips pre-code tests","node",["ci/run-product-ci.mjs"],{base:holdRebaselineBase,head:holdRebaselineHead});

// Positive Sprint Activation transition: control files may cross HOLD -> ACTIVE without pretending product tests already exist.
cleanTo(fixtureBase);
write("build-spec/CURRENT.json",{schema_version:1,active_baseline:"BS-P9-001",implementation_enabled:false,reason:"DRYRUN_PLANNED"});
write("delivery/CURRENT-SPRINT.json",{schema_version:1,active_sprint:null,active_build_spec:null,active_task:null,status:"HOLD",automation_mode:"SAFE_AUTOMATION",reason:"DRYRUN_PLANNED"});
const plannedManifest=read("delivery/sprints/SP-P9-001/manifest.json");
plannedManifest.status="PLANNED";
plannedManifest.entry_gate.user_approved=false;
plannedManifest.entry_gate.approval_ref=null;
write("delivery/sprints/SP-P9-001/manifest.json",plannedManifest);
const plannedTasks=read("delivery/sprints/SP-P9-001/tasks.json");
plannedTasks.tasks[0].status="PLANNED";
write("delivery/sprints/SP-P9-001/tasks.json",plannedTasks);
const plannedBacklog=read("delivery/backlog/QUEUE.json");
plannedBacklog.items[0].status="READY";
delete plannedBacklog.items[0].sprint_id;
write("delivery/backlog/QUEUE.json",plannedBacklog);
const activationBase=commit("fixture: planned sprint awaiting activation");

write("build-spec/CURRENT.json",{schema_version:1,active_baseline:"BS-P9-001",implementation_enabled:true,reason:"DRYRUN_APPROVED_ACTIVATION"});
const activeManifest=read("delivery/sprints/SP-P9-001/manifest.json");
activeManifest.status="ACTIVE";
activeManifest.entry_gate.user_approved=true;
activeManifest.entry_gate.approval_ref="DRYRUN-SPRINT-ACTIVATION";
write("delivery/sprints/SP-P9-001/manifest.json",activeManifest);
const activeTasks=read("delivery/sprints/SP-P9-001/tasks.json");
activeTasks.tasks[0].status="IN_PROGRESS";
write("delivery/sprints/SP-P9-001/tasks.json",activeTasks);
const activeBacklog=read("delivery/backlog/QUEUE.json");
activeBacklog.items[0].status="SPRINTED";
activeBacklog.items[0].sprint_id="SP-P9-001";
write("delivery/backlog/QUEUE.json",activeBacklog);
write("delivery/CURRENT-SPRINT.json",{
  schema_version:1,active_sprint:"SP-P9-001",active_build_spec:"BS-P9-001",active_task:"T001",
  status:"ACTIVE",automation_mode:"SAFE_AUTOMATION",reason:"DRYRUN_APPROVED_ACTIVATION"
});
const activationHead=commit("positive: approved sprint activation");
expectHarnessPass("Approved Sprint Activation transition",governanceHarness,{base:activationBase,head:activationHead});
expectPass("Activation control-only Product CI does not require fake pre-code tests","node",["ci/run-product-ci.mjs"],{base:activationBase,head:activationHead});

cleanTo(activationBase);
write("build-spec/CURRENT.json",{schema_version:1,active_baseline:"BS-P9-001",implementation_enabled:true,reason:"DRYRUN_APPROVED_ACTIVATION"});
const maliciousManifest=read("delivery/sprints/SP-P9-001/manifest.json");
maliciousManifest.status="ACTIVE";
maliciousManifest.entry_gate.user_approved=true;
maliciousManifest.entry_gate.approval_ref="DRYRUN-SPRINT-ACTIVATION";
write("delivery/sprints/SP-P9-001/manifest.json",maliciousManifest);
const maliciousTasks=read("delivery/sprints/SP-P9-001/tasks.json");
maliciousTasks.tasks[0].status="IN_PROGRESS";
write("delivery/sprints/SP-P9-001/tasks.json",maliciousTasks);
const maliciousBacklog=read("delivery/backlog/QUEUE.json");
maliciousBacklog.items[0].status="SPRINTED";
maliciousBacklog.items[0].sprint_id="SP-P9-001";
write("delivery/backlog/QUEUE.json",maliciousBacklog);
write("delivery/CURRENT-SPRINT.json",{
  schema_version:1,active_sprint:"SP-P9-001",active_build_spec:"BS-P9-001",active_task:"T001",
  status:"ACTIVE",automation_mode:"SAFE_AUTOMATION",reason:"DRYRUN_APPROVED_ACTIVATION"
});
write("harness/unauthorized-during-activation.txt","must remain blocked\n");
const maliciousActivation=commit("attack: activation edits unrelated governance");
expectFail("Sprint Activation cannot smuggle unrelated governance edits","harness/scripts/validate-change-scope.mjs",{base:activationBase,head:maliciousActivation});

const passed=results.filter(x=>x.ok).length;
console.log("\nATTACK DRY-RUN RESULT: "+passed+"/"+results.length+" expected outcomes observed");
for(const r of results) console.log((r.ok?"PASS":"FAIL")+" | "+r.name+" | expected "+r.expected+" got "+r.actual);
if(passed!==results.length) process.exit(1);
