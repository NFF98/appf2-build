/**
 * Immutable source snapshot journal. This persists the actual bytes, not merely
 * a hash-bound Job row. The caller must provide a trusted owner-scoped DB context.
 * Never exposes the source through public App/F02 routes.
 */
import {verifyProjectSnapshot,type ProjectSnapshot} from "./project-workspace.js";
import type {AgentJobExecutor} from "./postgres-agent-jobs.js";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const HASH=/^sha256:[0-9a-f]{64}$/u;
const LOAD=`SELECT project_hash,parent_hash,project_revision,snapshot
 FROM public.appf2_agent_project_snapshot
 WHERE owner_anonymous_id=$1::uuid AND project_hash=$2::text LIMIT 1`;
const INSERT=`INSERT INTO public.appf2_agent_project_snapshot
 (owner_anonymous_id,project_hash,parent_hash,project_revision,snapshot)
 VALUES($1::uuid,$2::text,$3::text,$4::integer,$5::jsonb)
 ON CONFLICT(owner_anonymous_id,project_hash) DO NOTHING
 RETURNING project_hash`;
type SnapshotRecord={readonly project_hash:string;readonly parent_hash:string|null;
 readonly project_revision:number;readonly snapshot:unknown};
async function validRecord(record:SnapshotRecord,expectedHash:string):Promise<ProjectSnapshot>{
 if(record.project_hash!==expectedHash||!HASH.test(expectedHash)||
   !(await verifyProjectSnapshot(record.snapshot)))throw Error("AGENT_PROJECT_BYTES_CORRUPTED");
 const snapshot=record.snapshot as ProjectSnapshot;
 if(record.project_revision!==snapshot.revision||record.parent_hash!==snapshot.parent_hash||
   snapshot.project_hash!==expectedHash)throw Error("AGENT_PROJECT_METADATA_MISMATCH");
 return snapshot;
}
export async function readAgentProjectSnapshot(db:AgentJobExecutor,owner:string,
 projectHash:string):Promise<ProjectSnapshot|null>{
 if(!UUID.test(owner)||!HASH.test(projectHash))throw Error("AGENT_PROJECT_LOOKUP_INVALID");
 const row=(await db.query<SnapshotRecord>(LOAD,[owner,projectHash])).rows[0];
 return row?validRecord(row,projectHash):null;
}
/**
 * Write-once with parent FK. Any lost response is safely re-read; a duplicate
 * snapshot with identical hash and different bytes cannot be accepted.
 */
export async function persistAgentProjectSnapshot(db:AgentJobExecutor,owner:string,
 project:ProjectSnapshot):Promise<ProjectSnapshot>{
 if(!UUID.test(owner)||!(await verifyProjectSnapshot(project))||
   project.revision>512)throw Error("AGENT_PROJECT_INVALID");
 if(project.parent_hash!==null){
  const parent=await readAgentProjectSnapshot(db,owner,project.parent_hash);
  if(!parent||parent.revision+1!==project.revision)
   throw Error("AGENT_PROJECT_PARENT_MISSING");
 }
 await db.query<{project_hash:string}>(INSERT,[owner,project.project_hash,
  project.parent_hash,project.revision,JSON.stringify(project)]);
 const received=await readAgentProjectSnapshot(db,owner,project.project_hash);
 if(!received)throw Error("AGENT_PROJECT_NOT_DURABLE");
 return received;
}
