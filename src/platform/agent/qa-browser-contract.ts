/** Private independent Chromium QA. All credentials and browser cost consent
 * are assigned by the trusted Worker, never by generated App source.
 */
import {parseQaPlan,type QaPlan} from "../qa/requirement-contract.js";
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
/** Browser QA can never silently accept unknown/unsupported requirements. */
export function strictQaChecks(plan:QaPlan,observed:readonly PrivateQaCheck[]):boolean{
 return plan.criteria.length===observed.length&&
  plan.criteria.every((criterion,i)=>criterion.automatable&&
   observed[i]?.criterion_id===criterion.id&&
   observed[i]?.verdict==="PASS"&&
   /^sha256:[0-9a-f]{64}$/u.test(observed[i].evidence_hash??""));
}
