import {describe,it,expect} from "vitest";
import {enoughAgentStepsForContinuation}
 from "../../src/app/code-builder/agent-browser-client.js";
describe("Sprint 3.5 no orphan paid model after a final Agent step",()=>{
 it("holds last slot for signed renewal rather than applying a tool without its next model turn",()=>{
  for(const remaining of [-1,0,1,NaN,Infinity,0.5])
   expect(enoughAgentStepsForContinuation(remaining)).toBe(false);
  for(const remaining of [2,3,16])
   expect(enoughAgentStepsForContinuation(remaining)).toBe(true);
 });
});

import {parseQaPlan} from "../../src/platform/qa/requirement-contract.js";
describe("Browser pre-code QA plan and independently approved cloud browser",()=>{
 it("does not accept missing requirements, forged source quotes or plan after coding",()=>{
  const prompt="按 Add 按鈕之後顯示 42";
  const plan={version:"1",criteria:[{id:"score",source_quote:"顯示 42",
   description:"操作後顯示 42",automatable:true,
   steps:[{action:"click",role:"button",name:"Add"}],
   assertions:[{kind:"text_appears",text:"42"}]}]};
  expect(parseQaPlan(plan,prompt)).not.toBeNull();
  expect(parseQaPlan(plan,"另一個不同的需求")).toBeNull();
  expect(parseQaPlan({...plan,criteria:[]},prompt)).toBeNull();
 });
});
