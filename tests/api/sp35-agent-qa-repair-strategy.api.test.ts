import {describe,it,expect} from "vitest";
import {determineQaRepairStrategy,type SavedQaHistory}
 from "../../src/platform/agent/qa-repair-strategy.js";
import type {QaPlan} from "../../src/platform/qa/requirement-contract.js";
const plan:QaPlan={version:"1",criteria:[{
 id:"score",source_quote:"計分",description:"操作後更新計分",
 automatable:true,steps:[{action:"click",role:"button",name:"Add"}],
 assertions:[{kind:"text_appears",text:"42"}]
},{
 id:"restart",source_quote:"重來",description:"可以重新開始",
 automatable:true,steps:[{action:"click",role:"button",name:"Restart"}],
 assertions:[{kind:"text_appears",text:"Ready"}]
}]};
const hash=(c:string)=>"sha256:"+c.repeat(64);
function row(c:string,failed:readonly string[]):SavedQaHistory{
 return {project_hash:hash(c),status:"SUCCEEDED",
  receipt_json:{ready_for_review:false,packet:null,
   checks:plan.criteria.map(criterion=>({
    criterion_id:criterion.id,category:"BROWSER",
    verdict:failed.includes(criterion.id)?"FAIL":"PASS",
    evidence_hash:failed.includes(criterion.id)?null:hash("f")
   }))}};
}
describe("Durable multi-file Agent changes strategy after three stalled independent QA",()=>{
 it("repairs normally after one or two failures, then analyzes root cause on third",()=>{
  const a=row("a",["score"]),b=row("b",["score"]),c=row("c",["score"]);
  expect(determineQaRepairStrategy(plan,[a]).mode).toBe("FIX_FAILED_CHECKS");
  expect(determineQaRepairStrategy(plan,[b,a]).mode).toBe("FIX_FAILED_CHECKS");
  const result=determineQaRepairStrategy(plan,[c,b,a]);
  expect(result).toEqual({mode:"RETHINK_ROOT_CAUSE",
   verified_failure_count:3,stalled_failure_count:3,
   latest_failed_criteria:["score"]});
 });
 it("does not mislabel genuine observed progress as stalled",()=>{
  const r=determineQaRepairStrategy(plan,[
   row("c",["score"]),row("b",["score","restart"]),row("a",["score","restart"])
  ]);
  expect(r.mode).toBe("FIX_FAILED_CHECKS");
  expect(r.stalled_failure_count).toBe(1);
 });
 it("counts each immutable snapshot once; rejects forged or malformed QA evidence",()=>{
  const a=row("a",["score"]),b=row("b",["score"]);
  const forged={...row("c",["score"]),receipt_json:{
   ready_for_review:false,packet:{forged:true},checks:[]}};
  const malformed={...row("d",["score"]),receipt_json:{
   ready_for_review:false,packet:null,checks:[
    {criterion_id:"score",category:"MODEL",verdict:"FAIL",evidence_hash:null}]
  }};
  const blocked={...row("e",["score"]),status:"BLOCKED_UNCERTAIN"};
  const r=determineQaRepairStrategy(plan,[a,a,forged,malformed,blocked,b]);
  expect(r.verified_failure_count).toBe(2);
  expect(r.stalled_failure_count).toBe(2);
  expect(r.mode).toBe("FIX_FAILED_CHECKS");
 });
 it("is bounded to the latest eight private journal rows",()=>{
  const rows="abcdefghij".split("").map(c=>row(c,["restart"]));
  const r=determineQaRepairStrategy(plan,rows);
  expect(r.verified_failure_count).toBe(8);
  expect(r.stalled_failure_count).toBe(8);
  expect(r.mode).toBe("RETHINK_ROOT_CAUSE");
 });
});
