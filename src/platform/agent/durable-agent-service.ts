/**
 * Durable Agent checkpoint + source coordination.
 * Persist content first, then CAS-update the job pointer. Orphan candidate
 * snapshots are safe after a crash; no job ever points to missing bytes.
 */
import {startAgentJob,readAgentJob,updateAgentJob,
 type AgentJobExecutor,type AgentJobRow} from "./postgres-agent-jobs.js";
import {persistAgentProjectSnapshot,readAgentProjectSnapshot}
 from "./postgres-project-snapshots.js";
import type {AgentCheckpoint} from "./agent-contract.js";
import type {ProjectSnapshot} from "./project-workspace.js";
export type RecoveredAgentJob={
 readonly job:AgentJobRow;readonly project:ProjectSnapshot;
};
export async function recoverAgentJob(db:AgentJobExecutor,jobId:string,
 owner:string):Promise<RecoveredAgentJob|null>{
 const job=await readAgentJob(db,jobId,owner);
 if(!job)return null;
 const project=await readAgentProjectSnapshot(db,owner,job.project_hash);
 if(!project)throw Error("AGENT_RECOVERY_PROJECT_MISSING");
 if(job.checkpoint.project_hash!==project.project_hash)
  throw Error("AGENT_RECOVERY_PROJECT_MISMATCH");
 return {job,project};
}
export async function startDurableAgentJob(db:AgentJobExecutor,input:{
 job_id:string;owner:string;thumbprint:string;idempotency:string;
 request_hash:string;checkpoint:AgentCheckpoint;project:ProjectSnapshot;
}):Promise<RecoveredAgentJob>{
 if(input.checkpoint.project_hash!==input.project.project_hash)
  throw Error("AGENT_START_PROJECT_MISMATCH");
 await persistAgentProjectSnapshot(db,input.owner,input.project);
 const job=await startAgentJob(db,input);
 const recovered=await recoverAgentJob(db,job.job_id,input.owner);
 if(!recovered)throw Error("AGENT_START_NOT_DURABLE");
 return recovered;
}
/**
 * Retry a stale mutation never invokes a model or sandbox again; the caller
 * receives AGENT_JOB_CONCURRENT_UPDATE and must recover the saved head.
 */
export async function advanceDurableAgentJob(db:AgentJobExecutor,previous:AgentJobRow,
 owner:string,next:AgentCheckpoint,project?:ProjectSnapshot):Promise<RecoveredAgentJob>{
 if(previous.project_hash!==next.project_hash){
  if(!project||project.parent_hash!==previous.project_hash||
    project.project_hash!==next.project_hash)
   throw Error("AGENT_CHANGED_PROJECT_REQUIRED");
  await persistAgentProjectSnapshot(db,owner,project);
 }else if(project!==undefined){
  throw Error("AGENT_UNNEEDED_PROJECT_WRITE");
 }
 const job=await updateAgentJob(db,previous,owner,next,project);
 const recovered=await recoverAgentJob(db,job.job_id,owner);
 if(!recovered)throw Error("AGENT_ADVANCE_NOT_DURABLE");
 return recovered;
}
