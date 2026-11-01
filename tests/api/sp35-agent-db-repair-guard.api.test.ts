import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
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
