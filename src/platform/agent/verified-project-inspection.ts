/**
 * Bounded, immutable, data-only project inspection.
 * No host filesystem, OS commands, network or generated code execution.
 * In the single inspect_project tool, path "." lists the directory and
 * path "<file>" reads a Unicode-safe source chunk from cursor `offset`.
 * Every response binds to the source snapshot hash and the file SHA-256.
 */
import {sha256CodeBytes} from "../blueprint/code-artifact-v2.js";
import {assertWorkspacePath,type ProjectSnapshot} from "./project-workspace.js";
import type {AgentToolCall} from "./agent-contract.js";
import type {SandboxEvidence} from "./sandbox-adapter.js";

const CURSOR=/^(?:0|[1-9][0-9]{0,5})$/u;
const FILE_CHARS=2000;
const DIRECTORY_FILES=10;
export function inspectProjectArgs(path:string,offset:string):boolean{
 if(typeof path!=="string"||typeof offset!=="string"||
  !CURSOR.test(offset)||Number(offset)>262144)return false;
 if(path===".")return true;
 try{assertWorkspacePath(path);return true;}catch{return false;}
}
export async function provenProjectInspection(project:ProjectSnapshot,
 call:AgentToolCall):Promise<SandboxEvidence>{
 if(call.name!=="inspect_project"||call.project_hash!==project.project_hash||
  !inspectProjectArgs(call.args.path,call.args.offset))
  throw Error("AGENT_INSPECT_PROJECT_UNVERIFIED");
 const offset=Number(call.args.offset);
 let detail:string;
 if(call.args.path==="."){
  const files=project.files.slice(offset,offset+DIRECTORY_FILES)
   .map(f=>({path:f.path,bytes:f.bytes,hash:f.hash}));
  detail=JSON.stringify({kind:"DIRECTORY",project_hash:project.project_hash,
   total_files:project.files.length,offset,files,
   next_offset:offset+files.length<project.files.length?offset+files.length:null});
 }else{
  const file=project.files.find(f=>f.path===call.args.path);
  if(!file){
   detail=JSON.stringify({kind:"FILE",project_hash:project.project_hash,
    path:call.args.path,found:false});
  }else{
   // Unicode code point offsets avoid resuming in the middle of emoji/漢字.
   const codepoints=Array.from(file.content);
   let characters=codepoints.slice(offset,offset+FILE_CHARS);
   const describe=()=>JSON.stringify({kind:"FILE",
    project_hash:project.project_hash,path:file.path,found:true,
    file_hash:file.hash,total_bytes:file.bytes,
    total_characters:codepoints.length,offset,
    next_offset:offset+characters.length<codepoints.length?
     offset+characters.length:null,
    content:characters.join("")});
   detail=describe();
   while(detail.length>3900&&characters.length>1){
    characters=characters.slice(0,Math.floor(characters.length*0.75));
    detail=describe();
   }
  }
 }
 if(detail.length>4096)throw Error("AGENT_INSPECT_RESPONSE_OVERSIZED");
 return {call_id:call.call_id,project_hash:call.project_hash,
  exit_code:0,timed_out:false,detail,
  output_digest:await sha256CodeBytes(new TextEncoder().encode(detail)),
  runner_attestation:"APPF2_IMMUTABLE_PROJECT_INSPECT_V1"};
}
