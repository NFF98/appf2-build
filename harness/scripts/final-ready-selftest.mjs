// Synthetic-only regression. No test comment is a real Human/GPT approval.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {inspectPrReadiness,inspectNonPrInvocation,bceCiConsistency,READY_MARKER,READY_SCHEMA} from "./final-ready-preflight.mjs";
const HEAD="a".repeat(40),BASE="b".repeat(40),REPO="NFF98/appf2-build",D="c".repeat(64);
const u="https://github.com/"+REPO+"/pull/395#issuecomment-123";
const live={number:395,state:"open",draft:false,head:{sha:HEAD,repo:{full_name:REPO}},base:{sha:BASE,ref:"main"}};
const event={pull_request:{number:395,head:{sha:HEAD},base:{sha:BASE},draft:false}};
const r=(kind)=>({schema:READY_SCHEMA,kind,pr_number:395,head_sha:HEAD,base_sha:BASE,
  verdict:kind==="HUMAN_FINAL_READY"?"APPROVED":"PASS"});
const local={...r("LOCAL_TESTS"),lock_sha256:D,environment:"node v22, npm ci, Linux x64",
  test_runs:["npm ci","npm run check:lint","npm run gate","npm run dry-run:attack",
    "npm run product:ci","node harness/scripts/final-ready-selftest.mjs"].map(command=>({command,status:"PASS",exit_code:0,
      log_url:u,log_sha256:D,head_sha:HEAD,base_sha:BASE,node_version:"v22.23.3",completed_at:"2026-10-15T00:00:00Z"}))};
const bce={...r("GPT_BCE"),scope_verdict:"PASS",execution_evidence_verdict:"PASS",
  reviewer_role:"GPT_INDEPENDENT",independent_review_note:"synthetic review not authority",
  review_url:u,review_sha256:D};
const human={...r("HUMAN_FINAL_READY"),decision:"APPROVE_FINAL_INTEGRATION_READY",
  approver:"NFF98",candidate_sha256:D,human_provenance_manual_check_required:true,
  protected_change_acknowledged:true};
const mk=(record,id)=>({id,body:READY_MARKER+"\n"+JSON.stringify(record),user:{login:"NFF98",type:"User"},
  author_association:"OWNER",created_at:"2026-10-15T00:00:00Z",updated_at:"2026-10-15T00:00:00Z"});
const comments=[mk(local,1),mk(bce,2),mk(human,3)];
const checks={check_runs:[{id:5,name:"fast-loop",head_sha:HEAD,status:"completed",conclusion:"success"}]};
const check=(change={},want=true)=>{const x={event,live,comments,checks,changedFiles:[],candidateDigest:D,repo:REPO,...change};assert.equal(inspectPrReadiness(x).ok,want);};
check();
check({live:{...live,draft:true}},false);
check({event:{pull_request:{...event.pull_request,head:{sha:BASE}}}},false);
check({comments:[]},false);
check({comments:[mk(local,1),mk(human,2)]},false);
check({comments:[mk(local,3),mk(bce,2),mk(human,1)]},false);
check({comments:[mk({...local,head_sha:BASE},1),mk(bce,2),mk(human,3)]},false);
check({comments:[mk({...local,test_runs:local.test_runs.map((x,i)=>i?x:{...x,status:"SKIPPED"})},1),mk(bce,2),mk(human,3)]},false);
check({comments:[mk({...local,test_runs:[]},1),mk(bce,2),mk(human,3)]},false);
check({comments:[mk(local,1),mk({...bce,scope_verdict:"FAIL"},2),mk(human,3)]},false);
check({comments:[mk(local,1),mk(bce,2),mk({...human,decision:"NONE"},3)]},false);
check({comments:[mk(local,1),mk(bce,2),{...mk(human,3),user:{login:"github-actions[bot]",type:"Bot"}}]},false);
check({comments:[mk(local,1),{...mk(bce,2),updated_at:"2026-10-15T01:00:00Z"},mk(human,3)]},false);
check({comments:[mk(local,1),mk(bce,2),mk(human,3),mk(human,4)]},false);
check({changedFiles:[[{filename:".github/workflows/ci.yml"},{filename:"harness/scripts/final-ready-preflight.mjs"}]],
  comments:[mk(local,1),mk(bce,2),mk({...human,protected_change_acknowledged:false},3)]},false);
