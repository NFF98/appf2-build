#!/usr/bin/env node
// H3 Host-wide connector probe: READ-ONLY policy inventory + explicit NOT_PROVEN markers.
// Never mutates GitHub. Never sets directConnectorPrewriteProven=true.
import fs from "node:fs";
import {spawnSync} from "node:child_process";

const repo=process.env.GITHUB_REPOSITORY||"NFF98/appf2-build";
const out=process.argv.includes("--out")?
  process.argv[process.argv.indexOf("--out")+1]:
  "delivery/audits/16P-HOST-CONNECTOR-PROBE-LOCAL.json";

const run=(args)=>{
  const r=spawnSync("gh",["api",...args],{encoding:"utf8",timeout:60000,maxBuffer:8000000});
  return {exit:r.status,stdout:r.stdout||"",stderr:(r.stderr||"").slice(-2000)};
};
const parse=s=>{try{return JSON.parse(s);}catch{return null;}};

const mainRuleset=run([`repos/${repo}/rulesets/23969502`]);
const designRuleset=run([`repos/${repo}/rulesets/25298230`]);
const env=run([`repos/${repo}/environments/appf2-task-human-approval`]);
const mainRulesetJson=parse(mainRuleset.stdout);
const designRulesetJson=parse(designRuleset.stdout);
const envJson=parse(env.stdout);

const report={
  schema:"APPF2-16P-HOST-CONNECTOR-PROBE-1",
  generated_at_unix:Math.floor(Date.now()/1000),
  repo,
  write_performed:false,
  mutating_probes_executed:false,
  harness_rejection:{
    status:"SEPARATE_EVIDENCE",
    note:"Use guarded-github-write.mjs apply=false / #407 BLOCK_* receipts; harness≠host-wide"
  },
  host_wide_forced_protection:{
    status:"NOT_PROVEN",
    reason:[
      "Protected branch Ruleset does not intercept raw pull-request create",
      "No host connector prewrite attestation collected in this probe",
      "directConnectorPrewriteProven remains false by policy"
    ],
    directConnectorPrewriteProven:false
  },
  readonly_inventory:{
    main_ruleset:{
      http_ok:mainRuleset.exit===0,
      current_user_can_bypass:mainRulesetJson?.current_user_can_bypass??null,
      bypass_actors_len:Array.isArray(mainRulesetJson?.bypass_actors)?mainRulesetJson.bypass_actors.length:null
    },
    design_ruleset:{
      http_ok:designRuleset.exit===0,
      current_user_can_bypass:designRulesetJson?.current_user_can_bypass??null
    },
    human_approval_environment:{
      http_ok:env.exit===0,
      name:envJson?.name??null,
      protection_rules_len:Array.isArray(envJson?.protection_rules)?envJson.protection_rules.length:null
    }
  },
  required_before_flag_true:[
    "Human-supervised host connector that invokes guarded prewrite on every mutating GitHub path",
    "Live denial with write_performed=false outside harness-only path",
    "ITEM_OPERATION_EVIDENCE + independent host policy attestation (API denial alone insufficient)",
    "Separate Human exact-candidate approval to wire proof into 16p-real-e2e.mjs"
  ],
  unsafe_forbidden:[
    "Open real PR to test protection",
    "Push branch to trigger ruleset",
    "Flip directConnectorPrewriteProven to true",
    "Forge interception receipts"
  ]
};

fs.mkdirSync(out.replace(/[^/\\]+$/,""),{recursive:true});
fs.writeFileSync(out,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({ok:true,out,host_wide:report.host_wide_forced_protection.status,
  directConnectorPrewriteProven:false,write_performed:false},null,2));
process.exitCode=0;
