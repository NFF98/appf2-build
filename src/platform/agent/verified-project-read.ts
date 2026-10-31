/** Safe data-only read from an owner-verified immutable project snapshot.
 * No worker filesystem access, no model-owned paths outside the workspace.
 * Reconstructed again for the next Responses turn from the identical source hash.
 */
import {sha256CodeBytes} from "../blueprint/code-artifact-v2.js";
import type {AgentToolCall} from "./agent-contract.js";
import type {ProjectSnapshot} from "./project-workspace.js";
import type {SandboxEvidence} from "./sandbox-adapter.js";

export async function provenProjectRead(project:ProjectSnapshot,
 call:AgentToolCall):Promise<SandboxEvidence>{
 if(call.name!=="read_file"||call.project_hash!==project.project_hash)
  throw Error("AGENT_READ_PROJECT_MISMATCH");
 const file=project.files.find(f=>f.path===call.args.path);
 // Model sees source plus its immutable file hash, never a host path.
 // Large or escape-heavy contents are explicitly truncated, not silently dropped.
 let excerpt=file?.content.slice(0,2800)??"";
 const describe=()=>JSON.stringify({path:call.args.path,found:Boolean(file),
  file_hash:file?.hash??null,total_bytes:file?.bytes??0,
  truncated:Boolean(file&&excerpt.length<file.content.length),content:excerpt});
 let detail=describe();
 while(detail.length>3900&&excerpt.length>0){
  excerpt=excerpt.slice(0,Math.floor(excerpt.length*0.75));
  detail=describe();
 }
 if(detail.length>4096)throw Error("AGENT_READ_RESPONSE_OVERSIZED");
 return {call_id:call.call_id,project_hash:project.project_hash,
  exit_code:0,timed_out:false,detail,
  output_digest:await sha256CodeBytes(new TextEncoder().encode(detail)),
  runner_attestation:"APPF2_IMMUTABLE_PROJECT_READ_V1"};
}
