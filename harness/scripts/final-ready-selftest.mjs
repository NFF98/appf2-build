// Synthetic-only regression. No test comment is a real Human/GPT approval.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {inspectPrReadiness,inspectNonPrInvocation,bceCiConsistency,READY_MARKER,READY_SCHEMA,REQUIRED_LOCAL,l1TaskChangedPathsValid,checkReadyPrRunOrigin,inspectTaskPrReadiness,inspectReadyRecheckBinding,inspectReadyRecheckFreshness,mainProductHoldProven,productHoldControlEligible,PRODUCT_HOLD_ENABLEMENT_PATHS} from "./final-ready-preflight.mjs";
const HEAD="a".repeat(40),BASE="b".repeat(40),REPO="NFF98/appf2-build",D="c".repeat(64);
const holdSprint={status:"HOLD",active_sprint:null,active_task:null,active_build_spec:null};
const holdBuild={implementation_enabled:false};
const activeSprint={status:"ACTIVE",active_sprint:"SP-P1-003",active_task:"T008",active_build_spec:"BS-P1-025"};
const enabledBuild={implementation_enabled:true};
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
const requiredNames=["ci","attack","governance","Analyze JavaScript / TypeScript"];
const checks={check_runs:[
  {id:5,name:"fast-loop",head_sha:HEAD,status:"completed",conclusion:"success"},
  ...requiredNames.map((name,i)=>({id:i+10,name,head_sha:HEAD,status:"completed",
    conclusion:"success",app:{slug:"github-actions"}}))
]};
const originProof={ok:true,head:HEAD,base:BASE,pr_number:395,verified_names:requiredNames};
const check=(change={},want=true)=>{
  const x={event,live,comments,checks,changedFiles:[],candidateDigest:D,
    repo:REPO,verifiedPrRunOrigins:originProof,...change};
  assert.equal(inspectPrReadiness(x).ok,want);
};
check();
// L3 exact-HEAD candidate cannot use four green branch-push checks as PR Ready.
// Only the main CLI's authenticated run-by-run provenance receipt is accepted.
check({verifiedPrRunOrigins:null},false);
check({verifiedPrRunOrigins:{...originProof,ok:false}},false);
check({verifiedPrRunOrigins:{...originProof,head:BASE}},false);
check({verifiedPrRunOrigins:{...originProof,base:HEAD}},false);
check({verifiedPrRunOrigins:{...originProof,pr_number:401}},false);
check({verifiedPrRunOrigins:{...originProof,verified_names:["ci","attack","governance"]}},false);
check({checks:{check_runs:checks.check_runs.filter(c=>c.name!=="attack")}},false);
check({checks:{check_runs:checks.check_runs.map(c=>c.name==="attack"?
  {...c,conclusion:"skipped"}:c)}},false);
check({checks:{check_runs:checks.check_runs.map(c=>c.name==="ci"?
  {...c,app:{slug:"forged"}}:c)}},false);
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
// Product HOLD control: Main HOLD proven + PR did not touch enablement paths.
assert.equal(mainProductHoldProven(holdSprint,holdBuild),true);
assert.equal(mainProductHoldProven(activeSprint,holdBuild),false);
assert.equal(mainProductHoldProven(holdSprint,enabledBuild),false);
assert.equal(productHoldControlEligible({changedPaths:["harness/scripts/final-ready-preflight.mjs"],mainSprint:holdSprint,mainBuild:holdBuild}),true);
assert.equal(productHoldControlEligible({changedPaths:[...PRODUCT_HOLD_ENABLEMENT_PATHS],mainSprint:holdSprint,mainBuild:holdBuild}),false);
assert.equal(productHoldControlEligible({changedPaths:["harness/x.mjs"],mainSprint:activeSprint,mainBuild:holdBuild}),false);
const holdLocal={...r("LOCAL_TESTS"),verdict:"CONTROL_GATES_PASS_PRODUCT_NOT_RUN",lock_sha256:D,
  environment:"GitHub-hosted Cloud Evidence under Product HOLD",
  test_runs:REQUIRED_LOCAL.map(command=>({command,
    status:command==="npm run product:ci"?"NOT_RUN":"PASS",
    exit_code:0,log_url:u,log_sha256:D,head_sha:HEAD,base_sha:BASE,node_version:"v22.23.3",
    completed_at:"2026-10-15T00:00:00Z",
    ...(command==="npm run product:ci"?{product_disposition:"HOLD_NOT_RUN"}:{})}))};
