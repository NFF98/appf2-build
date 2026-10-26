import fs from "node:fs";
import { spawnSync, execFileSync } from "node:child_process";
import { isExactT005PercentGovernanceRepair, T005_PERCENT_GATE_MARKER } from "../harness/scripts/t005-percent-test-compat.mjs";

const current=JSON.parse(fs.readFileSync("build-spec/CURRENT.json","utf8"));
const sprint=JSON.parse(fs.readFileSync("delivery/CURRENT-SPRINT.json","utf8"));
const policy=JSON.parse(fs.readFileSync("ci/policy.json","utf8"));
const pkg=JSON.parse(fs.readFileSync("package.json","utf8"));

const npmExecPath=process.env.npm_execpath;
const runNpmScript=script=>spawnSync(
  npmExecPath?process.execPath:"npm",
  npmExecPath?[npmExecPath,"run",script]:["run",script],
  {stdio:"inherit",shell:false,env:process.env}
);

if(!current.implementation_enabled){
  // Sprint 3.5 product RECOVERY work must execute real local tests even when
  // historical Sprint state remains HOLD. This does not claim Sprint ACTIVE,
  // waive npm run gate, or substitute fixture tests for live Cloudflare/PG/AI.
  const base=process.env.BASE_SHA,head=process.env.HEAD_SHA||"HEAD";
  let changed=[];
  try{
    if(base && /^[0-9a-f]{40}$/.test(base))
      changed=execFileSync("git",["diff","--name-only",base,head],{encoding:"utf8"}).trim().split("\n").filter(Boolean);
  }catch{ changed=[]; }
  const allowed=(p)=>
    ["src/edge/","src/app/","src/platform/compiler/","src/platform/blueprint/","src/platform/runtime/","tests/api/","tests/e2e/","tests/runtime/"].some(prefix=>p.startsWith(prefix)) ||
    ["tooling/web/vite.config.ts","tooling/web/worker-origin.ts","deploy/scripts/sp35-staging-only.mjs","deploy/scripts/sp35-staging-smoke.mjs",
      "deploy/scripts/sp35-staging-live-create.mjs","deploy/scripts/sp35-staging-browser-e2e.mjs",
      ".github/workflows/sp35-staging-only.yml",".gitignore","ci/run-product-ci.mjs",
      "harness/scripts/run-task-human-grant-preflight.sh",
      "harness/scripts/validate-change-scope.mjs",
      "harness/scripts/validate-constitutional-change.mjs"].includes(p);
  const sp35=base==="04e44228354a659c3742c8666316bc42aa455aba" &&
    sprint.status==="HOLD" && sprint.active_sprint===null && current.active_baseline==="BS-P1-025" &&
    changed.length>0 && changed.includes("tooling/web/vite.config.ts") && changed.every(allowed);
  if(sp35){
    console.log("PRODUCT CI: Sprint 3.5 narrowly bounded HOLD recovery — running product tests, NOT live E2E");
    for(const script of ["check:types","check:lint","build","test:api","test:runtime"]){
      console.log("\n> npm run "+script);
      const r=runNpmScript(script);
      if(r.status!==0) process.exit(r.status||1);
    }
    console.log("PRODUCT CI: SP35 RECOVERY TESTS PASS (NOT full live Worker/AI/PostgreSQL)");
    process.exit(0);
  }
  console.log("PRODUCT CI: HOLD — implementation not enabled; Product CI NOT_RUN.");
  process.exit(0);
}

