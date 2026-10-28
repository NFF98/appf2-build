/**
 * Candidate QA evidence alone NEVER grants publishing authority.
 * F02 v2 must check independent attestation and deployed artifact integrity.
 */
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
const SHA=/^sha256:[0-9a-f]{64}$/u;
export function summarizeCandidateQa(receipt:CandidateQaReceipt,
 required:readonly string[]):QaSummary{
 const failures:string[]=[];
 if(!SHA.test(receipt.source_project_hash)||!SHA.test(receipt.built_artifact_hash)||
   receipt.version!=="APPF2_CANDIDATE_QA_V1"||
   !/^[A-Za-z0-9_-]{8,100}$/u.test(receipt.sandbox_execution_id)||
   !receipt.runner_attestation)failures.push("UNATTESTED_CANDIDATE");
 const known=new Set<string>();
 for(const check of receipt.checks){
  if(known.has(check.criterion_id))failures.push("DUPLICATE:"+check.criterion_id);
  known.add(check.criterion_id);
  if(!SHA.test(check.evidence_hash??"")||check.verdict!=="PASS")
   failures.push("NOT_PROVEN:"+check.criterion_id);
 }
 for(const id of required)if(!known.has(id))failures.push("MISSING:"+id);
 if(required.length===0)failures.push("NO_REQUIREMENTS");
 return {ready_for_review:failures.length===0,failures};
}
/** Never promote prototype receipts. Future F02 server must independently verify
 * signed runner provenance, complete requirements, artifacts, owner and consent. */
export function admitsPublicationFromCandidateReceipt(_receipt:CandidateQaReceipt):false{
 return false;
}