const holdBce={...bce,execution_evidence_verdict:"CONTROL_GATES_PASS_PRODUCT_NOT_RUN"};
const holdComments=[mk(holdLocal,1),mk(holdBce,2),mk(human,3)];
const holdGovFiles=[[{filename:"harness/scripts/final-ready-preflight.mjs"},
  {filename:"harness/scripts/final-ready-selftest.mjs"}]];
const holdCheck=(over={},want=true)=>check({comments:holdComments,changedFiles:holdGovFiles,
  mainSprint:holdSprint,mainBuild:holdBuild,...over},want);
holdCheck({},true);
holdCheck({mainSprint:activeSprint},false);
holdCheck({mainBuild:enabledBuild},false);
holdCheck({changedFiles:[[{filename:"build-spec/CURRENT.json"},{filename:"harness/scripts/x.mjs"}]]},false);
holdCheck({changedFiles:[[{filename:"delivery/CURRENT-SPRINT.json"}]]},false);
holdCheck({comments:[mk({...holdLocal,verdict:"PASS"},1),mk(holdBce,2),mk(human,3)]},false);
holdCheck({comments:[mk({...holdLocal,test_runs:holdLocal.test_runs.map(x=>
  x.command==="npm run product:ci"?{...x,product_disposition:undefined}:x)},1),mk(holdBce,2),mk(human,3)]},false);
holdCheck({mainSprint:undefined,mainBuild:undefined},false);
// Forged product:ci PASS under HOLD/NOT_RUN exception must be rejected
// (even with exit_code=0 and/or leftover HOLD_NOT_RUN disposition).
holdCheck({comments:[mk({...holdLocal,test_runs:holdLocal.test_runs.map(x=>
  x.command==="npm run product:ci"
    ?{...x,status:"PASS",exit_code:0,product_disposition:"HOLD_NOT_RUN"}:x)},1),
  mk(holdBce,2),mk(human,3)]},false);
holdCheck({comments:[mk({...holdLocal,test_runs:holdLocal.test_runs.map(x=>
  x.command==="npm run product:ci"
    ?{...x,status:"PASS",exit_code:0,product_disposition:undefined}:x)},1),
  mk(holdBce,2),mk(human,3)]},false);
// Real HOLD / NOT_RUN remains legally admissible (holdCheck({},true) above).
console.log("Product HOLD Main-proven control admission + negatives: PASS (synthetic).");
// Actual canonical repo-policy.json governance roots, not a guessed whitelist.
// Source and destination must both be unprotected in Ready admission.
const l1File=(filename,status="modified",previous_filename)=>({
  filename,status,...(previous_filename===undefined?{}:{previous_filename})});
const l1Cases=[
  [true,[l1File("src/app.ts")]],
  [true,[l1File("tests/flow.test.ts","renamed","tests/old.test.ts")]],
  [true,[l1File("src/new.ts","copied","src/original.ts")]],
  [false,[l1File("src/import.ts","renamed","delivery/CURRENT-SPRINT.json")]],
  [false,[l1File("src/import.ts","copied","harness/scripts/governance-gate.mjs")]],
  [false,[l1File("src/import.ts","renamed","build-spec/CURRENT.json")]],
  [false,[l1File("src/import.ts","renamed","delivery/constitutional-cases/GOV-FAKE.json")]],
  [false,[l1File("src/import.ts","renamed")]],
  [false,[l1File("src/import.ts","copied")]],
  [false,[l1File("src/import.ts","modified","delivery/CURRENT-SPRINT.json")]],
  [false,[l1File("delivery/CURRENT-SPRINT.json","removed")]],
  [false,[l1File("package.json","modified")]],
  [false,[l1File("src/app.ts","invalid")]],
  [false,[{filename:"src/app.ts"}]],
  [false,[]]
];
for(const [expected,files] of l1Cases)
  assert.equal(l1TaskChangedPathsValid(files),expected,"L1 Ready path/source admission regression");
console.log("L1 Ready canonical governance path/rename/copy guard: "+
  l1Cases.length+" PASS (synthetic; not a real Task grant).");
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
// Final Ready must use the SAME authenticated, complete GitHub pagination
// as the trusted protected-Merge executor, rather than Shell's first 100 runs.
const readySource=readFileSync("harness/scripts/final-ready-preflight.mjs","utf8");
const mergeSource=readFileSync("harness/scripts/task-pr-lifecycle.mjs","utf8");
assert.ok(readySource.includes("const {comments,changed,checks}=await readLiveDelegationEvidence(") &&
  readySource.includes("prNumber:live.number,head:live.head?.sha") &&
  mergeSource.includes("fetchCompleteGitHubChecks(") &&
  mergeSource.includes("completeApiInventory({comments,changed,checks})"),
  "Ready and protected Merge must share complete authenticated GitHub evidence");
