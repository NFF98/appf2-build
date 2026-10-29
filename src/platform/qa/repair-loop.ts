import {summarizeQa,type QaPlan,type QaEvidence} from "./requirement-contract.js";
export interface QaDraft{readonly title:string;readonly javascript:string}
export interface QaAttempt{
 readonly attempt:number;readonly evidence:readonly QaEvidence[];
 readonly passed:boolean;readonly failed_criteria:readonly string[];
}
export type QaRunner=(draft:QaDraft,plan:QaPlan)=>Promise<readonly QaEvidence[]>;
export type QaRepair=(draft:QaDraft,plan:QaPlan,failed:readonly QaEvidence[],
 attempt:number,reason?:"REPAIR"|"RETHINK")=>Promise<QaDraft|null>;
export type QaPipelineOutcome={
 readonly status:"VERIFIED"|"FAILED"|"NEEDS_HUMAN"|"NEEDS_REPLAN"|"PAUSED_BUDGET";
 readonly draft:QaDraft;readonly attempts:readonly QaAttempt[];
 readonly next_action:"NONE"|"HUMAN_REVIEW"|"REINTERPRET_OR_CHANGE_APPROACH"|"REQUEST_BUDGET";
};
/**
 * The original user-owned acceptance plan never changes. The verifier, not
 * the authoring model, decides whether there is observable progress.
 * No model call happens unless the caller supplies a consented repair function.
 */
// eslint-disable-next-line complexity -- Progress, consent, crash and QA gates stay explicit.
export async function verifyAndRepair(
 draft:QaDraft,plan:QaPlan,test:QaRunner,
 options:{readonly repair?:QaRepair;readonly maxRepairs?:number;
  readonly budgetAllowsRepair?:(nextAttempt:number)=>boolean}={}
):Promise<QaPipelineOutcome>{
 const limit=Math.min(3,Math.max(0,Math.floor(options.maxRepairs??0)));
 const attempts:QaAttempt[]=[];
 let stalled=0,previousFailures=Number.POSITIVE_INFINITY;
 for(let n=0;n<=limit;n++){
  let evidence:readonly QaEvidence[];
  try{evidence=await test(draft,plan);}
  catch{evidence=[];} // Crash/timeout is never QA success.
  const summary=summarizeQa(plan,evidence);
  const failed=summary.results.filter(x=>x.verdict==="FAIL").map(x=>x.id);
  attempts.push({attempt:n,evidence:summary.results,passed:summary.passed,
   failed_criteria:failed});
  if(summary.passed)return {status:"VERIFIED",draft,attempts,next_action:"NONE"};
  if(summary.results.some(x=>x.verdict==="UNTESTED"))
   return {status:"NEEDS_HUMAN",draft,attempts,next_action:"HUMAN_REVIEW"};
  const failures=failed.length;
  stalled=failures<previousFailures?0:stalled+1;
  previousFailures=failures;
  if(stalled>=3)
   return {status:"NEEDS_REPLAN",draft,attempts,
    next_action:"REINTERPRET_OR_CHANGE_APPROACH"};
  if(n===limit||options.repair===undefined)
   return {status:"PAUSED_BUDGET",draft,attempts,next_action:"REQUEST_BUDGET"};
  if(options.budgetAllowsRepair?.(n+1)===false)
   return {status:"PAUSED_BUDGET",draft,attempts,next_action:"REQUEST_BUDGET"};
  let next:QaDraft|null=null;
  try{
   next=await options.repair(draft,plan,summary.results,n+1,
    stalled>=2?"RETHINK":"REPAIR");
  }catch{return {status:"FAILED",draft,attempts,
   next_action:"REINTERPRET_OR_CHANGE_APPROACH"};}
  if(next===null||next.javascript===draft.javascript)
   return {status:"NEEDS_REPLAN",draft,attempts,
    next_action:"REINTERPRET_OR_CHANGE_APPROACH"};
  draft=next;
 }
 return {status:"FAILED",draft,attempts,next_action:"REINTERPRET_OR_CHANGE_APPROACH"};
}
