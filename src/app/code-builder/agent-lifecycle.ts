/**
 * Sprint 3.5: advance an approved coding Job into real independent QA, and
 * if QA fails, make ONE separately journaled repair attempt in the SAME click.
 * No new authorization is inferred: the user must opt in to AI and Browser QA.
 * This never publishes, deploys, retries unknown outcomes, or starts a second
 * Browser QA run without a new click.
 */
import {MAX_TURNS_PER_CLICK,type AgentBrowserOptions,type CandidateSnapshot,
 type CandidateJob} from "./agent-browser-client.js";

export type QaObservation={
 readonly ready_for_review:boolean;
 readonly checks:readonly {criterion_id:string;verdict:string}[];
};
type AgentProgress=CandidateSnapshot["progress"];
export type LifecycleAgent={
 advance(options:AgentBrowserOptions,
  onProgress:(snapshot:CandidateSnapshot)=>void,
  shouldStop:()=>boolean,maxTurns?:number):Promise<CandidateSnapshot>;
 independentQa(consent:boolean):Promise<QaObservation>;
 repairFailedQa(consent:boolean):Promise<unknown>;
 read():Promise<CandidateJob>;
 progress():Promise<AgentProgress>;
};
export type LifecycleOutcome={
 readonly snapshot:CandidateSnapshot;
 readonly qa:QaObservation|null;
 readonly repairStarted:boolean;
};
export async function advanceWithApprovedQaRepair(agent:LifecycleAgent,
 options:AgentBrowserOptions,browserQaConsent:boolean,
 onProgress:(snapshot:CandidateSnapshot)=>void,
 shouldStop:()=>boolean):Promise<LifecycleOutcome>{
 const first=await agent.advance(options,onProgress,shouldStop);
 // This click explicitly grants a fresh Browser QA consent, including when
 // a recovered Job is ALREADY TESTING from a previously paid build/test.
 // The server binds admission to the latest saved test and one-shot QA journal;
 // an interrupted session must not force another build/model turn.
 if(shouldStop()||!options.allowAi||!browserQaConsent||
  first.job.status!=="TESTING")
  return {snapshot:first,qa:null,repairStarted:false};
 const qa=await agent.independentQa(true);
 const inspected=await agent.read();
 const snapshot:CandidateSnapshot={
  job:inspected,progress:await agent.progress(),
  message:qa.ready_for_review?
   "獨立瀏覽器 QA 通過；仍待正式發布驗證。":
   "獨立瀏覽器 QA 未通過，已保存失敗證據。",
  completed_steps:first.completed_steps
 };
 onProgress(snapshot);
 const remaining=MAX_TURNS_PER_CLICK-first.completed_steps;
 // The repair must not turn a six-step click into a second six-step batch.
 // Save the QA failure; a fresh user click may authorize its repair later.
 if(qa.ready_for_review||shouldStop()||remaining<1)
  return {snapshot,qa,repairStarted:false};
 // A failed independent Browser QA must have durably moved this exact
 // project into REPAIRING. A network error never authorizes a new attempt.
 if(inspected.status!=="REPAIRING")
  throw Error("AGENT_QA_REPAIR_STATE_UNPROVEN");
 // The prior checkbox authorizes ONE bounded paid model repair. Each HTTP
 // request still carries fresh owner PoP, journal key and budget admission.
 await agent.repairFailedQa(true);
 const next=await agent.advance(options,onProgress,shouldStop,remaining);
 return {snapshot:{...next,message:
   "已保存一次 AI 修復嘗試及目前工作；再次獨立 QA 必須另行核准。"},
  qa,repairStarted:true};
}
