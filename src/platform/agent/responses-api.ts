/**
 * GPT-6.1 Sol Responses API candidate adapter for Sprint 3.5.
 * Does not send requests without explicit caller consent and a real API key.
 * Model-selected tools are data, never executed in this module.
 */
import {AGENT_TOOLS,parseAgentToolCall,type AgentToolCall,type AgentToolName}
 from "./agent-contract.js";
import type {SandboxEvidence} from "./sandbox-adapter.js";
const SHA=/^sha256:[0-9a-f]{64}$/u;
const RESPONSE_ID=/^resp_[A-Za-z0-9_-]{6,160}$/u;
function obj(v:unknown):v is Record<string,unknown>{
 return typeof v==="object"&&v!==null&&!Array.isArray(v);
}
function argumentKeys(name:AgentToolName):readonly string[]{
 if(name==="read_file"||name==="delete_file")return ["path"];
 if(name==="write_file")return ["path","content","previous_hash"];
 if(name==="write_files")return ["edits_json"];
 if(name==="run_build"||name==="run_test")return ["target"];
 return [];
}
function toolSchema(name:AgentToolName){
 const fields=argumentKeys(name);
 const properties=Object.fromEntries(fields.map(k=>[k,{
  type:"string",...(k==="target"?{enum:["project"]}:{}),
  description:k==="previous_hash"?"Expected file hash, or empty for new file.":
   k==="edits_json"?"JSON array of 2 to 16 {path,content,previous_hash} objects. Existing paths require exact file hash and new paths empty previous_hash. Atomic commit.":k
 }]));
 return {type:"function" as const,name,description:
  "Operate only through the APPf2 isolated project broker, never through host shell.",
  strict:true,parameters:{type:"object",properties,required:fields,additionalProperties:false}};
}
export const RESPONSES_AGENT_TOOLS=AGENT_TOOLS.map(toolSchema);
export type FunctionOutput={readonly type:"function_call_output";readonly call_id:string;readonly output:string};
export type ResponsesToolBatch={readonly response_id:string;readonly calls:readonly AgentToolCall[]};
// eslint-disable-next-line complexity -- Consent, model, budget and continuation contract must fail closed.
export function makeAgentResponsesRequest(args:{
 model:string;input:string|readonly FunctionOutput[];previous_response_id:string|null;
 max_output_tokens:number;consent:boolean;
}){
 if(!args.consent)throw Error("AGENT_AI_CONSENT_REQUIRED");
 if(!/^gpt-6\.1-sol(?:-[A-Za-z0-9_-]+)?$/u.test(args.model))
  throw Error("AGENT_UNAPPROVED_MODEL");
 if(!Number.isSafeInteger(args.max_output_tokens)||args.max_output_tokens<512||
    args.max_output_tokens>16384)throw Error("AGENT_OUTPUT_BUDGET_REQUIRED");
 if(args.previous_response_id!==null&&!RESPONSE_ID.test(args.previous_response_id))
  throw Error("AGENT_INVALID_CONTINUATION");
 if(typeof args.input==="string"){
  if(args.previous_response_id!==null||args.input.length<1||args.input.length>16000)
   throw Error("AGENT_INVALID_FIRST_PROMPT");
 }else{
  if(args.previous_response_id===null||!Array.isArray(args.input)||
     args.input.length===0||args.input.length>4||args.input.some(x=>
      x.type!=="function_call_output"||!/^call_[A-Za-z0-9_-]{4,128}$/u.test(x.call_id)||
      typeof x.output!=="string"||x.output.length>8192))
    throw Error("AGENT_INVALID_TOOL_CONTINUATION");
 }
 return {
  model:args.model,input:args.input,
  ...(args.previous_response_id?{previous_response_id:args.previous_response_id}:{}),
  max_output_tokens:args.max_output_tokens,reasoning:{effort:"medium"},
  tools:RESPONSES_AGENT_TOOLS,tool_choice:"auto",parallel_tool_calls:false,
  store:true
 };
}
/** Parse an entire completed response, not streaming fragments or unsigned model prose. */
// eslint-disable-next-line complexity -- Strictly validate every untrusted model tool item.
export function parseAgentResponsesBatch(input:unknown,project_hash:string):ResponsesToolBatch|null{
 if(!obj(input)||typeof input.id!=="string"||!RESPONSE_ID.test(input.id)||
   input.status!=="completed"||!Array.isArray(input.output)||!SHA.test(project_hash)||
   input.output.length>16)return null;
 const calls:AgentToolCall[]=[];
 const seen=new Set<string>();
 for(const item of input.output){
  if(!obj(item))return null;
  if(item.type!=="function_call")continue;
  if(typeof item.call_id!=="string"||typeof item.name!=="string"||
    typeof item.arguments!=="string"||item.arguments.length>300000||
    seen.has(item.call_id)||calls.length>=4)return null;
  let parsed:unknown;
  try{parsed=JSON.parse(item.arguments);}catch{return null;}
  const call=parseAgentToolCall({call_id:item.call_id,name:item.name,project_hash,args:parsed});
  if(!call)return null;
  seen.add(call.call_id);
  calls.push(call);
 }
 return {response_id:input.id,calls};
}
/** Never echo secrets, raw model code or unbounded logs to a future model turn. */
export function makeAgentToolOutputs(calls:readonly AgentToolCall[],
 receipts:readonly SandboxEvidence[]):FunctionOutput[]{
 if(calls.length===0||calls.length>4||calls.length!==receipts.length)
  throw Error("AGENT_TOOL_EVIDENCE_MISSING");
 return calls.map((call,i)=>{
  const receipt=receipts[i];
  if(!receipt||receipt.call_id!==call.call_id||
    receipt.project_hash!==call.project_hash||!SHA.test(receipt.output_digest)||
    (typeof receipt.runner_attestation!=="string"||receipt.runner_attestation.length<8)||
    typeof receipt.detail!=="string"||receipt.detail.length>4096||
    typeof receipt.timed_out!=="boolean"||
    (receipt.exit_code!==null&&!Number.isInteger(receipt.exit_code)))
   throw Error("AGENT_TOOL_EVIDENCE_INVALID");
  return {type:"function_call_output",call_id:call.call_id,output:JSON.stringify({
   exit_code:receipt.exit_code,timed_out:receipt.timed_out,
   output_digest:receipt.output_digest,detail:receipt.detail
  })};
 });
}
/** Real Responses HTTP transport, never invoked by CI fixtures or automatically on import. */
export async function sendAgentResponse(input:{
 api_key:string;request:ReturnType<typeof makeAgentResponsesRequest>;
}):Promise<unknown>{
 if(input.api_key.length<16)throw Error("AGENT_KEY_MISSING");
 const response=await fetch("https://api.openai.com/v1/responses",{
  method:"POST",headers:{"Authorization":"Bearer "+input.api_key,
   "Content-Type":"application/json"},
  body:JSON.stringify(input.request),signal:AbortSignal.timeout(60000)
 });
 if(!response.ok)throw Error("AGENT_RESPONSES_UPSTREAM_"+response.status);
 const raw=await response.text();
 if(raw.length>512*1024)throw Error("AGENT_RESPONSE_TOO_LARGE");
 try{return JSON.parse(raw) as unknown;}catch{throw Error("AGENT_RESPONSE_NOT_JSON");}
}
