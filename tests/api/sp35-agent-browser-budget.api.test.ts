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
