// GOV-REFORM-20261013: exact 9+6+mid-Sprint wiring inventory.
// This audit checks that an expected executable/CI entry point exists.
// STATIC_WIRED is never labelled END-TO-END-PASS, Human approval or applied Main policy.
import fs from "node:fs";
import path from "node:path";
const EXPECTED=Object.freeze([
 ["1","Task one-PR lifecycle","harness/scripts/task-pr-lifecycle.mjs","DRAFT_DEVELOPMENT"],
 ["2","same lease / no redundant approval","harness/scripts/gpt-preflight.mjs","REDUNDANT_APPROVAL_DENIED"],
 ["3","impacted-test fast loop","harness/scripts/select-impacted-tests.mjs","resolveRunnablePlan"],
 ["4","Activation when authority changes","harness/scripts/task-pr-lifecycle.mjs","requiresActivation"],
 ["5","Rebind only when mappings change","harness/scripts/task-pr-lifecycle.mjs","requiresRebind"],
 ["6","automatic Evidence aggregation report","harness/scripts/evidence-ledger-report.mjs","reportContext"],
 ["7","generic Human procedural exception","harness/scripts/human-exception.mjs","resolveRepoException"],
 ["8","preflight command","harness/scripts/gpt-preflight.mjs","function stateCli"],
 ["9","automated measurement cadence",".github/workflows/governance-metrics.yml","schedule:"],
 ["A","PR proliferation required-check guard",".github/workflows/governance-gate.yml","pr-guard --event"],
 ["B","repeated-approval refusal","harness/scripts/gpt-preflight.mjs","REDUNDANT_APPROVAL_DENIED"],
 ["C","no-test-file NOT_RUN policy","harness/scripts/select-impacted-tests.mjs","NOT_RUN_NO_TEST_FILES"],
 ["D","proof levels with no false PASS","harness/scripts/evidence-ledger.mjs","UNCLASSIFIED"],
 ["E","Evidence aggregation as CI artifact",".github/workflows/governance-gate.yml","task-evidence-ledger"],
 ["F","GPT orchestration preflight","harness/scripts/gpt-preflight.mjs","function stateCli"],
 ["16","Human mid-Sprint rebaseline guard","harness/scripts/validate-activation.mjs","midSprintActivationCovered"]
]);
export function inspectReformWiring(read){
  const checks=EXPECTED.map(([id,label,file,marker])=>{
    const body=read(file);
    return {id,label,file,status:typeof body==="string"&&body.includes(marker)?
      "STATIC_WIRED":"MISSING_OR_UNWIRED"};
  });
  return {checks,errors:checks.filter(c=>c.status!=="STATIC_WIRED")};
}
export function auditReformWiring(root=process.cwd()){
  const result=inspectReformWiring(file=>{
    try{return fs.readFileSync(path.join(root,file),"utf8");}catch{return null;}
  });
  if(result.errors.length)throw Error("REFORM16 WIRING MISSING: "+
    result.errors.map(x=>x.id+" "+x.file).join(", "));
  return result;
}
export function testReformWiring(){
  const source=p=>EXPECTED.filter(x=>x[2]===p).map(x=>x[3]).join("\n")||null;
  const baseline=inspectReformWiring(source);
  if(baseline.errors.length)throw Error("wiring test baseline broken");
  for(const row of EXPECTED){
    const failed=inspectReformWiring(p=>p===row[2]?null:source(p));
    if(!failed.errors.some(e=>e.id===row[0]))throw Error("wiring missing-path attack not caught "+row[0]);
  }
  return EXPECTED.length+1;
}