const readyShell=readFileSync("harness/scripts/run-final-ready-preflight.sh","utf8");
assert.ok(readyShell.includes('check-runs?per_page=100" >"$tmp/checks.json"'),
  "do not expand the Human-authorized 29-path governance scope into the shell");
console.log("Ready/Protected Merge share authenticated complete GitHub pagination: "+
  "PASS (static wiring; live API also checked by Governance, not Human positive E2E).");
// A four-green Push run can list the PR but never substitutes a real
// pull_request full-gate workflow. GitHub REST /actions/runs/{id} is the
// canonical event/source proof; screenshots, client Boolean, and PR comments
// are not.
const checkId=117014179629,prRunId=38913272652;
const runName="ci",jobCheck={id:checkId,name:runName,head_sha:HEAD,
  status:"completed",conclusion:"success",app:{slug:"github-actions"},
  details_url:"https://github.com/NFF98/appf2-build/actions/runs/"+
    prRunId+"/job/"+checkId};
const actualPrRun={id:prRunId,event:"pull_request",head_sha:HEAD,
  status:"completed",conclusion:"success",path:".github/workflows/ci.yml",
  repository:{full_name:REPO},
  pull_requests:[{number:395,head:{sha:HEAD},base:{sha:BASE}}]};
const origin=(patch={},check=jobCheck,name="ci")=>checkReadyPrRunOrigin({
  name,check,run:{...actualPrRun,...patch},head:HEAD,base:BASE,prNumber:395});
assert.equal(origin(),true);
// Real #401: the required ci job SUCCEEDED, yet its parent Workflow FAILED
// because the non-required Final Ready audit depended on its own conclusion.
// Read-only GitHub job identity and result remain the required source of truth.
assert.equal(origin({status:"completed",conclusion:"failure"}),true,
  "Nonrequired audit failure cannot invalidate genuine successful required job");
assert.equal(origin({status:"in_progress",conclusion:null}),true,
  "Ready audit may execute while its own parent CI Workflow remains in progress");
const rejected=[
  {event:"push"},{event:"workflow_dispatch"},{head_sha:BASE},
  {status:"in_progress"},{status:"queued",conclusion:null},
  {conclusion:"skipped"},{conclusion:"cancelled"},
  {path:".github/workflows/attack-dry-run.yml"},
  {repository:{full_name:"other/repo"}},{id:999},
  {pull_requests:[{number:395,head:{sha:BASE},base:{sha:BASE}}]},
  {pull_requests:[{number:395,head:{sha:HEAD},base:{sha:HEAD}}]},
  {pull_requests:[{number:401,head:{sha:HEAD},base:{sha:BASE}}]},
  {pull_requests:[]},{}
];
for(const x of rejected.slice(0,-1))
  assert.equal(origin(x),false,"Fake Ready origin must be denied");
assert.equal(origin({}, {...jobCheck,id:900}),false);
for(const fakeJob of [
  {conclusion:"failure"},{conclusion:"skipped"},{status:"in_progress"},
  {app:{slug:"forged"}},{head_sha:BASE},{name:"fast-loop"}
]) assert.equal(origin({status:"completed",conclusion:"failure"},
  {...jobCheck,...fakeJob}),false,
  "Failed, skipped, wrong-source or running required job never satisfies Ready");
assert.equal(origin({}, {...jobCheck,details_url:
  "https://github.com/forged/appf2-build/actions/runs/"+prRunId+"/job/"+checkId}),false);
assert.equal(origin({}, {...jobCheck,details_url:
  "https://github.com/NFF98/appf2-build/actions/runs/"+prRunId+"/job/9"}),false);
const prOriginMissing=inspectTaskPrReadiness({event,live,comments:[],
  checks:{check_runs:[]},changedFiles:[],candidateDigest:D,repo:REPO,
  verifiedGrant:{ok:true,decision:"VERIFIED_GITHUB_HUMAN_APPROVAL",
    current_head:HEAD}});
assert.ok(prOriginMissing.errors.some(x=>x.includes("Push PASS 不等於 Ready")));
console.log("16P PR-only Required JOB origin: 3 synthetic positive (including failed/ongoing parent workflow), 24 negative PASS; Human positive not verified.");
// GitHub only triggers ready_for_review once. Local/BCE/Human evidence comes
// later, so a read-only, exact-PR recheck is necessary. It must never accept a
// dispatch input as trusted proof of PR identity, Head, branch, or canonical Main.
const liveRecheck={...live,head:{...live.head,ref:"feature"},base:{
  ...live.base,repo:{full_name:REPO}}};
