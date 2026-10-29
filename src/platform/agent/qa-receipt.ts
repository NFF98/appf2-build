/**
 * Sprint 3.5 candidate QA: untrusted strings are NEVER independent proof.
 * A private, separately trusted verifier may HMAC-seal its result; public
 * model output, sandbox logs and CI fixtures cannot grant publication.
 */
import {canonicalArtifactJson} from "../blueprint/code-artifact-v2.js";
export type QaCheck={
 readonly criterion_id:string;
 readonly category:"BUILD"|"UNIT"|"INTEGRATION"|"BROWSER"|"API"|"DATABASE"|"HUMAN";
 readonly verdict:"PASS"|"FAIL"|"UNTESTED";
 readonly evidence_hash:string|null;
};
export type CandidateQaReceipt={
 readonly version:"APPF2_CANDIDATE_QA_V1";
 readonly source_project_hash:string;
 readonly built_artifact_hash:string;
 readonly sandbox_execution_id:string;
 readonly checks:readonly QaCheck[];
 readonly runner_attestation:string|null;
};
export type QaSummary={readonly ready_for_review:boolean;readonly failures:readonly string[]};
export type CandidateQaIdentity={
 readonly project_hash:string;
 readonly artifact_hash:string;
 readonly sandbox_execution_id:string;
};
const SHA=/^sha256:[0-9a-f]{64}$/u;
const MAC=/^hmac-sha256:[a-f0-9]{64}$/u;
const ID=/^[A-Za-z0-9_-]{8,100}$/u;
const CRITERION=/^[a-z][a-z0-9_]{0,79}$/u;
const CATEGORIES=new Set(["BUILD","UNIT","INTEGRATION","BROWSER","API","DATABASE","HUMAN"]);
function shape(receipt:CandidateQaReceipt,required:readonly string[]):string[]{
 const failures:string[]=[];
 if(!SHA.test(receipt.source_project_hash)||!SHA.test(receipt.built_artifact_hash)||
   receipt.version!=="APPF2_CANDIDATE_QA_V1"||
   !ID.test(receipt.sandbox_execution_id))failures.push("INVALID_SOURCE_OR_BUILD");
 if(!Array.isArray(receipt.checks)||receipt.checks.length===0||receipt.checks.length>100)
  return [...failures,"NO_BOUNDED_QA_CHECKS"];
 const seen=new Set<string>();
 for(const item of receipt.checks){
  if(!item||!CRITERION.test(item.criterion_id)||!CATEGORIES.has(item.category)){
   failures.push("QA_INVALID_CRITERION");
   continue;
  }
  if(seen.has(item.criterion_id))failures.push("DUPLICATE:"+item.criterion_id);
  seen.add(item.criterion_id);
  if(item.verdict!=="PASS"||!SHA.test(item.evidence_hash??""))
   failures.push("NOT_PROVEN:"+item.criterion_id);
 }
 if(required.length===0||required.length>100||
  required.some(x=>!CRITERION.test(x))||
  new Set(required).size!==required.length)failures.push("INVALID_REQUIREMENTS");
 for(const id of required)if(!seen.has(id))failures.push("MISSING:"+id);
 return failures;
}
function signedBytes(receipt:CandidateQaReceipt):Uint8Array<ArrayBuffer>{
 const {runner_attestation,...content}=receipt;
 void runner_attestation;
 return new TextEncoder().encode(
  "APPF2_CANDIDATE_QA_SEAL_V1\u0000"+canonicalArtifactJson(content));
}
function keyMaterial(secret:string):Uint8Array<ArrayBuffer>{
 if(secret.length<32||secret.length>512)throw Error("QA_INDEPENDENT_KEY_REQUIRED");
 return new TextEncoder().encode(secret);
}
function toHex(bytes:Uint8Array):string{
 return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
}
/** For a trusted independent verifier ONLY, after real build/browser QA. */
export async function sealCandidateQaReceipt(receipt:CandidateQaReceipt,
 secret:string):Promise<CandidateQaReceipt>{
 const problems=shape(receipt,receipt.checks.map(c=>c.criterion_id));
 if(problems.length)throw Error("QA_CANNOT_SEAL_UNPROVEN_CHECKS");
 const key=await crypto.subtle.importKey("raw",keyMaterial(secret),
  {name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const signed=await crypto.subtle.sign("HMAC",key,signedBytes(receipt));
 return {...receipt,runner_attestation:"hmac-sha256:"+toHex(new Uint8Array(signed))};
}
async function validSeal(receipt:CandidateQaReceipt,secret:string):Promise<boolean>{
 if(!MAC.test(receipt.runner_attestation??""))return false;
 try{
  const key=await crypto.subtle.importKey("raw",keyMaterial(secret),
   {name:"HMAC",hash:"SHA-256"},false,["verify"]);
  const hex=(receipt.runner_attestation??"").slice("hmac-sha256:".length);
  const sig=new Uint8Array(hex.length/2);
  for(let i=0;i<sig.length;i++)sig[i]=Number.parseInt(hex.slice(i*2,i*2+2),16);
  return crypto.subtle.verify("HMAC",key,sig,signedBytes(receipt));
 }catch{return false;}
}
/**
 * A plain receipt can NEVER claim independent QA. This intentionally changes
 * prior behavior that accepted any nonempty runner_attestation string.
 */
export function summarizeCandidateQa(receipt:CandidateQaReceipt,
 required:readonly string[]):QaSummary{
 return {ready_for_review:false,
  failures:["INDEPENDENT_SIGNATURE_NOT_VERIFIED",...shape(receipt,required)]};
}
/** Verified source/artifact/run identity + real HMAC; still NEVER publication. */
export async function verifySignedCandidateQa(receipt:CandidateQaReceipt,
 required:readonly string[],identity:CandidateQaIdentity,secret:string):Promise<QaSummary>{
 const failures=shape(receipt,required);
 if(receipt.source_project_hash!==identity.project_hash||
   receipt.built_artifact_hash!==identity.artifact_hash||
   receipt.sandbox_execution_id!==identity.sandbox_execution_id)
  failures.push("QA_SOURCE_ARTIFACT_OR_RUN_MISMATCH");
 if(!(await validSeal(receipt,secret)))failures.push("QA_INDEPENDENT_SEAL_INVALID");
 return {ready_for_review:failures.length===0,failures};
}
/** F02 requires a distinct audited release admission, never candidate QA alone. */
export function admitsPublicationFromCandidateReceipt(receipt:CandidateQaReceipt):false{
 void receipt;
 return false;
}
