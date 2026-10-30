/** Private independent Chromium QA. All credentials and browser cost consent
 * are assigned by the trusted Worker, never by generated App source.
 */
import {parseQaPlan,type QaPlan} from "../qa/requirement-contract.js";
import {sha256CodeBytes} from "../blueprint/code-artifact-v2.js";
export type PrivateBrowserQaTask={
 readonly job_id:string;
 readonly project_hash:string;
 readonly build_call_id:string;
 readonly test_call_id:string;
 readonly original_prompt:string;
 readonly original_plan:QaPlan;
 readonly explicit_browser_qa_consent:true;
};
export type PrivateQaCheck={readonly criterion_id:string;
 readonly category:"BROWSER";readonly verdict:"PASS"|"FAIL"|"UNTESTED";
 readonly evidence_hash:string|null};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA=/^sha256:[a-f0-9]{64}$/u;
const CALL=/^call_[A-Za-z0-9_-]{4,74}$/u;
// eslint-disable-next-line complexity -- Every untrusted payment and QA field fails closed.
export function validPrivateBrowserQaTask(x:unknown):x is PrivateBrowserQaTask{
 if(typeof x!=="object"||x===null||Array.isArray(x))return false;
 const v=x as Record<string,unknown>;
 if(Object.keys(v).sort().join(",")!==
  "build_call_id,explicit_browser_qa_consent,job_id,original_plan,original_prompt,project_hash,test_call_id"||
  typeof v.job_id!=="string"||!UUID.test(v.job_id)||
  typeof v.project_hash!=="string"||!SHA.test(v.project_hash)||
  typeof v.build_call_id!=="string"||!CALL.test(v.build_call_id)||
  typeof v.test_call_id!=="string"||!CALL.test(v.test_call_id)||
  v.test_call_id===v.build_call_id||
  typeof v.original_prompt!=="string"||v.original_prompt.trim().length<5||
  v.original_prompt.length>800||v.explicit_browser_qa_consent!==true)return false;
 const plan=parseQaPlan(v.original_plan,v.original_prompt);
 return plan!==null&&plan.criteria.length<=10;
}
/** Independently verify every reported criterion before persisting failure evidence. */
export function validQaObservedChecks(plan:QaPlan,raw:unknown):raw is PrivateQaCheck[]{
 if(!Array.isArray(raw)||raw.length!==plan.criteria.length)return false;
 return plan.criteria.every((c,i)=>{
  const r:unknown=raw[i];
  if(typeof r!=="object"||r===null||Array.isArray(r))return false;
  const x=r as Record<string,unknown>;
  return Object.keys(x).sort().join(",")===
   "category,criterion_id,evidence_hash,verdict"&&
   x.criterion_id===c.id&&x.category==="BROWSER"&&
   (x.verdict==="PASS"?
    /^sha256:[0-9a-f]{64}$/u.test(String(x.evidence_hash)):
    (x.verdict==="FAIL"||x.verdict==="UNTESTED")&&x.evidence_hash===null);
 });
}
/** Browser QA can never silently accept unknown/unsupported requirements. */
export function strictQaChecks(plan:QaPlan,observed:readonly PrivateQaCheck[]):boolean{
 return plan.criteria.length===observed.length&&
  plan.criteria.every((criterion,i)=>criterion.automatable&&
   observed[i]?.criterion_id===criterion.id&&
   observed[i]?.verdict==="PASS"&&
   /^sha256:[0-9a-f]{64}$/u.test(observed[i].evidence_hash??""));
}

/** Independent QA PASS digest binds the actual DOM observed before/after
 * the browser actions, not merely static expected assertion text. The raw
 * page body never leaves the private verifier; only its SHA-256 is persisted.
 */
export async function observedBrowserEvidenceHash(task:PrivateBrowserQaTask,
 criterionId:string,before:string,after:string,assetPaths:readonly string[]
):Promise<string>{
 if(!validPrivateBrowserQaTask(task)||
  !task.original_plan.criteria.some(c=>c.id===criterionId&&c.automatable)||
  typeof before!=="string"||typeof after!=="string"||
  before.length>100000||after.length>100000||
  !Array.isArray(assetPaths)||assetPaths.length<1||assetPaths.length>256||
  assetPaths.some(p=>typeof p!=="string"||p.length<1||p.length>180)||
  !assetPaths.includes("index.html"))
  throw Error("QA_OBSERVED_EVIDENCE_INVALID");
 const digest=async (value:string):Promise<string>=>sha256CodeBytes(new TextEncoder().encode(value));
 const evidence={
  version:"APPF2_ACTUAL_BROWSER_OBSERVATION_V1",
  job_id:task.job_id,project_hash:task.project_hash,
  build_call_id:task.build_call_id,test_call_id:task.test_call_id,
  criterion_id:criterionId,
  before_dom_hash:await digest(before),after_dom_hash:await digest(after),
  loaded_paths:assetPaths.slice().sort()
 };
 return digest(JSON.stringify(evidence));
}
