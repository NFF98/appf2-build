import {describe,it,expect} from "vitest";
import {allFrozenFreeCiChecksPassed}
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
  expect(allFrozenFreeCiChecksPassed({criteria:[]} as QaPlan,passed)).toBe(false);
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