check({changedFiles:[[{filename:".github/workflows/ci.yml"},{filename:"harness/scripts/final-ready-preflight.mjs"}]]},true);
check({changedFiles:null},false);
check({candidateDigest:"e".repeat(64)},false);
check({comments:[mk(local,1),mk(bce,2),mk({...human,candidate_sha256:"0".repeat(64)},3)]},false);
check({comments:[mk({...local,test_runs:local.test_runs.map((x,i)=>i?x:{...x,log_url:"https://github.com/FAKE/appf2-build/issues/392"})},1),mk(bce,2),mk(human,3)]},false);
check({checks:{check_runs:[{id:5,name:"fast-loop",head_sha:HEAD,status:"completed",conclusion:"skipped"}]}},false);
check({checks:{check_runs:[
  {id:10,name:"fast-loop",head_sha:HEAD,status:"completed",conclusion:"success"},
  {id:11,name:"fast-loop",head_sha:HEAD,status:"completed",conclusion:"failure"}
]}},false);
check({checks:{check_runs:[
  {id:20,name:"fast-loop",head_sha:HEAD,status:"completed",conclusion:"success"},
  {id:21,name:"fast-loop",head_sha:HEAD,status:"in_progress",conclusion:null}
]}},false);
check({comments:[mk({...local,test_runs:local.test_runs.map((x,i)=>i?x:{...x,head_sha:BASE})},1),mk(bce,2),mk(human,3)]},false);
check({comments:[mk({...local,test_runs:local.test_runs.map((x,i)=>i?x:{...x,log_url:"https://github.com/NFF98/appf2-build/issues/392"})},1),mk(bce,2),mk(human,3)]},false);
check({checks:{check_runs:[]}},false);
check({comments:comments.map(x=>({...x,body:"PR body checkbox PASS"}))},false);
check({event:{pull_request:{...event.pull_request,base:null}}},false);
check({comments:[mk({...local,test_runs:[...local.test_runs,{...local.test_runs[0],command:"npm run product:ci",status:"NOT_RUN"}]},1),mk(bce,2),mk(human,3)]},false);
const merged=[{merged_at:"2026-10-15T00:00:00Z",merge_commit_sha:HEAD,base:{ref:"main"}}];
assert.equal(inspectNonPrInvocation({eventName:"push",ref:"refs/heads/main",sha:HEAD,associatedPrs:merged}).ok,true);
assert.equal(inspectNonPrInvocation({eventName:"push",ref:"refs/heads/main",sha:HEAD,associatedPrs:[]}).ok,false);
assert.equal(inspectNonPrInvocation({eventName:"workflow_dispatch",ref:"refs/heads/feature",sha:HEAD}).ok,false);
assert.equal(inspectNonPrInvocation({eventName:"schedule",ref:"refs/heads/main",sha:HEAD}).ok,true);
const required=["ci","attack","governance","Analyze JavaScript / TypeScript"];
const run=(context,conclusion)=>({context,head_sha:HEAD,conclusion,status:"completed",mode:"FULL"});
assert.equal(bceCiConsistency({head:HEAD,checks:required.map(x=>run(x,"success")),required,bcePass:true}).ok,true);
for(const v of ["failure","skipped","neutral"]){
  assert.equal(bceCiConsistency({head:HEAD,checks:required.map((x,i)=>run(x,i?v:"success")),required,bcePass:true}).reason,"BCE_CI_MISMATCH");
}
assert.equal(bceCiConsistency({head:HEAD,checks:[],required,bcePass:true}).reason,"BCE_CI_MISMATCH");
// Verify the real Ready-for-review wiring, not just synthetic inputs. Otherwise
// same-HEAD preflight may deadlock after Draft -> Ready even if evidence exists.
for(const filename of ["ci.yml","codeql.yml","governance-gate.yml","attack-dry-run.yml"]){
  const source=readFileSync(".github/workflows/"+filename,"utf8");
  const triggers=source.match(/^ {2}pull_request:\s*\n((?: {4}[^\n]*\n)*)/m);
  assert.ok(triggers,"missing explicit pull_request trigger: "+filename);
  assert.match(triggers[1],/types:\s*\[[^\]\n]*ready_for_review[^\]\n]*\]/,
    "ready_for_review must trigger required gate: "+filename);
}
const ciWorkflow=readFileSync(".github/workflows/ci.yml","utf8");
assert.match(ciWorkflow,/^ {4}name: \$\{\{[^\n]*'fast-loop'[^\n]*'fast-loop-ready-skipped'[^\n]*\}\}/m,
  "Ready event must not mint a newer skipped check with name fast-loop");
