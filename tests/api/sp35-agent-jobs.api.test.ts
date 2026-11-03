import {describe,it,expect} from "vitest";
import {checkpointHash,startAgentJob,readAgentJob,updateAgentJob,
 type AgentJobExecutor,type AgentJobRow} from "../../src/platform/agent/postgres-agent-jobs.js";
import type {AgentCheckpoint} from "../../src/platform/agent/agent-contract.js";
import {createProjectSnapshot,applyProjectEdits} from "../../src/platform/agent/project-workspace.js";
const id="52edb124-974c-4e0b-82fc-48ed6c9a0242";
const owner="a501ed0f-f0ab-46dc-b880-c0acb35291a0";
const hash="sha256:"+"a".repeat(64);
const thumb="b".repeat(64);
function initial():AgentCheckpoint{
 return {version:"APPF2_AGENT_CHECKPOINT_V1",job_id:id,project_hash:hash,
  state:"CREATED",step:0,tokens_used:0,cost_cents:0,
  budget:{max_steps:12,max_tokens:8000,max_cost_cents:0},
  completed_call_ids:[],previous_checkpoint_id:null};
}
class FakeDb implements AgentJobExecutor{
 row:AgentJobRow|null=null;
 queries:{sql:string;args:readonly unknown[]}[]=[];
 async query<T>(sql:string,args:readonly unknown[]):Promise<{rows:readonly T[]}>{
  this.queries.push({sql,args});
  if(sql.startsWith("INSERT")){
   if(this.row)return {rows:[]};
   const cp=JSON.parse(String(args[7])) as AgentCheckpoint;
   this.row={job_id:String(args[0]),owner_anonymous_id:String(args[1]),
    request_hash:String(args[4]),project_hash:String(args[6]),revision:0,
    checkpoint_hash:String(args[5]),job_state:cp.state,checkpoint:cp};
   return {rows:[{job_id:id} as T]};
  }
  if(sql.startsWith("UPDATE")){
   if(!this.row||this.row.revision!==args[2]||this.row.checkpoint_hash!==args[7])
    return {rows:[]};
   const cp=JSON.parse(String(args[6])) as AgentCheckpoint;
   this.row={...this.row,revision:this.row.revision+1,checkpoint_hash:String(args[3]),
    project_hash:String(args[4]),job_state:String(args[5]),checkpoint:cp};
   return {rows:[{job_id:id} as T]};
  }
  const match=this.row&&this.row.owner_anonymous_id===args[1]&&this.row.job_id===args[0];
  if(sql.includes("owner_key_thumbprint"))return {rows:this.row?[{job_id:id} as T]:[]};
  return {rows:match?[this.row as T]:[]};
 }
}
const create=(checkpoint:AgentCheckpoint=initial())=>({
 job_id:id,owner,thumbprint:thumb,idempotency:"unique_123456",
 request_hash:hash,checkpoint
});
describe("Sprint 3.5 candidate PostgreSQL durable journal (no AI calls)",()=>{
 it("seals checkpoint and returns owner-scoped job with idempotency",async()=>{
  const db=new FakeDb();
  const first=await startAgentJob(db,create());
  expect(first.revision).toBe(0);
  expect(first.checkpoint_hash).toBe(await checkpointHash(initial()));
  const again=await startAgentJob(db,create());
  expect(again.checkpoint_hash).toBe(first.checkpoint_hash);
  expect(db.queries.some(q=>q.sql.includes("ON CONFLICT(owner_key_thumbprint,idempotency_key) DO NOTHING"))).toBe(true);
  await expect(startAgentJob(db,{...create(),request_hash:"sha256:"+"c".repeat(64)}))
   .rejects.toThrow("AGENT_JOB_IDEMPOTENCY_MISMATCH");
 });
 it("performs CAS transitions and denies stale replay and unauthorized owner",async()=>{
  const db=new FakeDb();
  const old=await startAgentJob(db,create());
  const next={...initial(),state:"PLANNING" as const,step:1,
   previous_checkpoint_id:old.checkpoint_hash};
  const result=await updateAgentJob(db,old,owner,next);
  expect(result.revision).toBe(1);
  expect(result.checkpoint.state).toBe("PLANNING");
  await expect(updateAgentJob(db,old,owner,next)).rejects.toThrow("AGENT_JOB_CONCURRENT_UPDATE");
  expect(await readAgentJob(db,id,"f501ed0f-f0ab-46dc-b880-c0acb35291a0")).toBeNull();
  await expect(updateAgentJob(db,result,"f501ed0f-f0ab-46dc-b880-c0acb35291a0",
   {...next,step:2,previous_checkpoint_id:result.checkpoint_hash})).rejects.toThrow();
 });
 it("persists validated hash lineage when coding changes a real multi-file project",async()=>{
  const db=new FakeDb();
  const root=await createProjectSnapshot("NODE","index.mjs",[
   {path:"index.mjs",content:"import {sum} from './math.mjs'; console.log(sum(1,2));"},
   {path:"math.mjs",content:"export const sum=(a,b)=>a+b;"}
  ]);
  const cp={...initial(),project_hash:root.project_hash};
  const old=await startAgentJob(db,create(cp));
  const revised=await applyProjectEdits(root,root.project_hash,[{
   operation:"replace",path:"math.mjs",previous_hash:root.files[1].hash,
   content:"export const sum=(a,b)=>a-b;"
  }]);
  const next={...cp,state:"PLANNING" as const,project_hash:revised.project_hash,
   step:1,previous_checkpoint_id:old.checkpoint_hash};
  await expect(updateAgentJob(db,old,owner,next)).rejects.toThrow("AGENT_CHECKPOINT_INVALID_TRANSITION");
  const saved=await updateAgentJob(db,old,owner,next,revised);
  expect(saved.project_hash).toBe(revised.project_hash);
  expect(saved.revision).toBe(1);
  expect(saved.checkpoint.previous_checkpoint_id).toBe(old.checkpoint_hash);
 });
 it("rejects unsupported state, inflated spending and forged checkpoint bytes",async()=>{
  const db=new FakeDb();
  const old=await startAgentJob(db,create());
  await expect(updateAgentJob(db,old,owner,{...initial(),state:"READY",
   step:1,previous_checkpoint_id:old.checkpoint_hash})).rejects.toThrow();
  await expect(updateAgentJob(db,old,owner,{...initial(),state:"PLANNING",
   cost_cents:1,step:1,previous_checkpoint_id:old.checkpoint_hash})).rejects.toThrow();
  db.row={...old,checkpoint:{...old.checkpoint,step:9}};
  await expect(readAgentJob(db,id,owner)).rejects.toThrow();
 });
});
