import {describe,it,expect} from "vitest";
import {recoveredPaidResponse}
 from "../../src/edge/free-ci-ai-code.js";
import type {ModelCallRow}
 from "../../src/platform/agent/postgres-model-calls.js";
import type {AgentJobRow}
 from "../../src/platform/agent/postgres-agent-jobs.js";
const owner="0f06bf4f-2a82-4b39-93bb-9d46e9e8a111";
const id="b5b9d32d-bc88-4f05-a9dc-7e3aab24cc43";
const hash="sha256:"+"a".repeat(64);
const job={
 job_id:id,owner_anonymous_id:owner,
 revision:2,checkpoint_hash:hash,
 request_hash:hash,project_hash:hash,job_state:"CODING",
 checkpoint:{version:"APPF2_AGENT_CHECKPOINT_V1",job_id:id,
  state:"CODING",project_hash:hash,step:2,tokens_used:0,
  cost_cents:28,budget:{max_steps:8,max_tokens:8192,max_cost_cents:76},
  completed_call_ids:[],previous_checkpoint_id:hash}
} as AgentJobRow;
const saved={
 job_id:id,owner_anonymous_id:owner,
 call_key:"sp35_free_ai_repair_v1",job_revision:2,
 checkpoint_hash:hash,request_hash:"sha256:"+"b".repeat(64),
 model:"gpt-6.1-sol",max_charge_cents:16,status:"SUCCEEDED",
 response_json:{id:"resp_saved",status:"completed",
  output:[{type:"message",content:[{type:"output_text",
   text:'{"main_ts":"saved repair","style_css":"saved css"}'}]}]},
 response_id:"resp_saved",input_tokens:150,output_tokens:250
} as ModelCallRow;
describe("SP35 C4 saved paid repair recovery: same Job, no repeated model POST",()=>{
 it("returns immutable paid result even after a new deployment changes prompt formatting",()=>{
  // New model request digests may differ, but the completed saved model call
  // is tied to the ORIGINAL exact owner/job/revision/checkpoint/model/cap.
  const recovered=recoveredPaidResponse(saved,job,"REPAIR");
  expect(recovered?.response).toEqual(saved.response_json);
  expect(recovered).toMatchObject({inputTokens:150,outputTokens:250});
 });
 it("never accepts another owner, another Job, or a stale checkpoint",()=>{
  for(const invalid of [
   {...saved,owner_anonymous_id:"other"},
   {...saved,job_id:"other"},
   {...saved,job_revision:3},
   {...saved,checkpoint_hash:"sha256:"+"c".repeat(64)},
   {...saved,model:"gpt-4.1-mini"},
   {...saved,max_charge_cents:20}
  ]){
   expect(()=>recoveredPaidResponse(invalid,job,"REPAIR"))
    .toThrow("SP35_PAID_AI_SAVED_HEAD_MISMATCH_NO_RECHARGE");
  }
 });
 it("rejects unfinished, uncertain or empty paid responses",()=>{
  expect(recoveredPaidResponse(null,job,"REPAIR")).toBeNull();
  expect(recoveredPaidResponse({...saved,status:"IN_FLIGHT"},job,"REPAIR"))
   .toBeNull();
  expect(recoveredPaidResponse({...saved,response_json:null},job,"REPAIR"))
   .toBeNull();
  expect(()=>recoveredPaidResponse(saved,job,"CODE"))
   .toThrow("SP35_PAID_AI_SAVED_HEAD_MISMATCH_NO_RECHARGE");
 });
});