assert.match(ciWorkflow,/^ {4}if: \$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.draft \}\}/m,
  "fast-loop must remain draft-only (not a required full gate)");
console.log("FINAL READY trigger graph and Draft->Ready check-name separation: PASS (static, NOT real full-gate execution).");
console.log("FINAL READY synthetic positive/negative: PASS (NOT Human approval or real local PASS).");

/* The real GitHub workflow MUST run all four security/quality jobs before any
   Human approval. This is a static invariant, not a substitute for execution. */
const requiredWorkflows=[
  ["ci.yml","npm run gate"],
  ["governance-gate.yml","npm run gate"],
  ["attack-dry-run.yml","npm run dry-run:attack"],
  ["codeql.yml","github/codeql-action/analyze@v4"]
];
for(const [file,required] of requiredWorkflows){
  const source=readFileSync(".github/workflows/"+file,"utf8");
  const actual=source.indexOf(required);
  const mainGuard=source.indexOf("- name: Main-only merge provenance guard");
  assert.ok(actual>mainGuard && mainGuard>=0,"mandatory real gate missing or wrong position: "+file);
  assert.ok(source.includes("if: ${{ github.event_name != 'pull_request' }}"),
    "main push provenance must remain fail-closed: "+file);
  assert.ok(source.includes("run: bash harness/scripts/run-final-ready-preflight.sh"),
    "main push provenance guard missing: "+file);
  assert.ok(!source.includes("- name: Final Ready attestation AFTER real required checks"),
    "post-BCE/Human readiness gate cannot be inside a required check: "+file);
}
const ciGeneric=readFileSync(".github/workflows/ci.yml","utf8");
const ciRequiredJob=ciGeneric.slice(ciGeneric.indexOf("\n  ci:\n"),
  ciGeneric.indexOf("\n  fast-loop:\n"));
const cloudEvidenceWorkflow=readFileSync(".github/workflows/cloud-evidence.yml","utf8");
const ciEvidenceJob=cloudEvidenceWorkflow.slice(cloudEvidenceWorkflow.indexOf("\n  cloud-evidence-mirror:\n"));
assert.ok(ciRequiredJob.indexOf("- name: Install locked dependencies")>=0 &&
  ciRequiredJob.indexOf("- name: Repository lint")>ciRequiredJob.indexOf("- name: Install locked dependencies") &&
  ciRequiredJob.indexOf("- name: Product CI")>ciRequiredJob.indexOf("- name: Repository lint") &&
  ciRequiredJob.indexOf("- name: Governance / traceability gates")>ciRequiredJob.indexOf("- name: Product CI"),
  "CI must execute genuine dependency/lint/Product checks before constitutional/governance");
assert.ok(!ciRequiredJob.includes("Final Ready attestation") &&
  !ciRequiredJob.includes("Verify ordered Local tests"),
  "required ci may not depend on post-BCE/Human Final Ready");