const base=process.env.BASE_SHA, head=process.env.HEAD_SHA||"HEAD";
const baseValid=Boolean(base) && !/^0+$/.test(base) && (()=>{
  try{execFileSync("git",["rev-parse","--verify","--quiet",base+"^{commit}"],{stdio:"ignore"});return true;}
  catch{return false;}
})();
let changed=[];
if(baseValid){
  try{changed=execFileSync("git",["diff","--name-only",base,head],{encoding:"utf8"}).trim().split("\n").filter(Boolean);}
  catch{changed=[];}
}
// Exact BS-P1-025 governance-repair candidate: no implementation/test files changed.
// This is NOT a T006 Product test PASS. Confirm with the existing independent
// scope gate (which also checks Task immutability) before marking this step N/A.
const t006GovBase="67cd2217c7b94cc564c5e730aa03227c2085fb31";
const t006GovPaths=new Set([
  "ci/run-product-ci.mjs",
  "delivery/constitutional-cases/GOV-T006-R2-MAINT-001.json",
  "delivery/sprints/SP-P1-003/tasks.json",
  "harness/scripts/validate-backlog.mjs",
  "harness/scripts/validate-change-scope.mjs"
]);
const t006GovMarker="Exact T006 R2 F00 fixture rebind + lint repair recognized";
const isT006GovOnly=baseValid && base===t006GovBase &&
  changed.length===t006GovPaths.size && changed.every(p=>t006GovPaths.has(p)) &&
  current.active_baseline==="BS-P1-025" && sprint.active_sprint==="SP-P1-003" &&
  sprint.active_task==="T006" && sprint.status==="ACTIVE";
if(isT006GovOnly){
  const scope=spawnSync("node",["harness/scripts/validate-change-scope.mjs"],{
    encoding:"utf8",shell:false,env:{...process.env,BASE_SHA:base,HEAD_SHA:head}
  });
  if(scope.stdout) process.stdout.write(scope.stdout);
  if(scope.stderr) process.stderr.write(scope.stderr);
  if(scope.status!==0 || !scope.stdout.includes(t006GovMarker)){
    console.error("PRODUCT CI: FAIL — T006 governance-only candidate rejected by independent scope gate.");
    process.exit(1);
  }
  console.log("PRODUCT CI: GOVERNANCE-ONLY N/A (NOT PASS) — no Product or test files changed; all nine T006 acceptance tests remain unverified in this PR.");
  process.exit(0);
}


// Exact one-time GOV-T006-F06-PHASED-001 P0 governance-only Product CI branch.
// This is N/A (NOT product PASS): real mapped T006 tests remain owned by unmerged PR #374.
// All original governance, constitution, scope, lint, attack and CodeQL gates stay enforced.
const p0GovBase="3c6eb63a009a515d9fa1038ad5cd1a81908469f6";
const p0GovFiles=new Set([
  "ci/run-product-ci.mjs",
  "delivery/constitutional-cases/GOV-T006-F06-PHASED-001.json",
  "harness/scripts/validate-backlog.mjs",
  "harness/scripts/validate-change-scope.mjs",
  "harness/scripts/validate-sprint.mjs"
]);
const p0GovScopeMarker="Exact Human-approved P0 scope candidate recognized";
const matchesP0GovOnlyShape=({base,changed,build,sprint})=>
  base===p0GovBase && changed.length===p0GovFiles.size &&
  new Set(changed).size===p0GovFiles.size && changed.every(p=>p0GovFiles.has(p)) &&
  build.active_baseline==="BS-P1-025" && build.implementation_enabled===true &&
  sprint.active_sprint==="SP-P1-003" && sprint.active_task==="T006" &&
  sprint.active_build_spec==="BS-P1-025" && sprint.status==="ACTIVE";
