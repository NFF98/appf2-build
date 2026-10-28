/**
 * Data-only coding-agent protocol. A model message is never an OS command.
 * The runtime may only dispatch these calls to an authenticated sandbox broker.
 */
export const AGENT_TOOLS=["read_file","write_file","delete_file","run_build","run_test","read_diagnostics"] as const;
export type AgentToolName=typeof AGENT_TOOLS[number];
export type AgentToolCall={
 readonly call_id:string;
 readonly name:AgentToolName;
 readonly project_hash:string;
 readonly args:Readonly<Record<string,string>>;
};
export type AgentState="CREATED"|"PLANNING"|"CODING"|"BUILDING"|"TESTING"|"REPAIRING"|"READY"|"FAILED"|"AWAITING_CONSENT";
export type AgentBudget={readonly max_steps:number;readonly max_tokens:number;readonly max_cost_cents:number};
export type AgentCheckpoint={
 readonly version:"APPF2_AGENT_CHECKPOINT_V1";
 readonly job_id:string;
 readonly state:AgentState;
 readonly project_hash:string;
 readonly step:number;
 readonly tokens_used:number;
 readonly cost_cents:number;
 readonly budget:AgentBudget;
 readonly completed_call_ids:readonly string[];
 readonly previous_checkpoint_id:string|null;
};
const SHA=/^sha256:[a-f0-9]{64}$/u;
const ID=/^[A-Za-z0-9_-]{8,80}$/u;
const stateTransitions:Record<AgentState,readonly AgentState[]>={
 CREATED:["PLANNING","FAILED"],PLANNING:["CODING","AWAITING_CONSENT","FAILED"],
 CODING:["CODING","BUILDING","AWAITING_CONSENT","FAILED"],
 BUILDING:["TESTING","REPAIRING","FAILED"],
 TESTING:["READY","REPAIRING","FAILED"],
 REPAIRING:["CODING","BUILDING","FAILED","AWAITING_CONSENT"],
 READY:[],FAILED:[],AWAITING_CONSENT:["PLANNING","CODING","REPAIRING","FAILED"]
};
function obj(v:unknown):v is Record<string,unknown>{
 return typeof v==="object"&&v!==null&&!Array.isArray(v);
}
function exact(v:unknown,keys:readonly string[]):v is Record<string,unknown>{
 return obj(v)&&Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
}
function argumentsFor(name:AgentToolName):readonly string[]{
 return name==="read_file"||name==="delete_file"?["path"]:
  name==="write_file"?["path","content","previous_hash"]:
   name==="run_build"||name==="run_test"?["target"]:[];
}
/** Reject JSON unknown properties and raw shell commands before any dispatch. */
// eslint-disable-next-line complexity -- Strict tool argument admission rejects privilege escalation.
export function parseAgentToolCall(input:unknown):AgentToolCall|null{
 if(!exact(input,["call_id","name","project_hash","args"])||
   typeof input.call_id!=="string"||!ID.test(input.call_id)||
   typeof input.name!=="string"||!AGENT_TOOLS.some(n=>n===input.name)||
   typeof input.project_hash!=="string"||!SHA.test(input.project_hash))return null;
 const name=input.name as AgentToolName;
 if(!exact(input.args,argumentsFor(name)))return null;
 if(Object.values(input.args).some(v=>typeof v!=="string"))return null;
 if(name==="run_build"||name==="run_test"){
  if(input.args.target!=="project")return null;
 }
 if(name==="write_file"&&typeof input.args.content==="string"&&input.args.content.length>256*1024)return null;
 if("path" in input.args){
  const path=input.args.path;
  if(typeof path!=="string"||path.length>180)return null;
  // Safe path validation is enforced again by the workspace implementation.
  try{assertPath(path);}catch{return null;}
 }
 if(name==="write_file"&&input.args.previous_hash!==""&&
   (typeof input.args.previous_hash!=="string"||!SHA.test(input.args.previous_hash)))return null;
 return input as AgentToolCall;
}
import {assertWorkspacePath as assertPath} from "./project-workspace.js";
// eslint-disable-next-line complexity -- Durable budget and replay boundaries are intentionally explicit.
export function validateAgentCheckpoint(input:unknown):input is AgentCheckpoint{
 if(!exact(input,["version","job_id","state","project_hash","step","tokens_used",
   "cost_cents","budget","completed_call_ids","previous_checkpoint_id"])||
   input.version!=="APPF2_AGENT_CHECKPOINT_V1"||
   typeof input.job_id!=="string"||!ID.test(input.job_id)||
   typeof input.state!=="string"||!(input.state in stateTransitions)||
   typeof input.project_hash!=="string"||!SHA.test(input.project_hash)||
   !exact(input.budget,["max_steps","max_tokens","max_cost_cents"])||
   !Array.isArray(input.completed_call_ids))return false;
 const budget=input.budget;
 const valid=(n:unknown)=>typeof n==="number"&&Number.isSafeInteger(n)&&n>=0;
 if(!valid(input.step)||!valid(input.tokens_used)||!valid(input.cost_cents)||
   !valid(budget.max_steps)||!valid(budget.max_tokens)||!valid(budget.max_cost_cents)||
   (input.step as number)>(budget.max_steps as number)||
   (input.tokens_used as number)>(budget.max_tokens as number)||
   (input.cost_cents as number)>(budget.max_cost_cents as number))return false;
 if(input.completed_call_ids.length>(input.step as number)||
   new Set(input.completed_call_ids).size!==input.completed_call_ids.length||
   !input.completed_call_ids.every(x=>typeof x==="string"&&ID.test(x)))return false;
 return input.previous_checkpoint_id===null||
  (typeof input.previous_checkpoint_id==="string"&&SHA.test(input.previous_checkpoint_id));
}
/** Transition policy only: persistence, transactional CAS and charging belong to durable job store. */
export function advanceAgentCheckpoint(previous:AgentCheckpoint,next:AgentCheckpoint):void{
 if(!validateAgentCheckpoint(previous)||!validateAgentCheckpoint(next)||
   previous.job_id!==next.job_id||previous.project_hash!==next.project_hash||
   !stateTransitions[previous.state].includes(next.state)||
   next.step<previous.step||next.tokens_used<previous.tokens_used||
   next.cost_cents<previous.cost_cents||
   next.completed_call_ids.length<previous.completed_call_ids.length||
   previous.completed_call_ids.some((id,i)=>next.completed_call_ids[i]!==id)||
   JSON.stringify(previous.budget)!==JSON.stringify(next.budget)||
   next.previous_checkpoint_id===null)
   throw Error("AGENT_CHECKPOINT_INVALID_TRANSITION");
}
