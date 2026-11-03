import {describe,it,expect} from "vitest";
import {RESPONSES_AGENT_TOOLS,makeAgentResponsesRequest,parseAgentResponsesBatch,
 makeAgentToolOutputs} from "../../src/platform/agent/responses-api.js";
const h="sha256:"+"a".repeat(64);
const rid="resp_abcdefgh123456";
const sample={id:rid,status:"completed",output:[
 {type:"reasoning",summary:[]},
 {type:"function_call",call_id:"call_12345678",name:"run_build",
  arguments:JSON.stringify({target:"project"})}
]};
describe("GPT-6.1 Sol Responses API protocol (offline; no provider calls)",()=>{
 it("uses documented Responses function JSON schemas, never legacy chat JSON completion",()=>{
  const request=makeAgentResponsesRequest({model:"gpt-6.1-sol",input:"Create a useful app",
   previous_response_id:null,max_output_tokens:8192,consent:true});
  expect(request.model).toBe("gpt-6.1-sol");
  expect(request.tools).toHaveLength(7);
  expect(request.tools.some(t=>t.name==="read_diagnostics")).toBe(false);
  expect(request.parallel_tool_calls).toBe(false);
  expect(RESPONSES_AGENT_TOOLS.every(x=>x.strict&&x.parameters.additionalProperties===false)).toBe(true);
  expect(request).not.toHaveProperty("messages");
 });
 it("requires explicit per-job consent and bounded output, rejects model typo",()=>{
  const req={model:"gpt-6.1-sol",input:"Create app",previous_response_id:null,
   max_output_tokens:8192,consent:true};
  expect(()=>makeAgentResponsesRequest({...req,consent:false})).toThrow("AGENT_AI_CONSENT_REQUIRED");
  expect(()=>makeAgentResponsesRequest({...req,model:"gpt-4.1"})).toThrow("AGENT_UNAPPROVED_MODEL");
  expect(()=>makeAgentResponsesRequest({...req,max_output_tokens:1000000})).toThrow();
 });
 it("converts OpenAI function call to validated broker data and resumes through response ID",()=>{
  const batch=parseAgentResponsesBatch(sample,h);
  expect(batch?.calls).toHaveLength(1);
  expect(batch?.calls[0].name).toBe("run_build");
  const receipts=[{call_id:"call_12345678",project_hash:h,exit_code:0,timed_out:false,
   output_digest:h,runner_attestation:"verified_by_broker",detail:"trusted build passed"}];
  const outputs=makeAgentToolOutputs(batch!.calls,receipts);
  expect(outputs[0].type).toBe("function_call_output");
  const next=makeAgentResponsesRequest({model:"gpt-6.1-sol",
   input:outputs,previous_response_id:batch!.response_id,max_output_tokens:4096,consent:true});
  expect(next.previous_response_id).toBe(rid);
  expect(next.input).toEqual(outputs);
  expect(()=>makeAgentToolOutputs(batch!.calls,[{...receipts[0],runner_attestation:null}])).toThrow();
 });
 it("rejects injection, duplicate IDs, missing arguments and unfinished response",()=>{
  expect(parseAgentResponsesBatch({...sample,status:"in_progress"},h)).toBeNull();
  expect(parseAgentResponsesBatch({...sample,output:[sample.output[1],sample.output[1]]},h)).toBeNull();
  expect(parseAgentResponsesBatch({...sample,output:[{
   type:"function_call",call_id:"call_12345678",name:"run_build",
   arguments:JSON.stringify({target:"rm -rf /"})
  }]},h)).toBeNull();
  expect(parseAgentResponsesBatch({...sample,output:[{
   type:"function_call",call_id:"call_12345678",name:"exec",
   arguments:JSON.stringify({command:"curl 169.254.169.254"})
  }]},h)).toBeNull();
  expect(parseAgentResponsesBatch({...sample,output:[{
   type:"function_call",call_id:"call_12345678",name:"write_file",
   arguments:JSON.stringify({path:"../secrets",content:"x",previous_hash:""})
  }]},h)).toBeNull();
  expect(parseAgentResponsesBatch({...sample,output:[{
   type:"function_call",call_id:"call_12345678",name:"run_build",
   arguments:"{invalid"
  }]},h)).toBeNull();
 });
 it("never makes a published READY claim from mere model prose",()=>{
  const batch=parseAgentResponsesBatch({id:rid,status:"completed",
   output:[{type:"message",content:[{type:"output_text",text:"Finished!"}]}]},h);
  expect(batch).toEqual({response_id:rid,calls:[]});
  expect(()=>makeAgentToolOutputs(batch!.calls,[])).toThrow("AGENT_TOOL_EVIDENCE_MISSING");
 });
});

describe("Multi-file Responses tool schema (no provider calls)",()=>{
 it("validates bounded atomic model edits and rejects unsafe batch members",()=>{
  const write=RESPONSES_AGENT_TOOLS.find(x=>x.name==="write_files");
  expect(write?.parameters.required).toEqual(["edits_json"]);
  const edits=[{path:"src/main.ts",content:"console.log('ok')",previous_hash:""},
   {path:"src/game.ts",content:"export const score=18;",previous_hash:""}];
  const response={id:"resp_atomic_12345678",status:"completed",output:[
   {type:"function_call",call_id:"call_atomic_123456",name:"write_files",
    arguments:JSON.stringify({edits_json:JSON.stringify(edits)})}]};
  expect(parseAgentResponsesBatch(response,h)?.calls[0].name).toBe("write_files");
  for(const bad of [
   [{...edits[0],path:"../.env"},edits[1]],
   [{...edits[0]},{...edits[1],path:"SRC/MAIN.ts"}],
   [{...edits[0],previous_hash:"forged"},edits[1]],
   [{...edits[0],content:"x".repeat(70*1024)},edits[1]],
   [edits[0]]
  ]){
   const forged={...response,output:[{...response.output[0],
    arguments:JSON.stringify({edits_json:JSON.stringify(bad)})}]};
   expect(parseAgentResponsesBatch(forged,h)).toBeNull();
  }
 });
});
