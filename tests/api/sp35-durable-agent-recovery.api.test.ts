import {describe,it,expect} from "vitest";
import {createProjectSnapshot,applyProjectEdits}
 from "../../src/platform/agent/project-workspace.js";
import {startDurableAgentJob,advanceDurableAgentJob,recoverAgentJob}
 from "../../src/platform/agent/durable-agent-service.js";
import type {AgentJobExecutor,AgentJobRow} from "../../src/platform/agent/postgres-agent-jobs.js";
import type {AgentCheckpoint} from "../../src/platform/agent/agent-contract.js";
const owner="a501ed0f-f0ab-46dc-b880-c0acb35291a0";
const jobId="52edb124-974c-4e0b-82fc-48ed6c9a0242";
const requestHash="sha256:"+"f".repeat(64);
type StoredSnapshot={
 project_hash:string;parent_hash:string|null;project_revision:number;snapshot:unknown
};
class InMemoryDb implements AgentJobExecutor{
 job:AgentJobRow|null=null;
 readonly snapshots=new Map<string,StoredSnapshot>();
 async query<T>(sql:string,args:readonly unknown[]):Promise<{rows:readonly T[]}>{
  if(sql.startsWith("INSERT INTO public.appf2_agent_project_snapshot")){
   const key=String(args[0])+":"+String(args[1]);
   if(this.snapshots.has(key))return {rows:[]};
   this.snapshots.set(key,{project_hash:String(args[1]),parent_hash:args[2] as string|null,
    project_revision:Number(args[3]),snapshot:JSON.parse(String(args[4])) as unknown});
   return {rows:[{project_hash:args[1]} as T]};
  }
  if(sql.startsWith("SELECT project_hash,parent_hash,project_revision,snapshot")){
   const record=this.snapshots.get(String(args[0])+":"+String(args[1]));
   return {rows:record?[record as T]:[]};
  }
  if(sql.startsWith("INSERT INTO public.appf2_agent_job")){
   if(this.job)return {rows:[]};
   const checkpoint=JSON.parse(String(args[7])) as AgentCheckpoint;
   this.job={job_id:String(args[0]),owner_anonymous_id:String(args[1]),
    request_hash:String(args[4]),project_hash:String(args[6]),
    revision:0,checkpoint_hash:String(args[5]),checkpoint,
    job_state:checkpoint.state};
   return {rows:[{job_id:jobId} as T]};
  }
  if(sql.startsWith("UPDATE public.appf2_agent_job")){
   if(this.job?.revision!==args[2]||this.job?.checkpoint_hash!==args[7])
    return {rows:[]};
   const checkpoint=JSON.parse(String(args[6])) as AgentCheckpoint;
   this.job={...this.job,revision:this.job.revision+1,
    checkpoint_hash:String(args[3]),project_hash:String(args[4]),
    job_state:String(args[5]),checkpoint};
   return {rows:[{job_id:jobId} as T]};
  }
  if(sql.includes("owner_key_thumbprint")){
   return {rows:this.job?[{job_id:jobId} as T]:[]};
  }
  if(sql.startsWith("SELECT job_id::text,owner_anonymous_id")){
   return {rows:this.job&&this.job.job_id===args[0]&&
    this.job.owner_anonymous_id===args[1]?[this.job as T]:[]};
  }
  throw Error("UNEXPECTED_QUERY");
 }
}
function cp(projectHash:string):AgentCheckpoint{
 return {version:"APPF2_AGENT_CHECKPOINT_V1",job_id:jobId,project_hash:projectHash,
  state:"CREATED",step:0,tokens_used:0,cost_cents:0,
  budget:{max_steps:8,max_tokens:8000,max_cost_cents:0},
  completed_call_ids:[],previous_checkpoint_id:null};
}
describe("Sprint 3.5 durable full project recovery (offline PostgreSQL-shaped fake)",()=>{
 it("restores saved multi-file content and checkpoint after simulated disconnect",async()=>{
  const db=new InMemoryDb();
  const project=await createProjectSnapshot("NODE","main.mjs",[
   {path:"main.mjs",content:"import {calc} from './calc.mjs';console.log(calc(1))"},
   {path:"calc.mjs",content:"export const calc=(n)=>n+1"}
  ]);
  const start=await startDurableAgentJob(db,{
   job_id:jobId,owner,thumbprint:"a".repeat(64),idempotency:"task_123456",
   request_hash:requestHash,checkpoint:cp(project.project_hash),project
  });
  const edited=await applyProjectEdits(project,project.project_hash,[{
   operation:"replace",path:"calc.mjs",previous_hash:project.files[0].hash,
   content:"export const calc=(n)=>n+2"
  }]);
  const next={...cp(edited.project_hash),state:"PLANNING" as const,step:1,
   previous_checkpoint_id:start.job.checkpoint_hash};
  const done=await advanceDurableAgentJob(db,start.job,owner,next,edited);
  expect(done.project.files[0].content).toContain("n+2");
  expect(done.job.revision).toBe(1);
  const restored=await recoverAgentJob(db,jobId,owner);
  expect(restored).toEqual(done);
  expect(await recoverAgentJob(db,jobId,"b501ed0f-f0ab-46dc-b880-c0acb35291a0")).toBeNull();
  await expect(advanceDurableAgentJob(db,start.job,owner,next,edited))
   .rejects.toThrow("AGENT_JOB_CONCURRENT_UPDATE");
  expect((await recoverAgentJob(db,jobId,owner))?.job.revision).toBe(1);
 });
 it("fails closed when the job points at missing source bytes",async()=>{
  const db=new InMemoryDb();
  const project=await createProjectSnapshot("NODE","app.mjs",[
   {path:"app.mjs",content:"console.log('ok')"}
  ]);
  const saved=await startDurableAgentJob(db,{
   job_id:jobId,owner,thumbprint:"a".repeat(64),idempotency:"task_123456",
   request_hash:requestHash,checkpoint:cp(project.project_hash),project
  });
  db.snapshots.clear();
  await expect(recoverAgentJob(db,saved.job.job_id,owner))
   .rejects.toThrow("AGENT_RECOVERY_PROJECT_MISSING");
 });
});
