// 16P #7 bounded GitHub Actions wall-clock integration probe.
// Temporary, synthetic approval-shaped dockets; no real Human grant, no protected mutation.
// This proves actual-clock engine rejection, NOT full provider-protected E2E.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {setTimeout as sleep} from "node:timers/promises";
import {
  HUMAN_EXCEPTION_SCHEMA, findPersistentProceduralWaivers
} from "./human-exception.mjs";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"appf2-16p7-real-clock-"));
const source=path.resolve("harness/policy/governance-reform.json");
const dest=path.join(root,"harness/policy/governance-reform.json");
const folder=path.join(root,"delivery/constitutional-cases");
const receiptDir=path.join(process.env.RUNNER_TEMP||os.tmpdir(),"16p-real-e2e");
fs.mkdirSync(path.dirname(dest),{recursive:true});
fs.mkdirSync(folder,{recursive:true});
fs.mkdirSync(receiptDir,{recursive:true});
fs.copyFileSync(source,dest);
const policy=JSON.parse(fs.readFileSync(dest,"utf8"));
const approvedAt=Math.floor(Date.now()/1000)-10;
const id=(suffix)=>"GOV-16P-LIVE-CLOCK-"+suffix;
const sha256=s=>createHash("sha256").update(s).digest("hex");
const record={
  schema:"APPF2-16P7-LIVE-CLOCK-INTEGRATION-1",
  environment:"GITHUB_ACTIONS_RUNNER_ISOLATED_TEMP_DIRECTORY",
  source_main_sha:process.env.GITHUB_SHA||null,
  started_utc:new Date().toISOString(),
  source:"ACTUAL_WALL_CLOCK_AND_REAL_NODE_FILESYSTEM",
  approval_metadata:"SYNTHETIC_TEST_FIXTURE_NOT_HUMAN_AUTHORIZATION",
  protected_github_provider_acceptance:"NOT_VERIFIED",
  test_docket_merged_to_main:false,
  product_pass_claimed:false,
  stages:[]
};
const assert=(cond,why)=>{if(!cond)throw Error(why)};
const docket=(suffix,expiry)=>({
  case_id:id(suffix),
  candidate_digest_sha256:sha256("isolated-real-clock-fixture:"+suffix),
  human_approval:{
    case_id:id(suffix),
    source_kind:"DIRECT_HUMAN_MESSAGE",
    decision:"APPROVE_EXACT_CANDIDATE",scope:"EXACT_PR_DIFF",
    candidate_digest_sha256:sha256("isolated-real-clock-fixture:"+suffix),
    approver:policy.human_authority_accounts[0],
    human_message_ref:"CI-only intentionally synthetic metadata; NOT a real Human approval",
    approved_at_unix:approvedAt
  },
  scope_exception:{
    schema:HUMAN_EXCEPTION_SCHEMA,lane:"CLOSURE_DEFERRAL",
    affected_tasks:["T008"],affected_sprint:"SP-P1-003",
    affected_build_spec:"BS-P1-025",
    covered_gates:["BACKLOG_T008_CLOSE_AFTER_T006_REVIEW"],
    never_converts_fail_or_untested_to_pass:true,
    residual_gaps:["GAP-T006-01"],
    expires_at_unix:expiry
  }
});
const writeDocket=d=>fs.writeFileSync(path.join(folder,d.case_id+".json"),JSON.stringify(d,null,2)+"\n");
const check=()=>findPersistentProceduralWaivers({
  root,gateId:"BACKLOG_T008_CLOSE_AFTER_T006_REVIEW",taskId:"T008",
  sprintId:"SP-P1-003",buildSpecId:"BS-P1-025"
});
const stage=(label,accepted,d,reason)=>record.stages.push({
  stage:label,observed_utc:new Date().toISOString(),
  elapsed_real_clock:Date.now(),accepted,
  valid:d.valid,rejected:d.rejected,
  expected_denial_reason:reason||null
});
try{
  const expiryCase=docket("EXPIRY",Math.floor(Date.now()/1000)+5);
  writeDocket(expiryCase);
  const active=check();
  assert(active.valid.includes(expiryCase.case_id),"expiry test: real-clock pre-expiry was not admitted");
  stage("ACTIVE_BEFORE_EXPIRY",true,active);

  await sleep(6500);
  const expired=check();
  const rejectedExpiry=expired.rejected.find(x=>x.case_id===expiryCase.case_id);
  assert(!expired.valid.includes(expiryCase.case_id) &&
    rejectedExpiry?.errors.includes("exception expired"),
    "expiry test: actual elapsed wall-clock did not reject with exception expired");
  stage("EXPIRED_REAL_WALL_CLOCK",false,expired,"exception expired");

  const revokedCase=docket("REVOCATION",Math.floor(Date.now()/1000)+300);
  writeDocket(revokedCase);
  const beforeRevoke=check();
  assert(beforeRevoke.valid.includes(revokedCase.case_id),
    "revocation test: independent nonexpired docket was not admitted");
  stage("ACTIVE_BEFORE_REVOCATION",true,beforeRevoke);

  const revoke={case_id:id("REVOCATION-EVENT"),
    revokes_exception_case_ids:[revokedCase.case_id],
    notice:"CI fixture only, not a real merged/approved revocation"};
  writeDocket(revoke);
  const afterRevoke=check();
  const rejectedRevocation=afterRevoke.rejected.find(x=>x.case_id===revokedCase.case_id);
  assert(!afterRevoke.valid.includes(revokedCase.case_id) &&
    rejectedRevocation?.errors.includes("revoked"),
    "revocation test: real temporary filesystem revoked event not rejected");
  stage("REVOKED_REAL_FILESYSTEM",false,afterRevoke,"revoked");
  record.verdict="LIVE_CLOCK_ENGINE_INTEGRATION_PASS_NOT_PROVIDER_E2E";
  console.log("16P #7 REAL CLOCK ENGINE: 4/4 observed (temp synthetic metadata); protected lifecycle NOT_VERIFIED");
}catch(e){
  record.verdict="FAIL";
  record.error=String(e.stack||e);
  console.error(record.error);
  process.exitCode=1;
}finally{
  record.finished_utc=new Date().toISOString();
  fs.writeFileSync(path.join(receiptDir,"7-live-clock.json"),JSON.stringify(record,null,2)+"\n");
  fs.rmSync(root,{recursive:true,force:true});
}
