import {describe,it,expect,vi} from "vitest";
import {allFrozenFreeCiChecksPassed,BrowserCodingAgent}
 from "../../src/app/code-builder/agent-browser-client.js";
import type {QaPlan} from "../../src/platform/qa/requirement-contract.js";

const plan={criteria:[
 {id:"add_item",automatable:true},
 {id:"mark_done",automatable:true}
]} as unknown as QaPlan;
const passed=[
 {criterion_id:"add_item",verdict:"PASS"},
 {criterion_id:"mark_done",verdict:"PASS"}
];
describe("Sprint 3.5 browser UI original-plan QA admission",()=>{
 it("displays completed acceptance only when every original criterion passes",()=>{
  expect(allFrozenFreeCiChecksPassed(plan,passed)).toBe(true);
  expect(allFrozenFreeCiChecksPassed(plan,passed.slice(0,1))).toBe(false);
  expect(allFrozenFreeCiChecksPassed(plan,null)).toBe(false);
  expect(allFrozenFreeCiChecksPassed(null,passed)).toBe(false);
  expect(allFrozenFreeCiChecksPassed({criteria:[]} as unknown as QaPlan,passed)).toBe(false);
 });
 it("does not grant completion for duplicate, unknown, shuffled or failed receipts",()=>{
  expect(allFrozenFreeCiChecksPassed(plan,[passed[0]!,passed[0]!])).toBe(false);
  expect(allFrozenFreeCiChecksPassed(plan,[passed[0]!,{criterion_id:"unknown",verdict:"PASS"}])).toBe(false);
  expect(allFrozenFreeCiChecksPassed(plan,[passed[1]!,passed[0]!])).toBe(false);
  expect(allFrozenFreeCiChecksPassed(plan,[passed[0]!,{criterion_id:"mark_done",verdict:"FAIL"}])).toBe(false);
  expect(allFrozenFreeCiChecksPassed(plan,[passed[0]!,{criterion_id:"mark_done",verdict:"UNTESTED"}])).toBe(false);
 });
 it("does not falsely certify a requirement needing manual review",()=>{
  const manual={criteria:[{id:"human",automatable:false}]} as unknown as QaPlan;
  expect(allFrozenFreeCiChecksPassed(manual,[{criterion_id:"human",verdict:"PASS"}])).toBe(false);
 });
});

describe("Sprint 3.5 creator UI pause is never a paid re-dispatch",()=>{
 const ownerJob="11111111-1111-4111-8111-111111111111";
 const restore=()=>{
  // No IndexedDB or user signer is manufactured. Only the local UI poll
  // gate is under test; it must stop before invoking ANY signed POST.
  const agent=Object.create(BrowserCodingAgent.prototype) as BrowserCodingAgent;
  const read=vi.fn().mockResolvedValue({job_id:ownerJob,
   project_hash:"sha256:"+"a".repeat(64)});
  const post=vi.fn();
  Object.assign(agent,{target:{jobId:ownerJob,prompt:"計分 App"},
   read,post});
  return {agent,read,post};
 };
 it("pauses before reading the original owner Job when requested",async()=>{
  const {agent,read,post}=restore();
  await expect(agent.freeAiStage("CODE",()=>true)).rejects.toThrow(
   "SP35_USER_PAUSED_VIEW_NO_NEW_POST");
  expect(read).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
 });
 it("pauses after a harmless read, but BEFORE a paid signed POST",async()=>{
  const {agent,read,post}=restore();
  let checks=0;
  await expect(agent.freeAiStage("REPAIR",()=>++checks>1))
   .rejects.toThrow("SP35_USER_PAUSED_VIEW_NO_NEW_POST");
  expect(read).toHaveBeenCalledTimes(1);
  expect(post).not.toHaveBeenCalled();
 });
});
