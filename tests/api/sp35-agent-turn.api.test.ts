import {describe,it,expect} from "vitest";
import {createProjectSnapshot,type ProjectSnapshot}
 from "../../src/platform/agent/project-workspace.js";
import {executeAgentTurn,type AgentTurnDeps}
 from "../../src/platform/agent/agent-turn.js";
import {checkpointHash} from "../../src/platform/agent/postgres-agent-jobs.js";
import {advanceAgentCheckpoint,type AgentCheckpoint,type AgentToolCall}
 from "../../src/platform/agent/agent-contract.js";
import {sha256CodeBytes} from "../../src/platform/blueprint/code-artifact-v2.js";
import type {RecoveredAgentJob} from "../../src/platform/agent/durable-agent-service.js";
const jobId="52edb124-974c-4e0b-82fc-48ed6c9a0242";
const owner="a501ed0f-f0ab-46dc-b880-c0acb35291a0";
const reqHash="sha256:"+"f".repeat(64);
const resp=(id:string,name:string,args:Record<string,string>)=>({
 id:"resp_abcdefgh"+id,status:"completed",output:[{
  type:"function_call",call_id:id,name,arguments:JSON.stringify(args)
 }]
});
function checkpoint(project:ProjectSnapshot,state:"PLANNING"|"CODING"|"BUILDING"="PLANNING",
 max_steps=8):AgentCheckpoint{
 return {version:"APPF2_AGENT_CHECKPOINT_V1",job_id:jobId,
  project_hash:project.project_hash,state,step:0,cost_cents:0,tokens_used:0,
  budget:{max_steps,max_tokens:8000,max_cost_cents:0},
  completed_call_ids:[],previous_checkpoint_id:null};
}
async function initial(project:ProjectSnapshot,state:"PLANNING"|"CODING"|"BUILDING"="PLANNING",
 max_steps=8):Promise<RecoveredAgentJob>{
 const cp=checkpoint(project,state,max_steps);
 return {project,job:{job_id:jobId,owner_anonymous_id:owner,request_hash:reqHash,
  project_hash:project.project_hash,revision:0,checkpoint_hash:await checkpointHash(cp),
  checkpoint:cp,job_state:state}};
}
function harness(){
 const invocations:AgentToolCall[]=[];
 const persisted:RecoveredAgentJob[]=[];
 let failBuild=false;
 let invalidReceipt=false;
 const deps:AgentTurnDeps={
  broker:async(project,call)=>{
   expect(call.project_hash).toBe(project.project_hash);
   invocations.push(call);
   const result=failBuild&&call.name==="run_build"?"BUILD ERROR":"EXECUTED";
   return {call_id:call.call_id,project_hash:call.project_hash,
    exit_code:failBuild&&call.name==="run_build"?1:0,timed_out:false,
    runner_attestation:invalidReceipt?null:"isolation-verified-by-mock",
    detail:result,output_digest:await sha256CodeBytes(new TextEncoder().encode(result))};
  },
  persist:async(current,next,newProject)=>{
   expect(next.previous_checkpoint_id).toBe(current.job.checkpoint_hash);
   advanceAgentCheckpoint(current.job.checkpoint,next,newProject);
   const saved:RecoveredAgentJob={project:newProject??current.project,job:{
    ...current.job,revision:current.job.revision+1,
    project_hash:next.project_hash,job_state:next.state,
    checkpoint:next,checkpoint_hash:await checkpointHash(next)
   }};
   persisted.push(saved);
   return saved;
  }
 };
 return {deps,invocations,persisted,fail:()=>{failBuild=true;},
  invalidate:()=>{invalidReceipt=true;}};
}
const makeProject=()=>createProjectSnapshot("NODE","main.mjs",[
 {path:"main.mjs",content:"console.log('initial')"},
 {path:"math.mjs",content:"export const add=(a,b)=>a+b;"}
]);
describe("Sprint 3.5 real Agent tool-turn coordinator (offline isolated broker)",()=>{
 it("writes, builds and tests across successive Responses turns with immutable version chain",async()=>{
  const project=await makeProject(),h=harness();
  let current=await initial(project);
  const math=project.files.find(x=>x.path==="math.mjs")!;
  const write=await executeAgentTurn(current,resp("call_11111111","write_file",{
   path:"math.mjs",content:"export const add=(a,b)=>a-b;",previous_hash:math.hash
  }),h.deps);
  current=write.saved;
  expect(current.project.revision).toBe(2);
  expect(current.project.parent_hash).toBe(project.project_hash);
  expect(current.job.checkpoint.state).toBe("CODING");
  expect(current.job.checkpoint.completed_call_ids).toEqual(["call_11111111"]);
  expect(write.outputs[0].type).toBe("function_call_output");
  const build=await executeAgentTurn(current,resp("call_22222222","run_build",{
   target:"project"
  }),h.deps);
  current=build.saved;
  expect(current.job.checkpoint.state).toBe("BUILDING");
  const test=await executeAgentTurn(current,resp("call_33333333","run_test",{
   target:"project"
  }),h.deps);
  expect(test.saved.job.checkpoint.state).toBe("TESTING");
  expect(test.saved.project.project_hash).toBe(write.saved.project.project_hash);
  expect(h.invocations.map(x=>x.name)).toEqual(["write_file","run_build","run_test"]);
  expect(h.persisted).toHaveLength(3);
  expect(test.saved.job.checkpoint.completed_call_ids).toHaveLength(3);
  expect(test.saved.job.checkpoint.state).not.toBe("READY");
 });
 it("fails a build into repair stage, never promotes bad output",async()=>{
  const project=await makeProject(),h=harness();h.fail();
  const current=await initial(project,"CODING");
  const result=await executeAgentTurn(current,resp("call_44444444","run_build",{
   target:"project"
  }),h.deps);
  expect(result.outcome).toBe("FAILED");
  expect(result.saved.job.checkpoint.state).toBe("REPAIRING");
  expect(result.outputs[0].output).toContain("BUILD ERROR");
 });
 it("rejects forbidden state and model command injection without ever contacting broker",async()=>{
  const project=await makeProject(),h=harness(),current=await initial(project);
  await expect(executeAgentTurn(current,resp("call_55555555","run_test",{
   target:"project"
  }),h.deps)).rejects.toThrow("AGENT_TURN_ILLEGAL_STATE");
  await expect(executeAgentTurn(current,resp("call_55555555","exec",{
   command:"curl http://169.254.169.254"
  }),h.deps)).rejects.toThrow("AGENT_TURN_INVALID_RESPONSE");
  expect(h.invocations).toHaveLength(0);
 });
 it("fails closed on invalid broker proof and replays, no checkpoint commit",async()=>{
  const project=await makeProject(),h=harness();h.invalidate();
  const current=await initial(project,"CODING");
  await expect(executeAgentTurn(current,resp("call_66666666","read_file",{
   path:"main.mjs"
  }),h.deps)).rejects.toThrow("AGENT_TOOL_EVIDENCE_INVALID");
  expect(h.persisted).toHaveLength(0);
  const duplicate={...current,job:{...current.job,checkpoint:{
   ...current.job.checkpoint,completed_call_ids:["call_66666666"],step:1
  }}};
  await expect(executeAgentTurn(duplicate,resp("call_66666666","read_file",{
   path:"main.mjs"
  }),h.deps)).rejects.toThrow("AGENT_TURN_REPLAY");
  expect(h.invocations).toHaveLength(1);
 });
 it("rejects exhausted step budgets before invoking external tools",async()=>{
  const project=await makeProject(),h=harness(),current=await initial(project,"CODING",1);
  const consumed={...current,job:{...current.job,checkpoint:{
   ...current.job.checkpoint,step:1,completed_call_ids:["call_77777777"]
  }}};
  await expect(executeAgentTurn(consumed,resp("call_88888888","read_file",{
   path:"main.mjs"
  }),h.deps)).rejects.toThrow("AGENT_TURN_BUDGET_OR_PROJECT");
  expect(h.invocations).toHaveLength(0);
 });
});
