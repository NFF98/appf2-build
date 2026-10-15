// Synthetic-only regression. No test comment is a real Human/GPT approval.
import assert from "node:assert/strict";
import {inspectPrReadiness,inspectNonPrInvocation,bceCiConsistency,READY_MARKER,READY_SCHEMA} from "./final-ready-preflight.mjs";
const HEAD="a".repeat(40),BASE="b".repeat(40),REPO="NFF98/appf2-build",D="c".repeat(64);
const u="https://github.com/"+REPO+"/issues/392";
const live={number:395,state:"open",draft:false,head:{sha:HEAD,repo:{full_name:REPO}},base:{sha:BASE,ref:"main"}};
const event={pull_request:{number:395,head:{sha:HEAD},base:{sha:BASE},draft:false}};
const r=(kind)=>({schema:READY_SCHEMA,kind,pr_number:395,head_sha:HEAD,base_sha:BASE,
  verdict:kind==="HUMAN_FINAL_READY"?"APPROVED":"PASS"});
const local={...r("LOCAL_TESTS"),lock_sha256:D,environment:"node v22, npm ci, Linux x64",
  test_runs:["npm ci","npm run check:lint","npm run gate","npm run dry-run:attack",
    "npm run product:ci","node harness/scripts/final-ready-selftest.mjs"].map(command=>({command,status:"PASS",exit_code:0,
      log_url:u,log_sha256:D,node_version:"v22.23.3",completed_at:"2026-10-15T00:00:00Z"}))};
const bce={...r("GPT_BCE"),scope_verdict:"PASS",execution_evidence_verdict:"PASS",
  reviewer_role:"GPT_INDEPENDENT",independent_review_note:"synthetic review not authority",
  review_url:u,review_sha256:D};
const human={...r("HUMAN_FINAL_READY"),decision:"APPROVE_FINAL_INTEGRATION_READY",
  approver:"NFF98",candidate_sha256:D,human_provenance_manual_check_required:true,
  protected_change_acknowledged:true};
const mk=(record,id)=>({id,body:READY_MARKER+"\n"+JSON.stringify(record),user:{login:"NFF98",type:"User"},
  author_association:"OWNER",created_at:"2026-10-15T00:00:00Z",updated_at:"2026-10-15T00:00:00Z"});
const comments=[mk(local,1),mk(bce,2),mk(human,3)];
const checks={check_runs:[{name:"fast-loop",head_sha:HEAD,status:"completed",conclusion:"success"}]};
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
check({checks:{check_runs:[{name:"fast-loop",head_sha:HEAD,status:"completed",conclusion:"skipped"}]}},false);
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
console.log("FINAL READY synthetic positive/negative: PASS (NOT Human approval or real local PASS).");
