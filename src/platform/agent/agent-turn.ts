/**
 * Sprint 3.5 single-turn Coding Agent execution coordinator.
 * Strict model tool call -> isolated broker -> immutable project edit -> CAS checkpoint.
 * This does NOT call a model, grant publication, or claim that cloud Sandbox is deployed.
 * At most one tool per Responses turn (parallel_tool_calls=false).
 */
import {type AgentCheckpoint,type AgentState,type AgentToolCall,
 advanceAgentCheckpoint,parseAgentBatchWrites} from "./agent-contract.js";
import {parseAgentResponsesBatch,makeAgentToolOutputs,type FunctionOutput}
 from "./responses-api.js";
import {applyProjectEdits,type ProjectEdit,type ProjectSnapshot}
 from "./project-workspace.js";
import type {SandboxEvidence} from "./sandbox-adapter.js";
import type {RecoveredAgentJob} from "./durable-agent-service.js";

export type AgentTurnResult={
 readonly saved:RecoveredAgentJob;
 readonly response_id:string;
 readonly outputs:readonly FunctionOutput[];
 readonly outcome:"EXECUTED"|"FAILED";
};
export type AgentTurnDeps={
 readonly broker:(snapshot:ProjectSnapshot,call:AgentToolCall)=>Promise<SandboxEvidence>;
 /** Must use transactional owner-scoped CAS, never an unversioned overwrite. */
 readonly persist:(current:RecoveredAgentJob,next:AgentCheckpoint,
  newProject?:ProjectSnapshot)=>Promise<RecoveredAgentJob>;
};
/** No automatic repeated execution: caller must look up persisted state after failure. */
function stateAfter(state:AgentState,call:AgentToolCall,success:boolean):AgentState{
 if(!success){
  if(call.name==="run_build"||call.name==="run_test")return "REPAIRING";
  return "FAILED";
 }
 if(call.name==="run_build")return "BUILDING";
 if(call.name==="run_test")return "TESTING";
 if(call.name==="read_diagnostics"&&state==="BUILDING")return "REPAIRING";
 return "CODING";
}
/** Reject impossible transitions BEFORE any external sandbox side effect. */
function toolAllowed(state:AgentState,call:AgentToolCall):boolean{
 if(call.name==="run_test")return state==="BUILDING";
 if(call.name==="run_build")return state==="CODING"||state==="REPAIRING";
 if(call.name==="read_diagnostics")return state==="BUILDING";
 return state==="PLANNING"||state==="CODING"||state==="REPAIRING";
}
function toolEdits(project:ProjectSnapshot,call:AgentToolCall):readonly ProjectEdit[]{
 if(call.name==="write_files"){
  const batch=parseAgentBatchWrites(call.args.edits_json);
  if(!batch)throw Error("AGENT_BATCH_EDIT_INVALID");
  return batch.map(({path,content,previous_hash})=>{
   const found=project.files.some(f=>f.path===path);
   if(!found&&previous_hash!=="")throw Error("AGENT_BATCH_NEW_FILE_HASH_CONFLICT");
   return found?{operation:"replace" as const,path,content,previous_hash}:
    {operation:"add" as const,path,content};
  });
 }
 const prior=project.files.find(f=>f.path===call.args.path);
 if(call.name==="write_file"){
  if(prior)return [{operation:"replace",path:call.args.path,
   previous_hash:call.args.previous_hash,content:call.args.content}];
  return [{operation:"add",path:call.args.path,content:call.args.content}];
 }
 if(call.name==="delete_file")return [{operation:"delete",path:call.args.path,
  previous_hash:prior?.hash??""}];
 return [];
}
async function outputAndProject(project:ProjectSnapshot,call:AgentToolCall,
 broker:AgentTurnDeps["broker"]){
 const receipt=await broker(project,call);
 const outputs=makeAgentToolOutputs([call],[receipt]);
 const success=receipt.exit_code===0&&!receipt.timed_out;
 const edits=success?toolEdits(project,call):[];
 const nextProject=edits.length>0?
  await applyProjectEdits(project,project.project_hash,edits):undefined;
 return {receipt,outputs,nextProject,success};
}
/**
 * One serial tool call. Model prose cannot mark a job READY; QA and publish need
 * independent evidence and separate owner-scoped admission, always fail closed.
 */
// eslint-disable-next-line complexity -- Model output, budget, broker, and CAS admission are fail-closed.
export async function executeAgentTurn(current:RecoveredAgentJob,
 rawResponse:unknown,deps:AgentTurnDeps):Promise<AgentTurnResult>{
 const cp=current.job.checkpoint;
 if(cp.state==="READY"||cp.state==="FAILED"||cp.state==="AWAITING_CONSENT")
  throw Error("AGENT_TURN_NOT_RUNNABLE");
 if(cp.project_hash!==current.project.project_hash||
   cp.completed_call_ids.length>=cp.budget.max_steps||
   cp.step>=cp.budget.max_steps)throw Error("AGENT_TURN_BUDGET_OR_PROJECT");
 const response=parseAgentResponsesBatch(rawResponse,current.project.project_hash);
 if(!response||response.calls.length!==1)throw Error("AGENT_TURN_INVALID_RESPONSE");
 const call=response.calls[0];
 if(cp.completed_call_ids.includes(call.call_id))throw Error("AGENT_TURN_REPLAY");
 if(!toolAllowed(cp.state,call))throw Error("AGENT_TURN_ILLEGAL_STATE");
 const result=await outputAndProject(current.project,call,deps.broker);
 const next:AgentCheckpoint={
  ...cp,state:stateAfter(cp.state,call,result.success),
  project_hash:result.nextProject?.project_hash??cp.project_hash,
  step:cp.step+1,completed_call_ids:[...cp.completed_call_ids,call.call_id],
  previous_checkpoint_id:current.job.checkpoint_hash
 };
 advanceAgentCheckpoint(cp,next,result.nextProject);
 const saved=await deps.persist(current,next,result.nextProject);
 if(saved.job.checkpoint_hash===current.job.checkpoint_hash||
   saved.project.project_hash!==next.project_hash||
   saved.job.checkpoint.completed_call_ids.at(-1)!==call.call_id)
  throw Error("AGENT_TURN_NOT_DURABLE");
 return {saved,response_id:response.response_id,outputs:result.outputs,
  outcome:result.success?"EXECUTED":"FAILED"};
}