const testP0GovOnlyShape=()=>{
  const f=()=>({
    base:p0GovBase,changed:[...p0GovFiles],
    build:{active_baseline:"BS-P1-025",implementation_enabled:true},
    sprint:{active_sprint:"SP-P1-003",active_task:"T006",active_build_spec:"BS-P1-025",status:"ACTIVE"}
  });
  const cases=[
    ["exact P0-only diff",true,x=>x],
    ["another base",false,x=>{x.base="a".repeat(40);return x;}],
    ["product smuggling",false,x=>{x.changed.push("src/app/shell/App.tsx");return x;}],
    ["test smuggling",false,x=>{x.changed.push("tests/e2e/fake.spec.ts");return x;}],
    ["missing docket",false,x=>{x.changed=x.changed.filter(p=>!p.startsWith("delivery/constitutional-cases/"));return x;}],
    ["duplicate changed file",false,x=>{x.changed[0]=x.changed[1];return x;}],
    ["wrong baseline",false,x=>{x.build.active_baseline="BS-P1-026";return x;}],
    ["inactive implementation",false,x=>{x.build.implementation_enabled=false;return x;}],
    ["wrong task",false,x=>{x.sprint.active_task="T008";return x;}],
    ["blocked sprint",false,x=>{x.sprint.status="BLOCKED";return x;}],
    ["wrong sprint baseline",false,x=>{x.sprint.active_build_spec="BS-P1-024";return x;}]
  ];
  for(const [label,expected,mutate] of cases){
    if(matchesP0GovOnlyShape(mutate(f()))!==expected) throw Error("P0 Product CI one-shot shape regression: "+label);
  }
  return cases.length;
};
console.log("- P0 governance-only Product CI exact-shape negative tests: "+testP0GovOnlyShape()+"/11 PASS (synthetic, not Product PASS).");
if(baseValid && matchesP0GovOnlyShape({base,changed,build:current,sprint})){
  // Require the already-present fail-closed scope validator to verify the exact
  // Human case, digest of all four protected rule files, unchanged controls, and paths.
  const guard=spawnSync("node",["harness/scripts/validate-change-scope.mjs"],{
    encoding:"utf8",shell:false,env:{...process.env,BASE_SHA:base,HEAD_SHA:head}
  });
  if(guard.stdout) process.stdout.write(guard.stdout);
  if(guard.stderr) process.stderr.write(guard.stderr);
  if(guard.status!==0 || !guard.stdout.includes(p0GovScopeMarker)){
    console.error("PRODUCT CI: FAIL — P0 exact constitutional governance-only approval/scope not recognized.");
    process.exit(1);
  }
  console.log("PRODUCT CI: GOVERNANCE-ONLY N/A (NOT PASS) — exact approved P0 rule changes only; T006's nine executable Product tests not present or claimed here. PR #374 needs its own Product CI.");
  process.exit(0);
}

// GOV-T006-BS026-FREEZE-001: one-time, exact L3 administrative amendment only.
// This is a Product CI N/A, NOT test PASS; #374 owns executable T006 tests.
// Require independent constitutional and scope gates to validate actual Human
// exact candidate approval, same source bytes, unchanged Sprint and Build state.
const bs026GovBase="c596a657a31d843df070bdfdfed84cc8dc6d7c20";
const bs026GovOnlyPaths=new Set([
  "ci/run-product-ci.mjs",
  "delivery/constitutional-cases/GOV-T006-BS026-FREEZE-001.json",
  "harness/scripts/validate-change-scope.mjs"
]);
const bs026GovMarker="Exact Human-approved BS026 narrow L3 rule amendment recognized";
const matchesBs026GovShape=({base,changed,current,sprint})=>[
  base===bs026GovBase,
  changed.length===bs026GovOnlyPaths.size,
  new Set(changed).size===bs026GovOnlyPaths.size,
  changed.every(p=>bs026GovOnlyPaths.has(p)),
  current?.active_baseline==="BS-P1-025",
  current?.implementation_enabled===true,
  sprint?.active_sprint==="SP-P1-003",
  sprint?.active_task==="T006",
  sprint?.active_build_spec==="BS-P1-025",
  sprint?.status==="ACTIVE"
].every(Boolean);
const testBs026GovShape=()=>{
  const build={active_baseline:"BS-P1-025",implementation_enabled:true};
  const sp={active_sprint:"SP-P1-003",active_task:"T006",active_build_spec:"BS-P1-025",status:"ACTIVE"};
  const mk=()=>({base:bs026GovBase,changed:[...bs026GovOnlyPaths],current:{...build},sprint:{...sp}});
  const cases=[
    ["exact one-time governance path",true,x=>x],
    ["wrong base",false,x=>{x.base="a".repeat(40);return x;}],
    ["missing docket",false,x=>{x.changed.pop();return x;}],
    ["extra Product file",false,x=>{x.changed.push("src/app/fake.tsx");return x;}],
    ["extra Product TEST",false,x=>{x.changed.push("tests/e2e/fake.spec.ts");return x;}],
    ["duplicate file",false,x=>{x.changed[0]=x.changed[1];return x;}],
    ["wrong baseline",false,x=>{x.current.active_baseline="BS-P1-026";return x;}],
    ["disabled implementation",false,x=>{x.current.implementation_enabled=false;return x;}],
    ["wrong Task",false,x=>{x.sprint.active_task="T008";return x;}],
    ["BLOCKED Sprint",false,x=>{x.sprint.status="BLOCKED";return x;}],
    ["wrong Sprint",false,x=>{x.sprint.active_sprint="SP-P1-004";return x;}],
    ["wrong Sprint Build",false,x=>{x.sprint.active_build_spec="BS-P1-024";return x;}]
  ];
  for(const [name,want,change] of cases)
    if(matchesBs026GovShape(change(mk()))!==want) throw Error("BS026 governance-only CI shape regression: "+name);
  return cases.length;
};
console.log("- BS026 governance-only CI shape synthetic: "+testBs026GovShape()+"/12 PASS (NOT Product PASS).");
if(baseValid && matchesBs026GovShape({base,changed,current,sprint})){
  const scope=spawnSync("node",["harness/scripts/validate-change-scope.mjs"],{
    encoding:"utf8",shell:false,env:{...process.env,BASE_SHA:base,HEAD_SHA:head}
  });
  if(scope.stdout) process.stdout.write(scope.stdout);
  if(scope.stderr) process.stderr.write(scope.stderr);
  if(scope.status!==0 || !scope.stdout.includes(bs026GovMarker)){
    console.error("PRODUCT CI: FAIL — BS026 one-shot L3 approval / exact diff not accepted by scope gate.");
    process.exit(1);
  }
  console.log("PRODUCT CI: GOVERNANCE-ONLY N/A (NOT PASS) — exact approved #379 L3 rule amendment only. T006 nine mapped tests remain unexecuted in this PR, and no product proof is waived.");
  process.exit(0);
}

