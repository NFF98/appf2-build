import {describe,it,expect} from "vitest";
import {sealCandidateQaReceipt,verifySignedCandidateQa,verifySignedQaAgainstUserPrompt,
 summarizeCandidateQa,admitsPublicationFromCandidateReceipt,
 type CandidateQaReceipt}
 from "../../src/platform/agent/qa-receipt.js";
const a="sha256:"+"a".repeat(64);
const b="sha256:"+"b".repeat(64);
const c="sha256:"+"c".repeat(64);
const secret="verifier-owned-secret-not-present-in-the-model-or-app";
const receipt:CandidateQaReceipt={
 version:"APPF2_CANDIDATE_QA_V1",source_project_hash:a,
 built_artifact_hash:b,sandbox_execution_id:"sandbox_job_12345678",
 checks:[
  {criterion_id:"build",category:"BUILD",verdict:"PASS",evidence_hash:c},
  {criterion_id:"click",category:"BROWSER",verdict:"PASS",evidence_hash:b}
 ],runner_attestation:null
};
const identity={project_hash:a,artifact_hash:b,sandbox_execution_id:"sandbox_job_12345678"};
describe("Independent QA HMAC verification; never grants publication (offline)",()=>{
 it("refuses to trust forged text or incomplete QA without a verifier",async()=>{
  expect(summarizeCandidateQa({...receipt,runner_attestation:"any claim"},["build","click"])
   .ready_for_review).toBe(false);
  await expect(sealCandidateQaReceipt({...receipt,checks:receipt.checks.slice(0,1)},
   secret)).resolves.toBeDefined();
  const signed=await sealCandidateQaReceipt(receipt,secret);
  expect((await verifySignedCandidateQa(signed,["build","click","db"],identity,secret))
   .ready_for_review).toBe(false);
  expect(admitsPublicationFromCandidateReceipt(signed)).toBe(false);
 });
 it("validates independent signature, exact project/artifact/run and mandatory checks",async()=>{
  const signed=await sealCandidateQaReceipt(receipt,secret);
  expect(signed.runner_attestation).toMatch(/^hmac-sha256:[a-f0-9]{64}$/u);
  expect((await verifySignedCandidateQa(signed,["build","click"],identity,secret))
   .ready_for_review).toBe(true);
  expect((await verifySignedCandidateQa(signed,["build","click"],
   {...identity,project_hash:c},secret)).failures).toContain("QA_SOURCE_ARTIFACT_OR_RUN_MISMATCH");
  expect((await verifySignedCandidateQa(signed,["build","click"],identity,
   secret+"-wrong")).failures).toContain("QA_INDEPENDENT_SEAL_INVALID");
  expect(admitsPublicationFromCandidateReceipt(signed)).toBe(false);
 });
 it("rejects changed check, replaced evidence, duplicated IDs and unsigned receipts",async()=>{
  const signed=await sealCandidateQaReceipt(receipt,secret);
  const altered={...signed,checks:signed.checks.map(x=>
   x.criterion_id==="click"?{...x,evidence_hash:c}:x)};
  expect((await verifySignedCandidateQa(altered,["build","click"],identity,secret))
   .ready_for_review).toBe(false);
  expect((await verifySignedCandidateQa({...signed,runner_attestation:null},
   ["build","click"],identity,secret)).ready_for_review).toBe(false);
  const duplicate={...signed,checks:[...signed.checks,signed.checks[0]]};
  expect((await verifySignedCandidateQa(duplicate,["build","click"],identity,secret))
   .ready_for_review).toBe(false);
  const failed={...receipt,checks:[{...receipt.checks[0],verdict:"FAIL" as const}]};
  await expect(sealCandidateQaReceipt(failed,secret))
   .rejects.toThrow("QA_CANNOT_SEAL_UNPROVEN_CHECKS");
 });
 it("binds sealed checks to original user acceptance plan, not an arbitrary subset",async()=>{
  const signed=await sealCandidateQaReceipt(receipt,secret);
  const prompt="能按按鈕完成加分，並切換排行榜";
  const criteria=[
   {id:"build",source_quote:"完成加分",description:"操作後真的增加分數",
    steps:[{action:"click",role:"button",name:"加分"}],
    assertions:[{kind:"text_includes",text:"得分：1"}],automatable:true},
   {id:"click",source_quote:"切換排行榜",description:"打開排行榜",
    steps:[{action:"click",role:"tab",name:"排行"}],
    assertions:[{kind:"visible",role:"heading",name:"排行榜"}],automatable:true}
  ];
  const plan={version:"1",criteria};
  expect((await verifySignedQaAgainstUserPrompt(signed,plan,prompt,identity,secret))
   .ready_for_review).toBe(true);
  const withheld={...plan,criteria:[...criteria,
   {id:"database",source_quote:"完成加分",description:"永久儲存得分",
    steps:[],assertions:[{kind:"text_includes",text:"已保存"}],automatable:true}]};
  expect((await verifySignedQaAgainstUserPrompt(signed,withheld,prompt,identity,secret))
   .ready_for_review).toBe(false);
  const untrusted={...plan,criteria:[{...criteria[0],source_quote:"not in prompt"},
   criteria[1]]};
  expect((await verifySignedQaAgainstUserPrompt(signed,untrusted,prompt,identity,secret))
   .failures).toContain("QA_ORIGINAL_PLAN_INVALID");
  const manual={...plan,criteria:[{...criteria[0],automatable:false},criteria[1]]};
  expect((await verifySignedQaAgainstUserPrompt(signed,manual,prompt,identity,secret))
   .failures).toContain("QA_HAS_UNVERIFIED_REQUIREMENTS");
 });
 it("rejects zero requirements, duplicate requirements and blank/untrusted secret",async()=>{
  const signed=await sealCandidateQaReceipt(receipt,secret);
  expect((await verifySignedCandidateQa(signed,[],identity,secret)).ready_for_review)
   .toBe(false);
  expect((await verifySignedCandidateQa(signed,["build","build"],identity,secret))
   .ready_for_review).toBe(false);
  await expect(sealCandidateQaReceipt(receipt,"short"))
   .rejects.toThrow("QA_INDEPENDENT_KEY_REQUIRED");
 });
});