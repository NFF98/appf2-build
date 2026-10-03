import fs from "node:fs";
import { spawnSync, execFileSync } from "node:child_process";

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
  console.log("PRODUCT CI: HOLD — implementation not enabled.");
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
