/** Read-only build provenance for private candidate preview and independent QA.
 * Unlike the recent-eight model summary, this examines the exact signed
 * checkpoint IDs and saved Sandbox journal. No cloud or paid call occurs.
 */
import {getModelCall} from "../platform/agent/postgres-model-calls.js";
import {parseAgentResponsesBatch} from "../platform/agent/responses-api.js";
import type {AgentJobExecutor} from "../platform/agent/postgres-agent-jobs.js";
const HASH=/^sha256:[a-f0-9]{64}$/u;
type Stored={readonly call_id:string;readonly model_call_key:string;
 readonly job_revision:number;readonly checkpoint_hash:string;
 readonly job_id:string;readonly owner_anonymous_id:string;
 readonly project_hash:string;readonly status:string;readonly receipt_json:unknown};
export type ProvenPreviewPair={readonly build_call_id:string;
 readonly test_call_id:string};
/** Exact Sandbox attestation + source, not a model-authored PASS. */
function signedSuccess(row:Stored,jobId:string,owner:string,hash:string):boolean{
 const v=row.receipt_json;
 if(row.job_id!==jobId||row.owner_anonymous_id!==owner||
  row.project_hash!==hash||row.status!=="SUCCEEDED"||
  !Number.isSafeInteger(row.job_revision)||row.job_revision<0||
  typeof v!=="object"||v===null||Array.isArray(v))return false;
 const e=v as Record<string,unknown>;
 return e.call_id===row.call_id&&e.project_hash===hash&&
  e.runner_attestation==="APPF2_ISOLATED_CLOUDFLARE_CONTAINER_V1"&&
  e.exit_code===0&&e.timed_out===false&&
  HASH.test(String(e.output_digest));
}
/** Tool identity comes from the journaled model response, never a filename
 * guess, browser value or an arbitrary container receipt.
 */
async function provenTool(row:Stored,tool:"run_build"|"run_test",
 db:AgentJobExecutor,jobId:string,owner:string,hash:string):Promise<boolean>{
 if(!signedSuccess(row,jobId,owner,hash))return false;
 const model=await getModelCall(db,jobId,owner,row.model_call_key);
 if(model?.status!=="SUCCEEDED"||!model.response_json||
  !model.response_id||model.job_revision!==row.job_revision||
  model.checkpoint_hash!==row.checkpoint_hash)return false;
 const parsed=parseAgentResponsesBatch(model.response_json,hash);
 return parsed?.response_id===model.response_id&&
  parsed.calls.length===1&&parsed.calls[0]?.call_id===row.call_id&&
  parsed.calls[0]?.name===tool;
}
/** Only current-source calls contained in the immutable checkpoint are
 * eligible. A run_test must be the last tool; read/inspect may separate it
 * from a prior run_build. A later failed or changed-source build is excluded.
 */
export async function inspectProvenPreviewPair(db:AgentJobExecutor,jobId:string,
 owner:string,projectHash:string,completed:readonly string[]):
 Promise<ProvenPreviewPair|null>{
 if(!HASH.test(projectHash)||completed.length<2||completed.length>512||
  new Set(completed).size!==completed.length)return null;
 const last=completed.at(-1);
 if(!last)return null;
 const rows=(await db.query<Stored>(
  "SELECT job_id::text,owner_anonymous_id::text,call_id,model_call_key,"+
  "job_revision,checkpoint_hash,project_hash,status,receipt_json "+
  "FROM public.appf2_agent_sandbox_call WHERE job_id=$1::uuid "+
  "AND owner_anonymous_id=$2::uuid AND project_hash=$3::text "+
  "AND call_id=ANY($4::text[])",
  [jobId,owner,projectHash,completed])).rows;
 if(rows.length>completed.length)return null;
 const byId=new Map(rows.map(row=>[row.call_id,row]));
 if(byId.size!==rows.length)return null;
 const test=byId.get(last);
 if(!test||!await provenTool(test,"run_test",db,jobId,owner,projectHash))
  return null;
 for(let i=completed.length-2;i>=0;i--){
  const id=completed[i];
  if(!id)continue;
  const build=byId.get(id);
  if(build&&build.job_revision<=test.job_revision&&
   await provenTool(build,"run_build",db,jobId,owner,projectHash))
   return {build_call_id:id,test_call_id:last};
 }
 return null;
}
