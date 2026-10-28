import {describe,it,expect} from "vitest";
import {parseQaPlan,summarizeQa} from "../../src/platform/qa/requirement-contract.js";
import {verifyAndRepair} from "../../src/platform/qa/repair-loop.js";
const prompt="創造一個可增加分數並切換排行頁面的新工具";
const criteria=[
 {id:"increase",source_quote:"增加分數",description:"實際加分",
  steps:[{action:"click",role:"button",name:"增加"}],
  assertions:[{kind:"text_includes",text:"得分：1"}],automatable:true},
 {id:"ranking",source_quote:"切換排行頁面",description:"切到排行",
  steps:[{action:"click",role:"tab",name:"排行"}],
  assertions:[{kind:"visible",role:"heading",name:"排行榜"}],automatable:true}
];
const plan=parseQaPlan({version:"1",criteria},prompt)!;
describe("universal independent acceptance (not dice-specific)",()=>{
 it("binds every claim to original prompt, rejects no-evidence and duplicate claims",()=>{
  expect(plan).not.toBeNull();
  expect(parseQaPlan({version:"1",criteria:[{...criteria[0],source_quote:"not in user prompt"}]},prompt)).toBeNull();
  expect(parseQaPlan({version:"1",criteria:[criteria[0],criteria[0]]},prompt)).toBeNull();
  expect(summarizeQa(plan,[{id:"increase",verdict:"PASS",detail:"changed"}]).passed).toBe(false);
 });
 it("rejects unsafe pure calculation test injection before execution",()=>{
  const c={...criteria[0],assertions:[{kind:"pure_case",function_name:"__score",input:[[2,4,6]],expected:12}]};
  expect(parseQaPlan({version:"1",criteria:[c]},prompt)).not.toBeNull();
  expect(parseQaPlan({version:"1",criteria:[{...c,assertions:[{...c.assertions[0],function_name:"alert();"}]}]},prompt)).toBeNull();
 });
 it("passes only with evidence for ALL requested interactions",async()=>{
  const value=await verifyAndRepair({title:"novel",javascript:"good"},plan,
    async()=>criteria.map(x=>({id:x.id,verdict:"PASS" as const,detail:"browser observed"})));
  expect(value.status).toBe("VERIFIED");expect(value.attempts).toHaveLength(1);
 });
 it("repairs at most twice and keeps original acceptance contract",async()=>{
  let calls=0;let tests=0;
  const outcome=await verifyAndRepair({title:"x",javascript:"broken"},plan,
    async(draft)=>{tests++;return criteria.map(c=>({
      id:c.id,verdict:draft.javascript==="fixed"?"PASS" as const:"FAIL" as const,detail:"observed"
    }));},
    {maxRepairs:15,repair:async()=>{calls++;return {title:"x",javascript:calls===2?"fixed":"still_bad"};}});
  expect(outcome.status).toBe("VERIFIED");expect(calls).toBe(2);expect(tests).toBe(3);
 });
 it("fails closed on missing evidence, pending human decisions and broken runtime",async()=>{
  const untested={...plan,criteria:[{...plan.criteria[0],automatable:false}]};
  expect((await verifyAndRepair({title:"x",javascript:"x"},untested,async()=>[])).status).toBe("NEEDS_HUMAN");
  expect((await verifyAndRepair({title:"x",javascript:"x"},plan,async()=>{throw Error("browser crashed");})).status).toBe("NEEDS_HUMAN");
 });
});
