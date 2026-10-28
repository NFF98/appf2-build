import {describe,it,expect} from "vitest";
import {runJournaledPaidModelTurn,type PaidModelTurn}
 from "../../src/platform/agent/journaled-model-gateway.js";
import {checkpointHash,type AgentJobExecutor,type AgentJobRow}
 from "../../src/platform/agent/postgres-agent-jobs.js";
import type {AgentCheckpoint} from "../../src/platform/agent/agent-contract.js";
import type {ModelCallRow} from "../../src/platform/agent/postgres-model-calls.js";
const jobId="52edb124-974c-4e0b-82fc-48ed6c9a0242";
const owner="a501ed0f-f0ab-46dc-b880-c0acb35291a0";
const sha="sha256:"+"a".repeat(64);
const response={id:"resp_abcdefgh123456",status:"completed",usage:{
 input_tokens:100,output_tokens:50},output:[{type:"message",content:[
 {type:"output_text",text:"Candidate only; not published"}]}]};
async function fixture(budget=20):Promise<AgentJobRow>{
 const checkpoint:AgentCheckpoint={version:"APPF2_AGENT_CHECKPOINT_V1",
  job_id:jobId,state:"PLANNING",project_hash:sha,step:1,
  tokens_used:0,cost_cents:0,
  budget:{max_steps:8,max_tokens:8000,max_cost_cents:budget},
  completed_call_ids:[],previous_checkpoint_id:null};
 return {job_id:jobId,owner_anonymous_id:owner,request_hash:sha,
  project_hash:sha,revision:0,job_state:"PLANNING",checkpoint,
  checkpoint_hash:await checkpointHash(checkpoint)};
}
class Ledger implements AgentJobExecutor{
 readonly rows=new Map<string,ModelCallRow>();
 calls=0;
 private job:AgentJobRow;
 constructor(job:AgentJobRow){this.job=job;}
 // eslint-disable-next-line complexity -- The fake dispatches a bounded SQL vocabulary.
 async query<T>(sql:string,args:readonly unknown[]):Promise<{rows:readonly T[]}>{
  if(sql.startsWith("SELECT job_id::text,owner_anonymous_id::text,call_key")){
   const r=this.rows.get(String(args[2]));
   return {rows:r&&r.owner_anonymous_id===args[1]?[r as T]:[]};
  }
  if(sql.startsWith("SELECT appf2_internal.reserve_agent_model_call")){
   const [job,key,revision,checkpointHash,requestHash,model,maxCharge]=args;
   if(job!==this.job.job_id||revision!==this.job.revision||
    checkpointHash!==this.job.checkpoint_hash)
    throw Error("MODEL_CALL_JOB_STALE");
   const spent=Array.from(this.rows.values()).filter(r=>
    r.status!=="REJECTED_PRE_SEND").reduce((n,r)=>n+r.max_charge_cents,0);
   if(spent+Number(maxCharge)>this.job.checkpoint.budget.max_cost_cents)
    throw Error("MODEL_CALL_BUDGET_EXCEEDED");
   if(Array.from(this.rows.values()).some(r=>
    ["RESERVED","IN_FLIGHT","BLOCKED_UNCERTAIN"].includes(r.status)))
    throw Error("MODEL_CALL_OTHER_ACTIVE");
   const row:ModelCallRow={
    job_id:String(job),owner_anonymous_id:owner,call_key:String(key),
    job_revision:Number(revision),checkpoint_hash:String(checkpointHash),
    request_hash:String(requestHash),model:String(model),max_charge_cents:Number(maxCharge),
    status:"RESERVED",response_json:null,response_id:null,
    input_tokens:null,output_tokens:null};
   this.rows.set(row.call_key,row);
   return {rows:[{status:"RESERVED"} as T]};
  }
  if(sql.startsWith("UPDATE public.appf2_agent_model_call")){
   const row=this.rows.get(String(args[2]));
   if(!row)return {rows:[]};
   if(sql.includes("SET status='SUCCEEDED'")){
    if(row.status!=="IN_FLIGHT")return {rows:[]};
    this.rows.set(row.call_key,{...row,status:"SUCCEEDED",
     response_json:JSON.parse(String(args[3])) as unknown,response_id:String(args[4]),
     input_tokens:Number(args[5]),output_tokens:Number(args[6])});
   }else if(sql.includes("SET status='BLOCKED_UNCERTAIN'")){
    if(row.status!=="IN_FLIGHT")return {rows:[]};
    this.rows.set(row.call_key,{...row,status:"BLOCKED_UNCERTAIN"});
   }else if(sql.includes("SET status='IN_FLIGHT'")){
    if(row.status!=="RESERVED"||row.request_hash!==args[3]||
      row.checkpoint_hash!==args[4]||row.job_revision!==args[5])
      return {rows:[]};
    this.rows.set(row.call_key,{...row,status:"IN_FLIGHT"});
   }else throw Error("UNEXPECTED_TRANSITION");
   return {rows:[{call_key:row.call_key} as T]};
  }
  throw Error("UNEXPECTED_SQL");
 }
}
function input(job:AgentJobRow,call_key="model_12345678"):PaidModelTurn{
 return {job,owner,call_key,input:"Write a useful project",
  previous_response_id:null,max_output_tokens:2048,
  max_charge_cents:5,paid_consent:true,api_key:"unit-test-placeholder-key"};
}
describe("Sprint 3.5 private at-most-once paid Responses journal (NO provider calls)",()=>{
 it("blocks all non-consented and zero-budget executions before dispatch",async()=>{
  const job=await fixture(),db=new Ledger(job);
  await expect(runJournaledPaidModelTurn({...input(job),paid_consent:false},
   {db,send:async()=>{db.calls++;return response;}})).rejects.toThrow("PAID_AGENT_NOT_AUTHORIZED");
  expect(db.calls).toBe(0);expect(db.rows.size).toBe(0);
  const zero=await fixture(0);
  await expect(runJournaledPaidModelTurn(input(zero),{db:new Ledger(zero)}))
   .rejects.toThrow("PAID_AGENT_NOT_AUTHORIZED");
 });
 it("reserves, fences network, saves response then replays with ZERO additional API calls",async()=>{
  const job=await fixture(),db=new Ledger(job);
  const deps={db,send:async()=>{db.calls++;return response;}};
  const first=await runJournaledPaidModelTurn(input(job),deps);
  expect(first.source).toBe("PROVIDER");
  expect(db.rows.get("model_12345678")?.status).toBe("SUCCEEDED");
  const second=await runJournaledPaidModelTurn(input(job),deps);
  expect(second.source).toBe("DURABLE_REPLAY");
  expect(second.response).toEqual(response);
  expect(db.calls).toBe(1);
  await expect(runJournaledPaidModelTurn({...input(job),input:"different prompt"},deps))
   .rejects.toThrow("MODEL_CALL_REPLAY_MISMATCH");
  expect(db.calls).toBe(1);
 });
 it("marks timeout UNCERTAIN and never repeats possible billable HTTP request",async()=>{
  const job=await fixture(),db=new Ledger(job);
  const deps={db,send:async()=>{db.calls++;throw Error("timeout");}};
  await expect(runJournaledPaidModelTurn(input(job),deps))
   .rejects.toThrow("PAID_AGENT_OUTCOME_UNCERTAIN_NO_RETRY");
  expect(db.rows.get("model_12345678")?.status).toBe("BLOCKED_UNCERTAIN");
  await expect(runJournaledPaidModelTurn(input(job),deps))
   .rejects.toThrow("PAID_AGENT_OUTCOME_UNCERTAIN_NO_RETRY");
  await expect(runJournaledPaidModelTurn(input(job,"model_87654321"),deps))
   .rejects.toThrow("MODEL_CALL_OTHER_ACTIVE");
  expect(db.calls).toBe(1);
 });
 it("fences concurrent callers before HTTP: only one dispatch",async()=>{
  const job=await fixture(),db=new Ledger(job);
  let release!:()=>void;
  let started!:()=>void;
  const gate=new Promise<void>(r=>{release=r;});
  const dispatched=new Promise<void>(r=>{started=r;});
  const deps={db,send:async()=>{db.calls++;started();await gate;return response;}};
  const first=runJournaledPaidModelTurn(input(job),deps);
  await dispatched;
  expect(db.calls).toBe(1);
  await expect(runJournaledPaidModelTurn(input(job),deps))
   .rejects.toThrow("PAID_AGENT_OUTCOME_UNCERTAIN_NO_RETRY");
  release();
  expect((await first).source).toBe("PROVIDER");
  expect(db.calls).toBe(1);
 });
 it("refuses malformed provider usage, preserving no-retry safety",async()=>{
  const job=await fixture(),db=new Ledger(job);
  await expect(runJournaledPaidModelTurn(input(job),{
   db,send:async()=>({...response,usage:undefined})
  })).rejects.toThrow("PAID_AGENT_OUTCOME_UNCERTAIN_NO_RETRY");
  expect(db.rows.get("model_12345678")?.status).toBe("BLOCKED_UNCERTAIN");
 });
 it("limits reserved pessimistic spend to approved job budget",async()=>{
  const job=await fixture(6),db=new Ledger(job);
  await runJournaledPaidModelTurn(input(job,"model_11111111"),{
   db,send:async()=>response
  });
  await expect(runJournaledPaidModelTurn(input(job,"model_22222222"),{
   db,send:async()=>{db.calls++;return response;}
  })).rejects.toThrow("MODEL_CALL_BUDGET_EXCEEDED");
  expect(db.calls).toBe(0);
 });
});