const positiveRecheck={requested:"395",
  event:{inputs:{final_ready_pr_number:"395"}},
  live:liveRecheck,main:{commit:{sha:BASE}},repo:REPO,
  ref:"refs/heads/feature",sha:HEAD};
assert.equal(inspectReadyRecheckBinding(positiveRecheck).ok,true);
const recheckDenied=[
  {requested:"401"},{requested:"not-a-number"},{requested:"000395"},
  {event:{inputs:{final_ready_pr_number:"401"}}},
  {event:{inputs:{}}},
  {repo:"other/appf2-build"},
  {ref:"refs/heads/main"},
  {sha:BASE},
  {live:{...liveRecheck,number:401}},
  {live:{...liveRecheck,draft:true}},
  {live:{...liveRecheck,state:"closed"}},
  {live:{...liveRecheck,head:{...liveRecheck.head,ref:"main"}}},
  {live:{...liveRecheck,head:{...liveRecheck.head,sha:BASE}}},
  {live:{...liveRecheck,head:{...liveRecheck.head,repo:{full_name:"other/repo"}}}},
  {live:{...liveRecheck,base:{...liveRecheck.base,ref:"not-main"}}},
  {live:{...liveRecheck,base:{...liveRecheck.base,repo:{full_name:"other/repo"}}}},
  {live:{...liveRecheck,base:{...liveRecheck.base,sha:HEAD}}},
  {main:{commit:{sha:HEAD}}},
  {main:null}
];
for(const patch of recheckDenied)
  assert.equal(inspectReadyRecheckBinding({...positiveRecheck,...patch}).ok,false,
    "Untrusted dispatch cannot fabricate Ready PR identity");
// Race defense: even after initial authorized binding, the live PR or Main
// may change during GitHub's multiple evidence-page and run-origin reads.
const freshInput={beforeLive:liveRecheck,beforeMain:positiveRecheck.main,
  afterLive:liveRecheck,afterMain:positiveRecheck.main,
  ...positiveRecheck};
assert.equal(inspectReadyRecheckFreshness(freshInput).ok,true);
const staleReadyCases=[
  {afterLive:{...liveRecheck,head:{...liveRecheck.head,sha:BASE}}},
  {afterLive:{...liveRecheck,base:{...liveRecheck.base,sha:HEAD}}},
  {afterLive:{...liveRecheck,head:{...liveRecheck.head,ref:"other-branch"}}},
  {afterLive:{...liveRecheck,base:{...liveRecheck.base,ref:"other"}}},
  {afterLive:{...liveRecheck,draft:true}},
  {afterLive:{...liveRecheck,state:"closed"}},
  {afterLive:{...liveRecheck,number:401}},
  {afterLive:{...liveRecheck,head:{...liveRecheck.head,
    repo:{full_name:"other/repo"}}}},
  {afterMain:{commit:{sha:HEAD}}},
  {afterLive:null},
  {afterMain:null}
];
for(const drift of staleReadyCases)
  assert.equal(inspectReadyRecheckFreshness({...freshInput,...drift}).ok,false,
    "Live changed mid-recheck must HARD STOP");
console.log("Final Ready post-evidence live PR/Main freshness: 1 positive + "+
  staleReadyCases.length+" drift rejections PASS (synthetic).");
console.log("Final Ready delayed evidence recheck: 1 positive + "+
  recheckDenied.length+" synthetic false-ref/Main/identity cases PASS.");
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
console.log("L3 Final Ready four real PR-only Gate origin + 9 negative missing/stale/skip cases: PASS (synthetic; Human authorization not implied).");
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
  assert.ok(source.includes("if: ${{ github.event_name != 'pull_request' && github.ref != 'refs/heads/governance/task-one-approval-20261016' }}"),
    "main push provenance must remain fail-closed: "+file);
  assert.ok(source.includes("run: bash harness/scripts/run-final-ready-preflight.sh"),
    "main push provenance guard missing: "+file);
  assert.ok(!source.includes("- name: Final Ready attestation AFTER real required checks"),
    "post-BCE/Human readiness gate cannot be inside a required check: "+file);
}
const ciGeneric=readFileSync(".github/workflows/ci.yml","utf8");
const ciRequiredJob=ciGeneric.slice(ciGeneric.indexOf("\n  ci:\n"),
  ciGeneric.indexOf("\n  final-ready-audit:\n"));
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

