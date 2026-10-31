/** Zero-cost creator-authored multi-file import for FREE_ONLY staging.
 * This is NEVER AI generation, never a QA PASS or publication authority.
 * Both state transitions are journaled, recoverable and hash-bound.
 */
import {recoverAgentJob,advanceDurableAgentJob}
 from "../platform/agent/durable-agent-service.js";
import {applyProjectEdits,assertWorkspacePath}
 from "../platform/agent/project-workspace.js";
import type {AgentJobExecutor} from "../platform/agent/postgres-agent-jobs.js";
const SHA=/^sha256:[a-f0-9]{64}$/u;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
export type FreeImportInput={
 readonly anonymous_id:string;readonly expected_revision:0;
 readonly expected_project_hash:string;readonly files:readonly {
  readonly path:string;readonly content:string}[];
};
// eslint-disable-next-line complexity -- Defensive exact body, bounded paths and byte checks are all mandatory.\nexport function validFreeImportInput(raw:unknown):raw is FreeImportInput{
 if(typeof raw!=="object"||raw===null||Array.isArray(raw))return false;
 const x=raw as Record<string,unknown>;
 if(Object.keys(x).sort().join(",")!==
  "anonymous_id,expected_project_hash,expected_revision,files"||
  typeof x.anonymous_id!=="string"||!UUID.test(x.anonymous_id)||
  typeof x.expected_project_hash!=="string"||!SHA.test(x.expected_project_hash)||
  x.expected_revision!==0||!Array.isArray(x.files)||
  x.files.length<1||x.files.length>16)return false;
 const paths=new Set<string>();
 let total=0;
 for(const rawFile of x.files){
  if(typeof rawFile!=="object"||rawFile===null||Array.isArray(rawFile))
   return false;
  const file=rawFile as Record<string,unknown>;
  if(Object.keys(file).sort().join(",")!=="content,path"||
   typeof file.path!=="string"||typeof file.content!=="string"||
   file.path==="package.json"||file.content.includes("\u0000"))return false;
  try{assertWorkspacePath(file.path);}catch{return false;}
  const key=file.path.toLowerCase();
  if(paths.has(key))return false;
  paths.add(key);
  const bytes=new TextEncoder().encode(file.content).byteLength;
  total+=bytes;
  if(bytes<1||bytes>64*1024||total>192*1024)return false;
 }
 return true;
}
// eslint-disable-next-line complexity -- Creator, zero-cost, CAS and hash lineage must all fail closed.\nexport async function importOwnerFreeSource(input:FreeImportInput,ctx:{
 readonly db:AgentJobExecutor;readonly jobId:string;readonly ownerThumb:string;
}):Promise<{status:"IMPORTED_NO_AI"|"ALREADY_IMPORTED_NO_AI";
 project_hash:string;revision:number;app_published:false}>{
 if(!validFreeImportInput(input))throw Error("FREE_IMPORT_INVALID");
 const rows=await ctx.db.query<{job_id:string}>(
  "SELECT job_id::text FROM public.appf2_agent_job "+
  "WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid "+
  "AND owner_key_thumbprint=$3::text LIMIT 1",
  [ctx.jobId,input.anonymous_id,ctx.ownerThumb]);
 if(rows.rows[0]?.job_id!==ctx.jobId)throw Error("FREE_IMPORT_NOT_CREATOR");
 let current=await recoverAgentJob(ctx.db,ctx.jobId,input.anonymous_id);
 if(!current||current.job.checkpoint.step!==0||
  current.job.checkpoint.cost_cents!==0||
  current.job.checkpoint.tokens_used!==0||
  current.job.checkpoint.budget.max_cost_cents!==0)
  throw Error("FREE_IMPORT_NOT_ZERO_COST");
 if(current.job.job_state==="CODING"&&current.job.revision===2&&
  current.project.revision===2&&
  current.project.parent_hash===input.expected_project_hash&&
  input.files.every(f=>current?.project.files.some(x=>x.path===f.path&&
   x.content===f.content)))
  return {status:"ALREADY_IMPORTED_NO_AI",project_hash:current.project.project_hash,
   revision:current.job.revision,app_published:false};
 if(current.project.revision!==1||
  current.project.project_hash!==input.expected_project_hash||
  !(["CREATED","PLANNING"].includes(current.job.job_state))||
  (current.job.job_state==="CREATED"?current.job.revision!==0:current.job.revision!==1))
  throw Error("FREE_IMPORT_STALE_HEAD");
 if(current.job.job_state==="CREATED"){
  const next={...current.job.checkpoint,state:"PLANNING" as const,
   previous_checkpoint_id:current.job.checkpoint_hash};
  current=await advanceDurableAgentJob(ctx.db,current.job,input.anonymous_id,next);
 }
 const existing=new Map(current.project.files.map(f=>[f.path,f]));
 const edited=input.files.map(f=>{
  const before=existing.get(f.path);
  return before?{operation:"replace" as const,path:f.path,content:f.content,
   previous_hash:before.hash}:{operation:"add" as const,path:f.path,content:f.content};
 });
 if(edited.every(f=>existing.get(f.path)?.content===f.content))
  throw Error("FREE_IMPORT_NO_SOURCE_CHANGE");
 const project=await applyProjectEdits(current.project,input.expected_project_hash,edited);
 const cp={...current.job.checkpoint,state:"CODING" as const,
  project_hash:project.project_hash,
  previous_checkpoint_id:current.job.checkpoint_hash};
 const saved=await advanceDurableAgentJob(ctx.db,current.job,input.anonymous_id,cp,project);
 if(saved.job.revision!==2||saved.project.revision!==2)
  throw Error("FREE_IMPORT_NOT_DURABLE");
 return {status:"IMPORTED_NO_AI",project_hash:saved.project.project_hash,
  revision:saved.job.revision,app_published:false};
}