const activationRecordPath=current.active_baseline?"build-spec/activations/"+current.active_baseline+".json":null;
const controlPaths=new Set([
  "build-spec/CURRENT.json",
  "delivery/CURRENT-SPRINT.json",
  "delivery/backlog/QUEUE.json",
  ...(sprint.active_sprint?["delivery/sprints/"+sprint.active_sprint+"/manifest.json","delivery/sprints/"+sprint.active_sprint+"/tasks.json"]:[]),
  ...(activationRecordPath?[activationRecordPath]:[])
]);
if(policy.activation_control_only_skip_product_ci===true && changed.length && changed.every(p=>controlPaths.has(p))){
  console.log("PRODUCT CI: CONTROL-ONLY — governance gates validate activation/task-state transition; no product code changed.");
  process.exit(0);
}

// Only the Human-approved, byte-exact T004 TEST-F00-003 / T005 progress compatibility repair.
// T005 executable implementation tests are NOT claimed complete; this skip cannot match future
// implementation diffs or any base after the one obsolete assertion was removed.
if(isExactT005PercentGovernanceRepair({base,head,changed,current:sprint,build:current})){
  const guard=spawnSync("node",["harness/scripts/validate-change-scope.mjs"],{
    encoding:"utf8",shell:false,env:{...process.env,BASE_SHA:base,HEAD_SHA:head}
  });
  if(guard.stdout) process.stdout.write(guard.stdout);
  if(guard.stderr) process.stderr.write(guard.stderr);
  if(guard.status===0 && guard.stdout.includes(T005_PERCENT_GATE_MARKER)){
    console.log("PRODUCT CI: ONE-SHOT CONTROLLED REPAIR ONLY — T005 implementation 10 mapped tests still NOT IMPLEMENTED; no product code changed.");
    process.exit(0);
  }
  console.error("PRODUCT CI: bounded T005 repair did not pass independent change-scope gate.");
  process.exit(1);
}

