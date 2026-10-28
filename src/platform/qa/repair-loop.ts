import {summarizeQa,type QaPlan,type QaEvidence} from "./requirement-contract.js";
export interface QaDraft{readonly title:string;readonly javascript:string}
export interface QaAttempt{readonly attempt:number;readonly evidence:readonly QaEvidence[];readonly passed:boolean}
export type QaRunner=(draft:QaDraft,plan:QaPlan)=>Promise<readonly QaEvidence[]>;
export type QaRepair=(draft:QaDraft,plan:QaPlan,failed:readonly QaEvidence[],attempt:number)=>Promise<QaDraft|null>;
export type QaPipelineOutcome={
 readonly status:"VERIFIED"|"FAILED"|"NEEDS_HUMAN";readonly draft:QaDraft;
 readonly attempts:readonly QaAttempt[];
};
/**
 * Independent validator owns the plan and evidence. Repairs never edit requirements.
 * The caller MUST obtain explicit cost consent before providing repair.
 */
export async function verifyAndRepair(
 draft:QaDraft,plan:QaPlan,test:QaRunner,
 options:{readonly repair?:QaRepair;readonly maxRepairs?:number}={}
):Promise<QaPipelineOutcome>{
 const limit=Math.min(2,Math.max(0,Math.floor(options.maxRepairs??0)));
 const attempts:QaAttempt[]=[];
 for(let n=0;n<=limit;n++){
  let evidence:readonly QaEvidence[];
  try{evidence=await test(draft,plan);}
  catch{evidence=[];} // environment crashes never yield a success receipt
  const summary=summarizeQa(plan,evidence);
  attempts.push({attempt:n,evidence:summary.results,passed:summary.passed});
  if(summary.passed)return {status:"VERIFIED",draft,attempts};
  const untested=summary.results.some(x=>x.verdict==="UNTESTED");
  if(untested)return {status:"NEEDS_HUMAN",draft,attempts};
  if(n===limit||options.repair===undefined)return {status:"FAILED",draft,attempts};
  let next:QaDraft|null=null;
  try{next=await options.repair(draft,plan,summary.results,n+1);}
  catch{return {status:"FAILED",draft,attempts};}
  if(next===null||next.javascript===draft.javascript)return {status:"FAILED",draft,attempts};
  draft=next;
 }
 return {status:"FAILED",draft,attempts};
}
