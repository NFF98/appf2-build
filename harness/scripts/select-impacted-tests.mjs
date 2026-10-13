// GOV-REFORM-20261013: conservative impacted-test selection for the Draft fast loop.
// Unknown or shared paths fall back to the full suite. Unselected families are
// reported NOT_RUN; a fast-loop result is never a full-gate PASS.
import fs from "node:fs";
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

const changedFromEnv=()=>{
  const base=process.env.BASE_SHA,head=process.env.HEAD_SHA||"HEAD";
  if(!base || /^0+$/.test(base)) throw Error("BASE_SHA is required for impacted-test selection");
  return execFileSync("git",["diff","--name-only",base,head],{encoding:"utf8"}).trim().split("\n").filter(Boolean);
};

function cli(argv){
  const cfg=JSON.parse(fs.readFileSync(GOVERNANCE_REFORM_POLICY_PATH,"utf8")).impacted_tests;
  const pkg=JSON.parse(fs.readFileSync("package.json","utf8"));
  const plan=selectImpactedTests(changedFromEnv(),cfg);
  const missing=plan.scripts.filter(s=>!pkg.scripts?.[s]);
  console.log("FAST-LOOP PLAN: "+plan.mode+" | run: "+(plan.scripts.join(", ")||"-")+" | NOT_RUN: "+(plan.not_run.join(", ")||"-"));
  for(const r of plan.reasons) console.log("- "+r);
  if(missing.length){console.error("FAST-LOOP: FAIL — missing npm scripts: "+missing.join(", "));return 1;}
  if(process.env.GITHUB_OUTPUT){
    const needsBrowsers=plan.scripts.some(s=>(cfg.browser_scripts||[]).includes(s));
    fs.appendFileSync(process.env.GITHUB_OUTPUT,"mode="+plan.mode+"\nneeds_browsers="+needsBrowsers+"\n");
  }
  if(!argv.includes("--run")) return 0;
  const results=plan.scripts.map(script=>{
    console.log("\n> npm run "+script);
    const r=spawnSync("npm",["run",script],{stdio:"inherit",shell:process.platform==="win32"});
    return {script,status:r.status===0?"PASS":"FAIL"};
  });
  for(const r of results) console.log(r.status+" | "+r.script);
  const failed=results.filter(r=>r.status!=="PASS");
  console.log("FAST-LOOP RESULT: "+(failed.length?"FAIL":"PASS")+" ("+plan.mode+"). This is NOT a full-gate PASS; NOT_RUN: "+(plan.not_run.join(", ")||"-"));
  return failed.length?1:0;
}
if(import.meta.url===pathToFileURL(process.argv[1]||"").href) process.exit(cli(process.argv.slice(2)));
