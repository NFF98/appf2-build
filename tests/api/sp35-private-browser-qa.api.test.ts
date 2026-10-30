import {describe,it,expect} from "vitest";
import {validPrivateBrowserQaTask,strictQaChecks}
 from "../../src/platform/agent/qa-browser-contract.js";
import {consistentBrowserQaResult} from "../../src/edge/agent-qa-run.js";
const prompt="按 Add 按鈕後顯示測試結果 42";
const criterion={id:"click_result",source_quote:"測試結果 42",
 description:"實際更新結果",automatable:true,
 steps:[{action:"click" as const,role:"button" as const,name:"Add"}],
 assertions:[{kind:"text_appears" as const,text:"測試結果 42"}]};
const task={job_id:"ba45436c-c3f1-44f1-adc6-bdd0fb1592e7",
 project_hash:"sha256:"+"d".repeat(64),build_call_id:"call_build_123456",
 test_call_id:"call_test_123456",original_prompt:prompt,
 original_plan:{version:"1" as const,criteria:[criterion]},
 explicit_browser_qa_consent:true};
describe("Private Browser QA isolated Cloudflare plan and consent",()=>{
 it("accepts only bounded original-prompt-matched owner-approved task",()=>{
  expect(validPrivateBrowserQaTask(task)).toBe(true);
  for(const field of ["build_call_id","test_call_id","original_prompt",
   "project_hash","job_id","explicit_browser_qa_consent"]){
   const v={...task,[field]:null};
   expect(validPrivateBrowserQaTask(v)).toBe(false);
  }
  expect(validPrivateBrowserQaTask({...task,unexpected:true})).toBe(false);
  expect(validPrivateBrowserQaTask({...task,test_call_id:task.build_call_id})).toBe(false);
  expect(validPrivateBrowserQaTask({...task,original_prompt:"another prompt"})).toBe(false);
  expect(validPrivateBrowserQaTask({...task,original_plan:{version:"1",criteria:[]}})).toBe(false);
  expect(validPrivateBrowserQaTask({...task,original_plan:{version:"1",
   criteria:Array.from({length:11},(_,i)=>({...criterion,id:"test_"+i}))}})).toBe(false);
 });
 it("fails closed on untested, omitted, reordered, duplicate or unproven checks",()=>{
  const passed={criterion_id:criterion.id,category:"BROWSER" as const,
   verdict:"PASS" as const,evidence_hash:"sha256:"+"c".repeat(64)};
  expect(strictQaChecks(task.original_plan,[passed])).toBe(true);
  expect(strictQaChecks(task.original_plan,[])).toBe(false);
  expect(strictQaChecks(task.original_plan,[passed,passed])).toBe(false);
  expect(strictQaChecks(task.original_plan,[{...passed,verdict:"FAIL"}])).toBe(false);
  expect(strictQaChecks(task.original_plan,[{...passed,evidence_hash:null}])).toBe(false);
  expect(strictQaChecks(task.original_plan,[{...passed,criterion_id:"wrong"}])).toBe(false);
 });
});

describe("Independent Browser QA negative-result evidence",()=>{
 const criteria=[{id:"click_result",source_quote:"測試結果 42",
  description:"實際更新結果",automatable:true,
  steps:[{action:"click" as const,role:"button" as const,name:"Add"}],
  assertions:[{kind:"text_appears" as const,text:"測試結果 42"}]}];
 const plan={version:"1" as const,criteria};
 it("rejects missing, forged, reordered and non-cryptographic QA observations",async()=>{
  const {validQaObservedChecks}=await import("../../src/platform/agent/qa-browser-contract.js");
  const pass={criterion_id:"click_result",category:"BROWSER" as const,
   verdict:"PASS" as const,evidence_hash:"sha256:"+"a".repeat(64)};
  expect(validQaObservedChecks(plan,[pass])).toBe(true);
  expect(validQaObservedChecks(plan,[{...pass,verdict:"FAIL",evidence_hash:null}])).toBe(true);
  expect(validQaObservedChecks(plan,[])).toBe(false);
  expect(validQaObservedChecks(plan,[{...pass,criterion_id:"other"}])).toBe(false);
  expect(validQaObservedChecks(plan,[{...pass,category:"MODEL"}])).toBe(false);
  expect(validQaObservedChecks(plan,[{...pass,evidence_hash:"pretend"}])).toBe(false);
  expect(validQaObservedChecks(plan,[{...pass,verdict:"FAIL"}])).toBe(false);
 });
});

describe("Browser QA response consistency before durable one-shot admission",()=>{
 const passed={criterion_id:criterion.id,category:"BROWSER" as const,
  verdict:"PASS" as const,evidence_hash:"sha256:"+"c".repeat(64)};
 const failed={...passed,verdict:"FAIL" as const,evidence_hash:null};
 const plan=task.original_plan;
 it("allows a fully checked PASS with a verifier packet, never an empty packet",()=>{
  expect(consistentBrowserQaResult(plan,{ready_for_review:true,
   checks:[passed],packet:{version:"APPF2_AGENT_QA_PACKET_V1"}})).toBe(true);
  expect(consistentBrowserQaResult(plan,{ready_for_review:true,
   checks:[passed],packet:null})).toBe(false);
  expect(consistentBrowserQaResult(plan,{ready_for_review:true,
   checks:[failed],packet:{version:"APPF2_AGENT_QA_PACKET_V1"}})).toBe(false);
 });
 it("accepts a genuine failed observation only without a success packet",()=>{
  expect(consistentBrowserQaResult(plan,{ready_for_review:false,
   checks:[failed],packet:null})).toBe(true);
  expect(consistentBrowserQaResult(plan,{ready_for_review:false,
   checks:[passed],packet:null})).toBe(false);
  expect(consistentBrowserQaResult(plan,{ready_for_review:false,
   checks:[failed],packet:{forged:true}})).toBe(false);
  expect(consistentBrowserQaResult(plan,{ready_for_review:true,
   checks:[{...passed,criterion_id:"wrong"}],packet:{}})).toBe(false);
 });
});

