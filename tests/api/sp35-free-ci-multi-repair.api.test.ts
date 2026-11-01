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
 return {project_hash:hash(label),receipt_json:{
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
