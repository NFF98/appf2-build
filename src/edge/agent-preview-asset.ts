/** Owner-signed, read-only private compiled asset preview.
 * Never recompiles, publishes, or accepts model/owner-supplied PASS claims.
 * The broker will only return the matching last successful built tree.
 */
import {recoverAgentJob} from "../platform/agent/durable-agent-service.js";
import {validBuiltAssetRequest,builtAssetContentType,MAX_BUILT_ASSET_BYTES}
 from "../platform/agent/private-built-artifact.js";
import {sandboxJobAllowed} from "../platform/agent/private-sandbox-authorization.js";
import type {AgentJobExecutor} from "../platform/agent/postgres-agent-jobs.js";
import type {SandboxServiceBinding} from "./agent-sandbox-run.js";

export type PreviewAssetInput={
 readonly anonymous_id:string;readonly expected_revision:number;
 readonly project_hash:string;readonly build_call_id:string;
 readonly test_call_id:string;readonly path:string;
 readonly explicit_container_preview_consent:true;
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export function validPreviewAssetBody(raw:unknown):raw is PreviewAssetInput{
 if(typeof raw!=="object"||raw===null||Array.isArray(raw))return false;
 const v=raw as Record<string,unknown>;
 return Object.keys(v).sort().join(",")===
  "anonymous_id,build_call_id,expected_revision,explicit_container_preview_consent,path,project_hash,test_call_id"&&
  typeof v.anonymous_id==="string"&&UUID.test(v.anonymous_id)&&
  Number.isSafeInteger(v.expected_revision)&&Number(v.expected_revision)>=1&&
  v.explicit_container_preview_consent===true&&
  typeof v.test_call_id==="string"&&v.test_call_id!==v.build_call_id&&
  validBuiltAssetRequest({job_id:v.anonymous_id,
   project_hash:v.project_hash,build_call_id:v.build_call_id,path:v.path});
}
type SavedSandbox={
 readonly call_id:string;readonly project_hash:string;readonly status:string;
 readonly receipt_json:unknown;
};
function passed(row:SavedSandbox|undefined,call:string,hash:string):boolean{
 if(!row||row.call_id!==call||row.project_hash!==hash||
  row.status!=="SUCCEEDED"||typeof row.receipt_json!=="object"||
  row.receipt_json===null||Array.isArray(row.receipt_json))return false;
 const e=row.receipt_json as Record<string,unknown>;
 return e.call_id===call&&e.project_hash===hash&&
  e.exit_code===0&&e.timed_out===false&&
  e.runner_attestation==="APPF2_ISOLATED_CLOUDFLARE_CONTAINER_V1";
}
// eslint-disable-next-line complexity -- Owner PoP, saved build/test proof and private broker must all fail closed.
export async function readSignedPreviewAsset(input:PreviewAssetInput,deps:{
 readonly db:AgentJobExecutor;readonly jobId:string;
 readonly owner:string;readonly ownerThumb:string;
 readonly brokerService?:SandboxServiceBinding;
 readonly brokerToken:string;readonly allowedJobId:string;
}):Promise<{path:string;text:string;content_type:string;project_hash:string}>{
 if(!validPreviewAssetBody(input)||input.anonymous_id!==deps.owner||
  !sandboxJobAllowed(deps.allowedJobId,deps.jobId)||
  !deps.brokerService||typeof deps.brokerService.fetch!=="function"||
  deps.brokerToken.length<32||deps.brokerToken.length>512)
  throw Error("PREVIEW_PRIVATE_BROKER_DISABLED");
 const creator=(await deps.db.query<{job_id:string}>(
  "SELECT job_id::text FROM public.appf2_agent_job WHERE job_id=$1::uuid "+
  "AND owner_anonymous_id=$2::uuid AND owner_key_thumbprint=$3::text LIMIT 1",
  [deps.jobId,deps.owner,deps.ownerThumb])).rows[0];
 if(creator?.job_id!==deps.jobId)throw Error("PREVIEW_CREATOR_NOT_PROVEN");
 const current=await recoverAgentJob(deps.db,deps.jobId,deps.owner);
 if(!current||current.job.revision!==input.expected_revision||
  current.project.project_hash!==input.project_hash||
  !["TESTING","REPAIRING"].includes(current.job.job_state))
  throw Error("PREVIEW_PROJECT_REVISION_MISMATCH");
 const completed=current.job.checkpoint.completed_call_ids;
 // AI may inspect or read project files between a successful build and the
 // final run_test without changing the immutable source snapshot. Require
 // the latest test and an earlier build in the same signed checkpoint, not
 // arbitrary adjacency. Both container receipts are independently checked.
 if(completed.at(-1)!==input.test_call_id||
  completed.indexOf(input.build_call_id)<0||
  completed.indexOf(input.build_call_id)>=completed.lastIndexOf(input.test_call_id))
  throw Error("PREVIEW_NOT_LAST_PROVEN_BUILD_AND_TEST");
 const rows=await deps.db.query<SavedSandbox>(
  "SELECT call_id,project_hash,status,receipt_json "+
  "FROM public.appf2_agent_sandbox_call WHERE job_id=$1::uuid "+
  "AND owner_anonymous_id=$2::uuid AND call_id IN ($3::text,$4::text)",
  [deps.jobId,deps.owner,input.build_call_id,input.test_call_id]);
 const build=rows.rows.find(r=>r.call_id===input.build_call_id);
 const test=rows.rows.find(r=>r.call_id===input.test_call_id);
 if(!passed(build,input.build_call_id,input.project_hash)||
  !passed(test,input.test_call_id,input.project_hash))
  throw Error("PREVIEW_SUCCESSFUL_BUILD_TEST_NOT_PROVEN");
 const request={job_id:deps.jobId,project_hash:input.project_hash,
  build_call_id:input.build_call_id,path:input.path};
 if(!validBuiltAssetRequest(request))
  throw Error("PREVIEW_ASSET_PATH_REJECTED");
 // No public URL or credentials enter the candidate sandboxed iframe.
 const response=await deps.brokerService.fetch(new Request(
  "https://appf2-private-sandbox.invalid/internal/build-asset",{
   method:"POST",headers:{"Authorization":"Bearer "+deps.brokerToken,
    "Content-Type":"application/json"},
   body:JSON.stringify(request),signal:AbortSignal.timeout(12000)
  }));
 if(!response.ok)throw Error("PREVIEW_BUILT_ASSET_UNAVAILABLE");
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(bytes.length<1||bytes.length>MAX_BUILT_ASSET_BYTES)
  throw Error("PREVIEW_ASSET_SIZE_INVALID");
 let text:string;
 try{text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}
 catch{throw Error("PREVIEW_ASSET_ENCODING_INVALID");}
 return {path:input.path,text,project_hash:input.project_hash,
  content_type:builtAssetContentType(input.path)};
}
