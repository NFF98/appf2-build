// GOV-REFORM-20261013: conservative impacted-test selection for the Draft fast loop.
// Unknown or shared paths fall back to the full suite. Unselected families are
// reported NOT_RUN; a fast-loop result is never a full-gate PASS.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { matchesPathRule, GOVERNANCE_REFORM_POLICY_PATH } from "./human-exception.mjs";

const matchesAny=(p,rules)=>(rules||[]).some(r=>matchesPathRule(p,r));

export function selectImpactedTests(changed,cfg){
  if(!changed.length) return {mode:"NO_CHANGE",scripts:[],not_run:[...cfg.full_suite],reasons:["no diff"]};
  const selected=new Set(),reasons=[];
  let full=false,code=false;
  for(const p of changed){
    if(matchesAny(p,cfg.full_fallback_prefixes)){full=true;reasons.push("shared/tooling path -> full suite: "+p);continue;}
    const rules=cfg.rules.filter(r=>p.startsWith(r.prefix));
    if(rules.length){
      code=true;
      for(const r of rules) for(const s of r.scripts) selected.add(s);
      continue;
    }
    if(matchesAny(p,cfg.gate_only_prefixes)) continue;
    full=true;reasons.push("unmapped path -> full suite: "+p);
  }
  if(full) return {mode:"FULL_FALLBACK",scripts:[...cfg.full_suite],not_run:[],reasons};
  if(!code) return {mode:"GATE_ONLY",scripts:["check:lint"],not_run:cfg.full_suite.filter(s=>s!=="check:lint"),reasons:["governance/docs only; governance workflow runs npm run gate"]};
  for(const s of cfg.always_on_code_change) selected.add(s);
  const scripts=cfg.full_suite.filter(s=>selected.has(s));
  return {mode:"IMPACTED",scripts,not_run:cfg.full_suite.filter(s=>!selected.has(s)),reasons};
}

// Every test family below mirrors the locked Vitest/Playwright include patterns and
// the existing package.json test:<family> command. Missing directories or changed
// npm commands FAIL CLOSED. An existing directory without matching tests is NOT_RUN,
// never treated as a passing test. All other selected scripts still execute.
const SUITES=Object.freeze({
  "test:unit":["unit","vitest run tests/unit","vitest"],
  "test:contract":["contract","vitest run tests/contract","vitest"],
  "test:behavior":["behavior","vitest run tests/behavior","vitest"],
  "test:api":["api","vitest run tests/api","vitest"],
  "test:runtime":["runtime","vitest run tests/runtime","vitest"],
  "test:state-machine":["state-machine","vitest run tests/state-machine","vitest"],
  "test:regression":["regression","vitest run tests/regression","vitest"],
  "test:e2e":["e2e","playwright test tests/e2e","playwright"],
  "test:a11y":["accessibility","playwright test tests/accessibility","playwright"],
  "test:responsive":["responsive","playwright test tests/responsive","playwright"],
  "test:visual":["visual","playwright test tests/visual","playwright"]
});
const isTestFile=(filename,runner)=>runner==="vitest"?
  /\.(?:test|spec)\.(?:ts|tsx)$/.test(filename):/\.spec\.ts$/.test(filename);
const testFileCount=(root,dir,runner)=>{
  const folder=path.join(root,"tests",dir);
  if(!fs.existsSync(folder)||!fs.statSync(folder).isDirectory())
    throw Error("FAST-LOOP: FAIL — expected test directory missing: "+folder);
  let count=0;
  const walk=where=>{
    for(const item of fs.readdirSync(where,{withFileTypes:true})){
      if(item.isDirectory()) walk(path.join(where,item.name));
      else if(item.isFile() && isTestFile(item.name,runner)) count++;
    }
  };
  walk(folder);
  return count;
};
const suiteCount=(script,pkg,root,inventory=testFileCount)=>{
  if(!script.startsWith("test:")) return null;
  const spec=SUITES[script];
  if(!spec) throw Error("FAST-LOOP: FAIL — unmapped test family: "+script);
  const [dir,command,runner]=spec;
  if(pkg.scripts?.[script]!==command)
    throw Error("FAST-LOOP: FAIL — test command changed; update inventory policy: "+script);
  return {directory:"tests/"+dir,files:inventory(root,dir,runner)};
};
export const resolveRunnablePlan=(plan,pkg,root=".",inventory=testFileCount)=>{
  // Validate ALL selected npm commands before classifying any as NOT_RUN.
  const missing=plan.scripts.filter(s=>!pkg.scripts?.[s]);
  if(missing.length) throw Error("FAST-LOOP: FAIL — missing npm scripts: "+missing.join(", "));
  const scripts=[],absent=[];
  for(const script of plan.scripts){
    const suite=suiteCount(script,pkg,root,inventory);
    if(suite?.files===0) absent.push({script,...suite,status:"NOT_RUN_NO_TEST_FILES"});
    else scripts.push(script);
  }
  return {...plan,scripts,not_run:[...new Set([...plan.not_run,...absent.map(x=>x.script)])],
    absent_suites:absent};
};
const selectionSelfTest=()=>{
  const cfg={scripts:{"test:unit":"vitest run tests/unit",
    "test:state-machine":"vitest run tests/state-machine",
    "test:a11y":"playwright test tests/accessibility","check:lint":"eslint ."}};
  const plan={mode:"FULL_FALLBACK",scripts:["check:lint","test:unit","test:state-machine","test:a11y"],
    not_run:[],reasons:[]};
  const inventory=(_root,dir)=>dir==="unit"?2:0;
  const r=resolveRunnablePlan(plan,cfg,".",inventory);
  assert.deepEqual(r.scripts,["check:lint","test:unit"]);
  assert.deepEqual(r.not_run,["test:state-machine","test:a11y"]);
  assert.equal(r.absent_suites.every(x=>x.status==="NOT_RUN_NO_TEST_FILES"),true);
  assert.throws(()=>resolveRunnablePlan(plan,{scripts:{"check:lint":"eslint ."}},".",inventory),
    /missing npm scripts/);
  assert.throws(()=>resolveRunnablePlan(plan,{scripts:{...cfg.scripts,"test:unit":"echo fake"}},".",inventory),
    /test command changed/);
  assert.equal(isTestFile("README.md","vitest"),false);
  assert.equal(isTestFile("actual.test.ts","vitest"),true);
  assert.equal(isTestFile("actual.spec.ts","playwright"),true);
  assert.equal(isTestFile("README.md","playwright"),false);
  console.log("FAST-LOOP suite inventory regression: PASS (synthetic, not actual test PASS)");
};

