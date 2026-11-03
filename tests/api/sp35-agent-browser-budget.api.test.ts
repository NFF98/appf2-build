import {describe,it,expect} from "vitest";
import {enoughAgentStepsForContinuation,stableAgentContinuationKey}
 from "../../src/app/code-builder/agent-browser-client.js";
describe("Sprint 3.5 no orphan paid model after a final Agent step",()=>{
 it("holds last slot for signed renewal rather than applying a tool without its next model turn",()=>{
  for(const remaining of [-1,0,1,NaN,Infinity,0.5])
   expect(enoughAgentStepsForContinuation(remaining)).toBe(false);
  for(const remaining of [2,3,16])
   expect(enoughAgentStepsForContinuation(remaining)).toBe(true);
 });
});

describe("Sprint 3.5 paid model continuation is idempotent across browser reloads",()=>{
 const job="ba45436c-c3f1-44f1-adc6-bdd0fb1592e7";
 const another="a6e2c5f0-a8d2-4aa6-ac2a-62f740e3bd0a";
 const key="agent_first_12345678";
 it("reuses a single journal key for the same signed CAS head",async()=>{
  const a=await stableAgentContinuationKey("agent_recover",job,key,4);
  const b=await stableAgentContinuationKey("agent_recover",job,key,4);
  expect(a).toBe(b);
  expect(a).toMatch(/^agent_recover_[0-9a-f]{40}$/u);
  expect(a.length).toBeLessThanOrEqual(80);
  expect(await stableAgentContinuationKey("agent_recover",job,key,5)).not.toBe(a);
  expect(await stableAgentContinuationKey("agent_recover",another,key,4)).not.toBe(a);
  expect(await stableAgentContinuationKey("agent_next",job,key,4)).not.toBe(a);
  expect(await stableAgentContinuationKey("agent_recover",job,"other_first_123456",4))
   .not.toBe(a);
 });
 it("rejects invalid job, provider key and CAS version before any paid request",async()=>{
  await expect(stableAgentContinuationKey("agent_next","../wrong",key,4))
   .rejects.toThrow("AGENT_CONTINUATION_KEY_INVALID");
  await expect(stableAgentContinuationKey("agent_next",job,"bad key",4))
   .rejects.toThrow("AGENT_CONTINUATION_KEY_INVALID");
  await expect(stableAgentContinuationKey("agent_next",job,key,-1))
   .rejects.toThrow("AGENT_CONTINUATION_KEY_INVALID");
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