// Atomic rebaseline Activation may also carry Delta/Finding lifecycle side effects. Their legality is owned
// exclusively by validate-change-scope.mjs; Product CI only checks the diff shape and requires that gate to PASS.
const lifecyclePathPattern=/^delivery\/(?:deltas\/BD|findings\/BF)-\d{3,}\.json$/;
// Must match the recognition line printed by harness/scripts/validate-change-scope.mjs.
const rebaselineRecognizedMarker="Human-approved rebaseline control transition recognized";
const isLifecyclePath=p=>lifecyclePathPattern.test(p);
const isAtomicActivationShape=()=>{
  if(policy.activation_control_only_skip_product_ci!==true || !baseValid || !changed.length) return false;
  if(!changed.some(isLifecyclePath) || !changed.every(p=>controlPaths.has(p) || isLifecyclePath(p))) return false;
  return Boolean(activationRecordPath) && changed.includes(activationRecordPath) && changed.includes("build-spec/CURRENT.json");
};
const activeBaselineSwitched=()=>{
  try{
    const baseCurrent=JSON.parse(execFileSync("git",["show",base+":build-spec/CURRENT.json"],{encoding:"utf8"}));
    return Boolean(baseCurrent?.active_baseline) && baseCurrent.active_baseline!==current.active_baseline;
  }catch{return false;}
};
const changeScopeApprovesRebaseline=()=>{
  console.log("\n> change scope authority for atomic rebaseline Activation");
  const scope=spawnSync("node",["harness/scripts/validate-change-scope.mjs"],{encoding:"utf8",shell:false,env:{...process.env,BASE_SHA:base,HEAD_SHA:head}});
  if(scope.stdout) process.stdout.write(scope.stdout);
  if(scope.stderr) process.stderr.write(scope.stderr);
  if(scope.status===0 && scope.stdout.includes(rebaselineRecognizedMarker)) return true;
  console.log("PRODUCT CI: atomic rebaseline Activation not approved by change scope gate; enforcing active Task.");
  return false;
};
if(isAtomicActivationShape() && activeBaselineSwitched() && changeScopeApprovesRebaseline()){
  console.log("PRODUCT CI: CONTROL-ONLY — atomic rebaseline Activation; change scope gate approved Delta/Finding lifecycle side effects; no product code changed.");
  process.exit(0);
}

if(policy.lockfile_required_when_implementation_enabled && !fs.existsSync("package-lock.json")){
  console.error("PRODUCT CI: FAIL\n- package-lock.json is required on the first implementation change and thereafter.");
  process.exit(1);
}
if(!sprint.active_sprint || !sprint.active_task){
  console.error("PRODUCT CI: FAIL\n- implementation_enabled requires active Sprint + active Task.");
  process.exit(1);
}
const tasks=JSON.parse(fs.readFileSync("delivery/sprints/"+sprint.active_sprint+"/tasks.json","utf8")).tasks||[];
const task=tasks.find(t=>t.task_id===sprint.active_task);
if(!task){console.error("PRODUCT CI: FAIL\n- active Task not found.");process.exit(1);}

const taskScripts=[];
for(const cmd of task.required_commands||[]){
  const m=/^npm run ([A-Za-z0-9:_-]+)$/.exec(cmd);
  if(!m){console.error("PRODUCT CI: FAIL\n- Invalid Task command: "+cmd);process.exit(1);}
  taskScripts.push(m[1]);
}
const scripts=[...new Set([...(policy.required_on_every_implementation_change||[]),...taskScripts])];
const missing=scripts.filter(s=>!pkg.scripts?.[s]);
if(missing.length){
  console.error("PRODUCT CI: FAIL");
  missing.forEach(s=>console.error("- Missing required npm script: "+s));
  process.exit(1);
}

console.log("\n> executable mapped Test integrity");
let r=spawnSync("node",["harness/scripts/validate-test-integrity.mjs"],{stdio:"inherit",shell:false,env:{...process.env,REQUIRE_ACTIVE_TASK_TESTS:"1"}});
if(r.status!==0) process.exit(r.status||1);

for(const script of scripts){
  console.log("\n> npm run "+script);
  r=runNpmScript(script);
  if(r.status!==0) process.exit(r.status||1);
}
console.log("PRODUCT CI: PASS");
