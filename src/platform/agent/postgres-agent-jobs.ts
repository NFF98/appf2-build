/** Scoped Postgres journal for candidate Coding Agent jobs (not a publishing API). */
import {canonicalArtifactJson,sha256CodeBytes} from "../blueprint/code-artifact-v2.js";
import {advanceAgentCheckpoint,validateAgentCheckpoint,type AgentCheckpoint} from "./agent-contract.js";
import {verifyProjectSnapshot,type ProjectSnapshot} from "./project-workspace.js";
const HASH=/^sha256:[a-f0-9]{64}$/u;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const IDENT=/^[A-Za-z0-9_-]{8,128}$/u;
export type AgentJobRow={
 readonly job_id:string;readonly owner_anonymous_id:string;
 readonly request_hash:string;readonly project_hash:string;
 readonly revision:number;readonly checkpoint_hash:string;
 readonly checkpoint:AgentCheckpoint;readonly job_state:string;
};
export interface AgentJobExecutor{
 query<T>(sql:string,args:readonly unknown[]):Promise<{rows:readonly T[]}>;
}
const GET=`SELECT job_id::text,owner_anonymous_id::text,request_hash,project_hash,
 revision,checkpoint_hash,checkpoint,job_state FROM public.appf2_agent_job
 WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid LIMIT 1`;
const START=`INSERT INTO public.appf2_agent_job
 (job_id,owner_anonymous_id,owner_key_thumbprint,idempotency_key,request_hash,
  checkpoint_hash,project_hash,job_state,checkpoint)
 VALUES ($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text,'CREATED',$8::jsonb)
 ON CONFLICT(owner_key_thumbprint,idempotency_key) DO NOTHING RETURNING job_id::text`;
const FIND_KEY=`SELECT job_id::text FROM public.appf2_agent_job
 WHERE owner_anonymous_id=$1::uuid AND owner_key_thumbprint=$2::text
 AND idempotency_key=$3::text LIMIT 1`;
const ADVANCE=`UPDATE public.appf2_agent_job SET
 revision=revision+1,checkpoint_hash=$4::text,project_hash=$5::text,
 job_state=$6::text,checkpoint=$7::jsonb
 WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid
 AND revision=$3::integer AND checkpoint_hash=$8::text
 RETURNING job_id::text`;
export async function checkpointHash(checkpoint:AgentCheckpoint):Promise<string>{
 if(!validateAgentCheckpoint(checkpoint))throw Error("AGENT_INVALID_CHECKPOINT");
 return sha256CodeBytes(new TextEncoder().encode(
  "APPF2_AGENT_CHECKPOINT_V1\u0000"+canonicalArtifactJson(checkpoint)));
}
function validateCreate(input:{job_id:string;owner:string;thumbprint:string;
 idempotency:string;request_hash:string;checkpoint:AgentCheckpoint}):void{
 if(!UUID.test(input.job_id)||!UUID.test(input.owner)||
   !/^[a-f0-9]{64}$/u.test(input.thumbprint)||!IDENT.test(input.idempotency)||
   !HASH.test(input.request_hash)||!validateAgentCheckpoint(input.checkpoint)||
   input.checkpoint.job_id!==input.job_id||input.checkpoint.state!=="CREATED"||
   input.checkpoint.step!==0||input.checkpoint.cost_cents!==0||
   input.checkpoint.tokens_used!==0||input.checkpoint.previous_checkpoint_id!==null)
   throw Error("AGENT_JOB_START_INVALID");
}
/** Create exactly one job per owner+idempotency key; different requests never reuse it. */
export async function startAgentJob(db:AgentJobExecutor,input:{job_id:string;owner:string;
 thumbprint:string;idempotency:string;request_hash:string;
 checkpoint:AgentCheckpoint}):Promise<AgentJobRow>{
 validateCreate(input);
 const hash=await checkpointHash(input.checkpoint);
 const args=[input.job_id,input.owner,input.thumbprint,input.idempotency,
  input.request_hash,hash,input.checkpoint.project_hash,JSON.stringify(input.checkpoint)];
 const inserted=await db.query<{job_id:string}>(START,args);
 const id=inserted.rows[0]?.job_id??(await db.query<{job_id:string}>(FIND_KEY,
  [input.owner,input.thumbprint,input.idempotency])).rows[0]?.job_id;
 if(!id)throw Error("AGENT_JOB_CREATE_CONFLICT");
 const saved=await readAgentJob(db,id,input.owner);
 if(!saved||saved.request_hash!==input.request_hash)
  throw Error("AGENT_JOB_IDEMPOTENCY_MISMATCH");
 return saved;
}
export async function readAgentJob(db:AgentJobExecutor,id:string,owner:string):Promise<AgentJobRow|null>{
 if(!UUID.test(id)||!UUID.test(owner))throw Error("AGENT_JOB_KEY_INVALID");
 const row=(await db.query<AgentJobRow>(GET,[id,owner])).rows[0];
 if(!row)return null;
 if(row.owner_anonymous_id!==owner||row.job_id!==id||
   row.project_hash!==row.checkpoint.project_hash||row.job_state!==row.checkpoint.state||
   row.checkpoint.job_id!==id||!(await validatePersisted(row)))
  throw Error("AGENT_JOB_CORRUPTED");
 return row;
}
async function validatePersisted(row:AgentJobRow):Promise<boolean>{
 return Number.isSafeInteger(row.revision)&&row.revision>=0&&
   row.checkpoint_hash===await checkpointHash(row.checkpoint);
}
/** CAS update. A failed race is an error, not a second paid operation. */
export async function updateAgentJob(db:AgentJobExecutor,previous:AgentJobRow,
 owner:string,next:AgentCheckpoint,newProject?:ProjectSnapshot):Promise<AgentJobRow>{
 if(previous.owner_anonymous_id!==owner||!(await validatePersisted(previous))||
   next.previous_checkpoint_id!==previous.checkpoint_hash)
  throw Error("AGENT_JOB_STALE_CHECKPOINT");
 if(newProject!==undefined&&(!(await verifyProjectSnapshot(newProject))||
   newProject.parent_hash!==previous.project_hash||
   newProject.project_hash!==next.project_hash))throw Error("AGENT_PROJECT_PROOF_INVALID");
 advanceAgentCheckpoint(previous.checkpoint,next,newProject);
 const hash=await checkpointHash(next);
 const result=await db.query<{job_id:string}>(ADVANCE,[previous.job_id,owner,
  previous.revision,hash,next.project_hash,next.state,JSON.stringify(next),
  previous.checkpoint_hash]);
 if(result.rows.length!==1)throw Error("AGENT_JOB_CONCURRENT_UPDATE");
 const saved=await readAgentJob(db,previous.job_id,owner);
 if(!saved||saved.checkpoint_hash!==hash)throw Error("AGENT_JOB_WRITE_NOT_VERIFIED");
 return saved;
}
