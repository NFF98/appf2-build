import {describe,it,expect} from "vitest";
import {decideFreeCiRepair,type FreeCiRepairHistory}
 from "../../src/platform/agent/free-ci-repair-policy.js";
import {frozenFreeCiPlanHash} from "../../src/edge/free-ci-result.js";
import type {QaPlan} from "../../src/platform/qa/requirement-contract.js";
const plan:QaPlan={version:"1",criteria:[{
 id:"score",source_quote:"計分",description:"點擊後分數更新",
 automatable:true,steps:[{action:"click",role:"button",name:"Add"}],
 assertions:[{kind:"text_appears",text:"42"}]
}]};
const hash=(x:string)=>"sha256:"+x.repeat(64);
async function receipt(label:string,verdict:"FAIL"|"PASS"|"UNTESTED"="FAIL"):
 Promise<FreeCiRepairHistory>{
 const versions:Record<string,{revision:number;parent:string}>={
  a:{revision:2,parent:"0"},b:{revision:3,parent:"a"},
  c:{revision:4,parent:"b"}
 };
 const version=versions[label];
 if(!version)throw Error("UNKNOWN_TEST_REVISION");
 return {project_hash:hash(label),project_revision:version.revision,
  parent_hash:hash(version.parent),receipt_json:{
  version:"APPF2_FREE_CI_SMOKE_V1",
  qa_plan_hash:await frozenFreeCiPlanHash(plan),
  qa_checks:[{criterion_id:"score",verdict,
   evidence_hash:verdict==="PASS"?hash("f"):null}],
  original_requirements_qa:false,app_published:false
 }};
}
describe("C4 + C5 active GPT-6 free-runner multi-repair policy",()=>{
 it("reserves unique signed round keys for three saved failing project versions",async()=>{
  const a=await receipt("a"),b=await receipt("b"),c=await receipt("c");
  const first=await decideFreeCiRepair(plan,[a],a.project_hash,2,2,44,8);
  expect(first).toMatchObject({round:1,model_call_key:"sp35_free_ai_repair_v1",
   mode:"FIX_FAILED_CHECKS",required_approved_cents:44});
  const second=await decideFreeCiRepair(plan,[b,a],b.project_hash,3,4,60,8);
  expect(second).toMatchObject({round:2,model_call_key:"sp35_free_ai_repair_v2",
   mode:"FIX_FAILED_CHECKS",required_approved_cents:60});
  const third=await decideFreeCiRepair(plan,[c,b,a],c.project_hash,4,6,76,8);
  expect(third).toMatchObject({round:3,model_call_key:"sp35_free_ai_repair_v3",
   mode:"RETHINK_ROOT_CAUSE",repeated_failure_count:3,
   required_approved_cents:76});
 });
 it("refuses new paid calls when owner budget, eight steps or rounds are exhausted",async()=>{
  const a=await receipt("a"),b=await receipt("b"),c=await receipt("c");
  await expect(decideFreeCiRepair(plan,[b,a],b.project_hash,3,4,44,8))
   .rejects.toThrow("OWNER_COST_APPROVAL_REQUIRED_60");
  await expect(decideFreeCiRepair(plan,[c,b,a],c.project_hash,4,6,60,8))
   .rejects.toThrow("OWNER_COST_APPROVAL_REQUIRED_76");
  await expect(decideFreeCiRepair(plan,[a],a.project_hash,2,2,44,3))
   .rejects.toThrow("STEP_BUDGET");
  await expect(decideFreeCiRepair(plan,[a],a.project_hash,5,8,100,16))
   .rejects.toThrow("ROUNDS_EXHAUSTED");
 });
 it("treats changed browser failure reasons as progress, not a stalled third failure",async()=>{
  const a=await receipt("a"),b=await receipt("b"),c=await receipt("c");
  const withReason=(row:FreeCiRepairHistory,code:string)=>({
   ...row,receipt_json:{...(row.receipt_json as object),
    qa_checks:[{criterion_id:"score",verdict:"FAIL",evidence_hash:null,
     failure_code:code}]}
  });
  const prior=withReason(a,"TARGET_MISSING_OR_AMBIGUOUS");
  const middle=withReason(b,"TARGET_MISSING_OR_AMBIGUOUS");
  const progressed=withReason(c,"ASSERTION_FAILED");
  const decision=await decideFreeCiRepair(plan,[progressed,middle,prior],
   c.project_hash,4,6,76,8);
  expect(decision.mode).toBe("FIX_FAILED_CHECKS");
  expect(decision.repeated_failure_count).toBe(1);
  const stillStalled=await decideFreeCiRepair(plan,[progressed,
   withReason(b,"ASSERTION_FAILED"),withReason(a,"ASSERTION_FAILED")],
   c.project_hash,4,6,76,8);
  expect(stillStalled.mode).toBe("RETHINK_ROOT_CAUSE");
  expect(stillStalled.repeated_failure_count).toBe(3);
 });
 it("does not mistake pass/UNTESTED, bad plan, forged history for independent failure",async()=>{
  const a=await receipt("a"),passed=await receipt("b","PASS");
  const unknown=await receipt("c","UNTESTED");
  const fake={...a,receipt_json:{...a.receipt_json as object,
   qa_plan_hash:hash("e")}};
  await expect(decideFreeCiRepair(plan,[passed],passed.project_hash,2,2,44,8))
   .rejects.toThrow("CURRENT_PROVEN_FAILURE_MISSING");
  await expect(decideFreeCiRepair(plan,[unknown],unknown.project_hash,2,2,44,8))
   .rejects.toThrow("CURRENT_PROVEN_FAILURE_MISSING");
  await expect(decideFreeCiRepair(plan,[fake],a.project_hash,2,2,44,8))
   .rejects.toThrow("CURRENT_PROVEN_FAILURE_MISSING");
 });
 it("never calls three failures consecutive if their source lineage is forged or missing",async()=>{
  const a=await receipt("a"),b=await receipt("b"),c=await receipt("c");
  // Old code sorted by receipt timestamp and would incorrectly switch.
  const fork={...c,parent_hash:hash("d")};
  const wrongParent=await decideFreeCiRepair(plan,[fork,b,a],
   c.project_hash,4,6,76,8);
  expect(wrongParent.mode).toBe("FIX_FAILED_CHECKS");
  expect(wrongParent.repeated_failure_count).toBe(1);
  const changedMiddle={...b,parent_hash:hash("d")};
  const interrupted=await decideFreeCiRepair(plan,[c,changedMiddle,a],
   c.project_hash,4,6,76,8);
  expect(interrupted.repeated_failure_count).toBe(2);
  expect(interrupted.mode).toBe("FIX_FAILED_CHECKS");
  const wrongRevision={...b,project_revision:2};
  const missing=await decideFreeCiRepair(plan,[c,wrongRevision,a],
   c.project_hash,4,6,76,8);
  expect(missing.repeated_failure_count).toBe(1);
  await expect(decideFreeCiRepair(plan,[b,a],a.project_hash,2,2,44,8))
   .rejects.toThrow("CURRENT_PROVEN_FAILURE_MISSING");
  const noCurrent={...c,project_revision:2};
  await expect(decideFreeCiRepair(plan,[noCurrent,b,a],
   c.project_hash,4,6,76,8))
   .rejects.toThrow("CURRENT_PROVEN_FAILURE_MISSING");
 });
 it("switches strategy only after three matching independently verified failures",async()=>{
  const a=await receipt("a"),b=await receipt("b"),c=await receipt("c");
  const changed={...b,receipt_json:{
   ...b.receipt_json as object,
   qa_checks:[{criterion_id:"score",verdict:"UNTESTED",evidence_hash:null}]
  }};
  const d=await decideFreeCiRepair(plan,[c,changed,a],
   c.project_hash,4,6,76,8);
  expect(d.mode).toBe("FIX_FAILED_CHECKS");
  expect(d.repeated_failure_count).toBe(1);
 });
});
