/** Trusted independent QA packet: binds complete pre-code plan, original prompt,
 * current project, sandbox run and receipt. Never grants publication. */
import {canonicalArtifactJson,sha256CodeBytes} from "../blueprint/code-artifact-v2.js";
import {parseQaPlan,type QaPlan} from "../qa/requirement-contract.js";
import {sealCandidateQaReceipt,verifySignedQaAgainstUserPrompt,
 type CandidateQaReceipt,type QaSummary} from "./qa-receipt.js";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAC=/^hmac-sha256:[a-f0-9]{64}$/u;
export type AgentQaPacket={readonly version:"APPF2_AGENT_QA_PACKET_V1";
 readonly job_id:string;readonly original_prompt:string;
 readonly original_plan:QaPlan;readonly receipt:CandidateQaReceipt;
 readonly packet_seal:string|null};
function keyBytes(secret:string):Uint8Array<ArrayBuffer>{
 if(secret.length<32||secret.length>512)throw Error("QA_VERIFIER_KEY_INVALID");
 return new TextEncoder().encode(secret);
}
function payload(packet:AgentQaPacket):Uint8Array<ArrayBuffer>{
 const {packet_seal,...signed}=packet;void packet_seal;
 return new TextEncoder().encode("APPF2_AGENT_QA_PACKET_SEAL_V1\u0000"+
  canonicalArtifactJson(signed));
}
const hex=(bytes:Uint8Array)=>Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
const bytes=(h:string):Uint8Array<ArrayBuffer>=>Uint8Array.from({length:32},
 (_,i)=>Number.parseInt(h.slice(12+i*2,14+i*2),16));
/** This function is for the trusted verifier only; never exposed in a route. */
export async function sealAgentQaPacket(input:Omit<AgentQaPacket,"packet_seal">,
 secret:string):Promise<AgentQaPacket>{
 const plan=parseQaPlan(input.original_plan,input.original_prompt);
 if(!UUID.test(input.job_id)||!plan||plan.criteria.some(c=>!c.automatable))
  throw Error("QA_PACKET_UNVERIFIABLE_PLAN");
 const receipt=await sealCandidateQaReceipt(input.receipt,secret);
 const packet:AgentQaPacket={...input,receipt,packet_seal:null};
 const key=await crypto.subtle.importKey("raw",keyBytes(secret),
  {name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const mac=await crypto.subtle.sign("HMAC",key,payload(packet));
 return {...packet,packet_seal:"hmac-sha256:"+hex(new Uint8Array(mac))};
}
function record(x:unknown):x is Record<string,unknown>{
 return typeof x==="object"&&x!==null&&!Array.isArray(x);
}
// eslint-disable-next-line complexity -- Every independent prompt, plan, signed receipt and packet field fails closed.
export function validAgentQaPacket(x:unknown):x is AgentQaPacket{
 if(!record(x)||Object.keys(x).sort().join(",")!==
  "job_id,original_plan,original_prompt,packet_seal,receipt,version"||
  x.version!=="APPF2_AGENT_QA_PACKET_V1"||
  typeof x.job_id!=="string"||!UUID.test(x.job_id)||
  typeof x.original_prompt!=="string"||
  x.original_prompt.trim().length<5||x.original_prompt.length>800||
  typeof x.packet_seal!=="string"||!MAC.test(x.packet_seal)||
  !record(x.receipt)||!Array.isArray(x.receipt.checks)||
  x.receipt.checks.length<1||x.receipt.checks.length>100)return false;
 const r=x.receipt;
 return typeof r.source_project_hash==="string"&&
  typeof r.built_artifact_hash==="string"&&
  typeof r.sandbox_execution_id==="string"&&
  typeof r.runner_attestation==="string"&&
  Array.isArray(r.checks)&&r.checks.every((c:unknown)=>record(c)&&
   typeof c.criterion_id==="string"&&
   typeof c.category==="string"&&typeof c.verdict==="string"&&
   (c.evidence_hash===null||typeof c.evidence_hash==="string"))&&
  parseQaPlan(x.original_plan,x.original_prompt)!==null;
}
/** Both seals verified independently; no publish authority returned. */
export async function verifyAgentQaPacket(input:unknown,expected:{
 readonly job_id:string;readonly original_prompt_hash:string;
 readonly project_hash:string;readonly sandbox_execution_id:string;
},secret:string):Promise<QaSummary>{
 if(!validAgentQaPacket(input))return {ready_for_review:false,
  failures:["QA_PACKET_INVALID"]};
 const failures:string[]=[];
 if(input.job_id!==expected.job_id)failures.push("QA_JOB_MISMATCH");
 const digest=await sha256CodeBytes(new TextEncoder().encode(
  "APPF2_AGENT_REQUEST_V1\u0000"+input.original_prompt.trim()));
 if(digest!==expected.original_prompt_hash)failures.push("QA_PROMPT_MISMATCH");
 if(input.receipt.source_project_hash!==expected.project_hash||
  input.receipt.sandbox_execution_id!==expected.sandbox_execution_id)
  failures.push("QA_PROJECT_OR_SANDBOX_MISMATCH");
 let verified=false;
 try{
  const key=await crypto.subtle.importKey("raw",keyBytes(secret),
   {name:"HMAC",hash:"SHA-256"},false,["verify"]);
  verified=await crypto.subtle.verify("HMAC",key,
   bytes(input.packet_seal!),payload(input));
 }catch{verified=false;}
 if(!verified)failures.push("QA_PACKET_SEAL_INVALID");
 const result=await verifySignedQaAgainstUserPrompt(input.receipt,
  input.original_plan,input.original_prompt,{
   project_hash:expected.project_hash,
   artifact_hash:input.receipt.built_artifact_hash,
   sandbox_execution_id:expected.sandbox_execution_id
  },secret);
 return {ready_for_review:failures.length===0&&result.ready_for_review,
  failures:[...failures,...result.failures]};
}