const changedFromEnv=()=>{
  const base=process.env.BASE_SHA,head=process.env.HEAD_SHA||"HEAD";
  if(!base || /^0+$/.test(base)) throw Error("BASE_SHA is required for impacted-test selection");
  return execFileSync("git",["diff","--name-only",base,head],{encoding:"utf8"}).trim().split("\n").filter(Boolean);
};

function cli(argv){
  selectionSelfTest();
  if(argv.includes("--selftest")) return 0;
  const cfg=JSON.parse(fs.readFileSync(GOVERNANCE_REFORM_POLICY_PATH,"utf8")).impacted_tests;
  const pkg=JSON.parse(fs.readFileSync("package.json","utf8"));
  // Every real CI invocation audits the complete on-disk test inventory, even
  // when the current PR uses a GATE_ONLY selection. No tests are marked PASS.
  let fullInventory;
  try{
    fullInventory=resolveRunnablePlan({
      mode:"FULL_FALLBACK",scripts:[...cfg.full_suite],not_run:[],reasons:[]
    },pkg);
  }catch(e){console.error(e.message);return 1;}
  console.log("FAST-LOOP FULL INVENTORY: files-backed suites: "+
    fullInventory.scripts.filter(s=>s.startsWith("test:")).join(", "));
  for(const absent of fullInventory.absent_suites)
    console.log("NOT_RUN_NO_TEST_FILES [REAL REPO INVENTORY] | "+absent.script+
      " | "+absent.directory+" | matching files=0; NEVER PASS");
  if(argv.includes("--inventory-only")) return 0;
  let plan;
  try{plan=resolveRunnablePlan(selectImpactedTests(changedFromEnv(),cfg),pkg);}
  catch(e){console.error(e.message);return 1;}
  console.log("FAST-LOOP PLAN: "+plan.mode+" | run: "+(plan.scripts.join(", ")||"-")+
    " | NOT_RUN: "+(plan.not_run.join(", ")||"-"));
  for(const r of plan.reasons) console.log("- "+r);
  for(const suite of plan.absent_suites){
    console.log("NOT_RUN_NO_TEST_FILES | "+suite.script+" | "+suite.directory+
      " | matching test files: 0 (NOT PASS)");
  }
  if(process.env.GITHUB_OUTPUT){
    const needsBrowsers=plan.scripts.some(s=>(cfg.browser_scripts||[]).includes(s));
    fs.appendFileSync(process.env.GITHUB_OUTPUT,
      "mode="+plan.mode+"\nneeds_browsers="+needsBrowsers+"\n");
  }
  if(!argv.includes("--run")) return 0;
  const results=plan.scripts.map(script=>{
    console.log("\n> npm run "+script);
    const r=spawnSync("npm",["run",script],{stdio:"inherit",shell:process.platform==="win32"});
    return {script,status:r.status===0?"PASS":"FAIL"};
  });
  for(const r of results) console.log(r.status+" | "+r.script);
  for(const suite of plan.absent_suites)
    console.log("NOT_RUN_NO_TEST_FILES | "+suite.script+" | "+suite.directory+" | NOT PASS");
  const failed=results.filter(r=>r.status!=="PASS");
  const verdict=failed.length?"FAIL":plan.absent_suites.length?"PASS_WITH_NOT_RUN":"PASS";
  console.log("FAST-LOOP RESULT: "+verdict+" ("+plan.mode+
    "). This is NOT a full-gate PASS; NOT_RUN: "+(plan.not_run.join(", ")||"-"));
  return failed.length?1:0;
}
if(import.meta.url===pathToFileURL(process.argv[1]||"").href) process.exit(cli(process.argv.slice(2)));
