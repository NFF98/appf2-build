import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {recoveredPaidResponse} from "../../src/edge/free-ci-ai-code.js";
import type {AgentJobRow} from "../../src/platform/agent/postgres-agent-jobs.js";
import type {ModelCallRow} from "../../src/platform/agent/postgres-model-calls.js";
import {advanceAgentCheckpoint,type AgentCheckpoint}
 from "../../src/platform/agent/agent-contract.js";
const sql=readFileSync(
 "supabase/migrations/20261101130000_sp35_agent_coding_repair_guard.sql","utf8");
const hash="sha256:"+"a".repeat(64);
const id="645c20d3-3027-42ef-a520-c58aac31422e";
const before:AgentCheckpoint={
 version:"APPF2_AGENT_CHECKPOINT_V1",job_id:id,state:"CODING",project_hash:hash,
 step:2,tokens_used:1000,cost_cents:28,
 budget:{max_steps:8,max_tokens:8192,max_cost_cents:76},
 completed_call_ids:[],previous_checkpoint_id:hash};
describe("Sprint 3.5 paid repair persistence guard parity",()=>{
 it("PostgreSQL allows exactly the existing CODING→REPAIRING→CODING path",()=>{
  expect(sql).toContain("OLD.job_state='CODING' AND NEW.job_state IN ('CODING','BUILDING','REPAIRING'");
  expect(sql).toContain("OLD.job_state='REPAIRING' AND NEW.job_state IN ('CODING'");
  expect(sql).toContain("OLD.job_state IN ('READY','FAILED')");
  expect(sql).toContain("NEW.revision<>OLD.revision+1");
  expect(sql).toContain("NEW.owner_anonymous_id<>OLD.owner_anonymous_id");
  expect(sql).toContain("(NEW.checkpoint->>'cost_cents')::integer <");
  expect(sql).not.toContain("SECURITY DEFINER");
  const repairing={...before,state:"REPAIRING" as const,step:3};
  expect(()=>advanceAgentCheckpoint(before,repairing)).not.toThrow();
  const coding={...repairing,state:"CODING" as const,step:4};
  expect(()=>advanceAgentCheckpoint(repairing,coding)).not.toThrow();
 });
 it("rejects illegal transitions and spend rollback",()=>{
  expect(()=>advanceAgentCheckpoint(before,{...before,state:"READY",step:3}))
   .toThrow("AGENT_CHECKPOINT_INVALID_TRANSITION");
  expect(()=>advanceAgentCheckpoint(before,{...before,state:"REPAIRING",step:3,cost_cents:27}))
   .toThrow("AGENT_CHECKPOINT_INVALID_TRANSITION");
 });
});

describe("Sprint 3.5 C4 already-paid response resumption after first CAS",()=>{
 const oldHash="sha256:"+"b".repeat(64);
 const newHash="sha256:"+"c".repeat(64);
 const owner="645c20d3-3027-42ef-a520-c58aac31422f";
 const original:AgentJobRow={job_id:id,owner_anonymous_id:owner,
  request_hash:hash,project_hash:hash,revision:2,checkpoint_hash:oldHash,
  checkpoint:before,job_state:"CODING"};
 const saved:ModelCallRow={job_id:id,owner_anonymous_id:owner,
  call_key:"sp35_free_ai_repair_v1",job_revision:2,
  checkpoint_hash:oldHash,request_hash:hash,model:"gpt-6.1-sol",
  max_charge_cents:16,status:"SUCCEEDED",response_json:{status:"completed"},
  response_id:"resp_paid_existing",input_tokens:50,output_tokens:80};
 const partial:AgentJobRow={...original,revision:3,
  checkpoint_hash:newHash,job_state:"REPAIRING",
  checkpoint:{...before,state:"REPAIRING",step:3,
   previous_checkpoint_id:oldHash}};
 it("reuses the same saved response from the exact committed parent without POST",()=>{
  expect(recoveredPaidResponse(saved,original,"REPAIR")?.response)
   .toEqual(saved.response_json);
  expect(recoveredPaidResponse(saved,partial,"REPAIR")?.response)
   .toEqual(saved.response_json);
 });
 it("cannot replay a paid repair after a forged or unrelated checkpoint",()=>{
  for(const changed of [
   {...partial,owner_anonymous_id:id},
   {...partial,revision:4},
   {...partial,checkpoint:{...partial.checkpoint,
    previous_checkpoint_id:hash}},
   {...partial,job_state:"CODING"},
   {...partial,project_hash:newHash}
  ]){
   expect(()=>recoveredPaidResponse(saved,changed,"REPAIR"))
    .toThrow("SP35_PAID_AI_SAVED_HEAD_MISMATCH_NO_RECHARGE");
  }
  expect(()=>recoveredPaidResponse(saved,partial,"CODE"))
   .toThrow("SP35_PAID_AI_SAVED_HEAD_MISMATCH_NO_RECHARGE");
  expect(recoveredPaidResponse({...saved,status:"IN_FLIGHT"},partial,"REPAIR"))
   .toBeNull();
 });
});
