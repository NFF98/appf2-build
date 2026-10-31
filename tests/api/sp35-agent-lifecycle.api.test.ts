import {describe,it,expect} from "vitest";
import {advanceWithApprovedQaRepair,type LifecycleAgent}
 from "../../src/app/code-builder/agent-lifecycle.js";
import type {CandidateJob,CandidateSnapshot,AgentBrowserOptions}
 from "../../src/app/code-builder/agent-browser-client.js";
const options:AgentBrowserOptions={allowAi:true,allowContainer:true,approvedCents:60};
function snapshot(status:string,completed_steps:number):CandidateSnapshot{
 const job:CandidateJob={
  job_id:"ba45436c-c3f1-44f1-adc6-bdd0fb1592e7",revision:3,
  status,project_hash:"sha256:"+"a".repeat(64),
  files:[],app_published:false,
  checkpoint:{step:3,completed_call_ids:[],
   budget:{max_steps:16,max_cost_cents:60,max_tokens:8000}}
 };
 return {job,progress:null,message:"Persisted",completed_steps};
}
function fixture(firstSteps:number,passed:boolean,afterQa="REPAIRING"){
 const calls={advances:0,qa:0,repairs:0,limits:[] as number[]};
 const checks=[{criterion_id:"real_click",verdict:passed?"PASS":"FAIL"}];
 const agent:LifecycleAgent={
  advance:async(_opts,progress,_stop,limit=6)=>{
   calls.advances++;
   calls.limits.push(limit);
   const result=calls.advances===1?snapshot("TESTING",firstSteps):
    snapshot("CODING",1);
   progress(result);
   return result;
  },
  independentQa:async(consent)=>{
   expect(consent).toBe(true);
   calls.qa++;
   return {ready_for_review:passed,checks};
  },
  repairFailedQa:async(consent)=>{
   expect(consent).toBe(true);
   calls.repairs++;
   return {status:"QA_REPAIR_MODEL_SAVED"};
  },
  read:async()=>snapshot(afterQa,0).job,
  progress:async()=>null
 };
 return {agent,calls};
}
describe("Sprint 3.5 single-click authorized Agent → real QA → one repair",()=>{
 it("does not invoke private Browser QA without a separate per-click consent",async()=>{
  const {agent,calls}=fixture(4,false);
  const x=await advanceWithApprovedQaRepair(agent,options,false,()=>{},()=>false);
  expect(x.qa).toBeNull();
  expect(calls).toMatchObject({advances:1,qa:0,repairs:0});
 });
 it("passes through QA once without AI repair when the requirements pass",async()=>{
  const {agent,calls}=fixture(4,true,"TESTING");
  const x=await advanceWithApprovedQaRepair(agent,options,true,()=>{},()=>false);
  expect(x.qa?.ready_for_review).toBe(true);
  expect(x.repairStarted).toBe(false);
  expect(calls).toMatchObject({advances:1,qa:1,repairs:0});
  expect(x.snapshot.job.app_published).toBe(false);
 });
 it("uses remaining six-step budget to repair one failed real browser QA",async()=>{
  const {agent,calls}=fixture(4,false);
  const x=await advanceWithApprovedQaRepair(agent,options,true,()=>{},()=>false);
  expect(x.qa?.checks[0]?.verdict).toBe("FAIL");
  expect(x.repairStarted).toBe(true);
  expect(x.snapshot.job.status).toBe("CODING");
  expect(calls).toMatchObject({advances:2,qa:1,repairs:1,limits:[6,2]});
 });
 it("preserves failed QA at budget limit without extra model spend",async()=>{
  const {agent,calls}=fixture(6,false);
  const x=await advanceWithApprovedQaRepair(agent,options,true,()=>{},()=>false);
  expect(x.repairStarted).toBe(false);
  expect(calls).toMatchObject({advances:1,qa:1,repairs:0});
 });
 it("runs newly consented independent QA for a persisted TESTING job without redoing build",async()=>{
  const {agent,calls}=fixture(0,true,"TESTING");
  const result=await advanceWithApprovedQaRepair(agent,options,true,()=>{},()=>false);
  expect(result.qa?.ready_for_review).toBe(true);
  expect(result.repairStarted).toBe(false);
  expect(calls).toMatchObject({advances:1,qa:1,repairs:0,limits:[6]});
 });
 it("can repair a resumed QA failure within the same newly authorized click",async()=>{
  const {agent,calls}=fixture(0,false);
  const result=await advanceWithApprovedQaRepair(agent,options,true,()=>{},()=>false);
  expect(result.qa?.ready_for_review).toBe(false);
  expect(result.repairStarted).toBe(true);
  expect(calls).toMatchObject({advances:2,qa:1,repairs:1,limits:[6,6]});
 });
 it("does not spend Browser QA without explicit consent or after stop",async()=>{
  const idle=fixture(0,false);
  await advanceWithApprovedQaRepair(idle.agent,options,false,()=>{},()=>false);
  expect(idle.calls.qa).toBe(0);
  const stopped=fixture(4,false);
  await advanceWithApprovedQaRepair(stopped.agent,options,true,()=>{},()=>true);
  expect(stopped.calls.qa).toBe(0);
 });
 it("refuses to spend an AI repair without durably proven REPAIRING state",async()=>{
  const {agent,calls}=fixture(3,false,"TESTING");
  await expect(advanceWithApprovedQaRepair(agent,options,true,()=>{},()=>false))
   .rejects.toThrow("AGENT_QA_REPAIR_STATE_UNPROVEN");
  expect(calls.repairs).toBe(0);
 });
 it("does not infer AI consent from Browser QA checkbox",async()=>{
  const {agent,calls}=fixture(3,false);
  await advanceWithApprovedQaRepair(agent,{...options,allowAi:false},true,
   ()=>{},()=>false);
  expect(calls.qa).toBe(0);
 });
});