const finalAuditJob=ciGeneric.slice(ciGeneric.indexOf("\n  final-ready-audit:\n"),
  ciGeneric.indexOf("\n  fast-loop:\n"));
assert.ok(finalAuditJob.startsWith("\n  final-ready-audit:\n") &&
  finalAuditJob.includes("needs: ci") &&
  finalAuditJob.includes("if: ${{ github.event_name == 'pull_request' && !github.event.pull_request.draft }}") &&
  finalAuditJob.includes("run: bash harness/scripts/run-final-ready-preflight.sh") &&
  !ciEvidenceJob.includes("Verify ordered Local tests"),
  "Human Final Ready attestation must be separate from four required gates and cloud evidence");

assert.ok(!ciGeneric.includes("cloud-evidence-admission:") &&
  !ciGeneric.includes("cloud-evidence-mirror:") &&
  !ciGeneric.includes("ready_for_review, labeled"),
  "required CI cannot re-run for optional evidence labels");
assert.ok(cloudEvidenceWorkflow.includes("cloud-evidence-admission:") &&
  cloudEvidenceWorkflow.includes("cloud-evidence-mirror:") &&
  cloudEvidenceWorkflow.includes("types: [opened, reopened, synchronize, labeled]"),
  "dedicated cloud workflow missing");
assert.ok(cloudEvidenceWorkflow.includes("contains(github.event.pull_request.labels.*.name, 'cloud-evidence')") &&
  cloudEvidenceWorkflow.includes("github.event.label.name == 'cloud-evidence'") &&
  cloudEvidenceWorkflow.includes("persist-credentials: false"),
  "cloud evidence must be opt-in, not rerun for other labels, and read-only");
assert.ok(!cloudEvidenceWorkflow.includes("github.event.pull_request.number == 395"),
  "cloud evidence must not be pinned to PR #395");
const genericRunner=readFileSync("harness/scripts/w1-01-evidence-mirror.mjs","utf8");
assert.ok(genericRunner.includes("Number.isSafeInteger(p.number)") &&
  genericRunner.includes("NOT_REQUIRED_TO_RUN_TESTS") && !genericRunner.includes("p.number===395"),
  "generic cloud runner must accept all same-repository draft PRs");
console.log("Required real GitHub gates are test-first and evidence runner accepts all PRs: PASS (static).");

const evidenceSource=readFileSync("harness/scripts/w1-01-evidence-mirror.mjs","utf8");
assert.ok(evidenceSource.includes('fs.mkdirSync("cloud-evidence"') &&
  evidenceSource.includes('"cloud-evidence/raw-evidence-manifest.json"') &&
  evidenceSource.includes('"cloud-evidence/source.json"') &&
  !evidenceSource.includes('"w1-01-evidence/'),
  "cloud evidence source and manifest must use the same existing directory");
console.log("Cloud evidence artifact paths: PASS (static, NOT real cloud execution).");

const mirrorStatusSource=readFileSync("harness/scripts/w1-01-evidence-mirror.mjs","utf8");
assert.ok(mirrorStatusSource.includes("const stageStatus=") &&
  mirrorStatusSource.includes('stageStatus(command,exit,stdout)') &&
  mirrorStatusSource.includes('INCOMPLETE_NOT_RUN') &&
  mirrorStatusSource.includes("PRODUCT CI: PASS"),
  "cloud evidence must never convert Product HOLD/N/A (exit 0) to Product PASS");
console.log("Cloud Product HOLD/N/A cannot silently become PASS: PASS (static policy assertion).");
assert.ok(mirrorStatusSource.includes("const notRunCommands=") &&
  mirrorStatusSource.includes("m.not_run=notRunCommands(m.stages,jobs.slice(i+1))"),
  "cloud manifest must include completed-but-NOT_RUN Product CI and unexecuted remaining stages");
console.log("Cloud NOT_RUN manifest completeness: PASS (static, NOT actual cloud execution).");