// GitHub job-level permissions replace workflow permissions. A missing
// read grant makes authenticated Final Ready's /actions/runs and /check-runs
// fail at runtime even when all PR checks are actually green. No write scope.
const auditPermissions=finalAuditJob.match(/\n {4}permissions:\n((?: {6}[^\n]+\n)+)/)?.[1]||"";
const actualPermissions=auditPermissions.trim().split("\n").map(line=>line.trim());
for(const name of ["contents","issues","pull-requests","actions","checks"])
  assert.ok(actualPermissions.includes(name+": read"),
    "Final Ready cannot read required GitHub API evidence: "+name);
assert.ok(actualPermissions.every(value=>/^(?:contents|issues|pull-requests|actions|checks): read$/.test(value)),
  "Final Ready must not escalate above read-only permissions");
const workflowPermissions=ciGeneric.match(/^permissions:\n((?: {2}[^\n]+\n)+)/m)?.[1]||"";
assert.ok(workflowPermissions.includes("  actions: read") &&
  workflowPermissions.includes("  checks: read"),
  "CI workflow must allow Actions/Checks read-only evidence");
console.log("Final Ready real Actions/Checks API GitHub token read-only grants: PASS (static).");

// Dispatch recheck must preserve the existing required check. A skipped
// job named "ci" would otherwise invalidate the exact HEAD Ready evidence.
assert.ok(ciGeneric.includes("final_ready_pr_number:") &&
  ciGeneric.includes("workflow_dispatch:") &&
  ciGeneric.includes("'ci-recheck-only-skipped' || 'ci'") &&
  ciGeneric.includes("inputs.final_ready_pr_number == ''"),
  "post-attestation dispatch must not shadow the required ci check");
const recheckJob=ciGeneric.slice(ciGeneric.indexOf("\n  final-ready-recheck:\n"),
  ciGeneric.indexOf("\n  fast-loop:\n"));
assert.ok(recheckJob.includes("github.event_name == 'workflow_dispatch'") &&
  recheckJob.includes("persist-credentials: false") &&
  recheckJob.includes("final-ready-preflight.mjs --recheck-pr") &&
  recheckJob.includes('--event "$GITHUB_EVENT_PATH"') &&
  !recheckJob.includes("needs: ci"),
  "post-attestation audit dispatch may run after evidence without a skipped ci dependency");
for(const permission of ["contents","issues","pull-requests","actions","checks"])
  assert.ok(recheckJob.includes(permission+": read"),
    "recheck must have explicit read-only "+permission);
assert.ok(!recheckJob.includes(": write") && !recheckJob.includes("gh pr merge"),
  "post-attestation audit is not authorized to write or merge");
const cliSource=readFileSync("harness/scripts/final-ready-preflight.mjs","utf8");
assert.ok(cliSource.includes('eventName==="workflow_dispatch" && val("recheck-pr")!==null') &&
  cliSource.includes("inspectReadyRecheckBinding({requested,event,live,main,repo,ref,sha})") &&
  cliSource.includes("inspectReadyWithLiveApi({") &&
  cliSource.includes("inspectReadyRecheckFreshness({") &&
  cliSource.includes('liveReadyApi("/pulls/"+requested,token)') &&
  cliSource.includes('liveReadyApi("/branches/main",token)'),
  "recheck must authenticate PR, Main and branch before reusing production Ready admission");
console.log("Final Ready on-demand actual workflow wiring and no-ci-shadow: PASS (static, not Human E2E).");
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


// GOV-392 structural test-only phase MUST NOT claim Human approval or alter
// protected Main, and is only for the exact candidate BASE/path/byte digest.
for(const wf of [".github/workflows/ci.yml",".github/workflows/governance-gate.yml"]){
  const source=readFileSync(wf,"utf8");
  assert.ok(source.includes("APPF2_GOV16_TEST_PHASE: '1'"),
    "exact test-only lane missing in "+wf);
}
const constitutionalSource=readFileSync("harness/scripts/validate-constitutional-change.mjs","utf8");
const scopeSource=readFileSync("harness/scripts/validate-change-scope.mjs","utf8");
assert.ok(constitutionalSource.includes("isGov392TestOnly") &&
  constitutionalSource.includes("pendingHumanApproval:true") &&
  scopeSource.includes("gov16MissingApprovalOnly") &&
  scopeSource.includes("PENDING_HUMAN_APPROVAL"),
  "test-only must keep exact structural validation without invented Human approval");
