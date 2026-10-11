// GOV-CASE-T006-REBIND-001: review-only exact closed-round verifier.
// NEVER install in protected harness without independent R4/R5 and merge approval.
// This validation is READ-ONLY: CI gates must not consume a replay token on each read.
import {verifyWithTrustedGitHub} from './R4-ATTESTATION-VERIFIER.mjs';
import {inspectLedger} from './R4-REPLAY-LEDGER.mjs';

const fail=code=>({ok:false,code});
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const goodIds=a=>Array.isArray(a)&&a.length>0&&a.every(x=>typeof x==='string'&&x.length>0)&&new Set(a).size===a.length;
const goodHash=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const roundMatches=(round,e,proof)=>round.target_build_spec_id===e.baseline_id&&
 round.sprint_id===e.sprint_id&&round.task_id===e.task_id&&
 round.source_registry_sha256===e.source_registry_sha256&&
 round.target_registry_sha256===e.target_registry_sha256&&
 equal(round.acceptance_ids,e.acceptance_ids)&&equal(round.test_ids,e.test_ids)&&
 goodIds(e.acceptance_ids)&&goodIds(e.test_ids)&&
 round.evidence_ids?.includes(e.evidence_id)&&proof.baseline_id===e.baseline_id&&
 proof.sprint_id===e.sprint_id&&proof.task_id===e.task_id&&
 proof.evidence_id===e.evidence_id;
const evidenceValid=(ev,e)=>ev?.kind==='TEST_RESULT'&&ev.status==='PASS'&&
 ev.source_commit===e.source_sha&&ev.evidence_id===e.evidence_id&&
 ev.build_spec_id===e.baseline_id&&ev.sprint_id===e.sprint_id&&ev.task_id===e.task_id&&
 equal(ev.acceptance_ids,e.acceptance_ids)&&equal(ev.test_ids,e.test_ids)&&
 goodHash(ev.sha256)&&ev.sha256===e.artifact_sha256;
const expectedKey=e=>[e.repo,e.run_id,e.run_attempt,e.evidence_id,e.task_id,e.baseline_id,...e.acceptance_ids].join('|');
const matchingLedger=(rows,e)=>rows.filter(x=>x.key===expectedKey(e)&&x.event?.artifact_sha256===e.artifact_sha256&&
 x.event?.baseline_id===e.baseline_id&&x.event?.run_attempt===e.run_attempt).length===1;

const validateAuthorityInputs=x=>{
 if(!x.round||!x.evidence||!x.expected||typeof x.artifactPath!=='string')return fail('MISSING_ROUND_TRUST_INPUT');
 if(!['VERIFIED','CLOSED'].includes(x.round.status))return fail('ROUND_NOT_READY');
 if(!goodIds(x.round.acceptance_ids)||!goodIds(x.round.test_ids)||!goodIds(x.round.evidence_ids))return fail('INVALID_ROUND_SET');
 if(typeof x.verifyIndependentApproval!=='function'||x.verifyIndependentApproval(x.expected)!==true)return fail('INDEPENDENT_HUMAN_APPROVAL_MISSING');
 if(typeof x.verifiedProof!=='function')return fail('SIGNED_PROOF_RESOLVER_MISSING');
 return null;
};
const fetchVerifiedArtifact=x=>{
 try{return x.verifiedProof({expected:x.expected,artifactPath:x.artifactPath})}
 catch{return fail('TRUSTED_PROOF_UNAVAILABLE')}
};
const validateProofBinding=(x,proof)=>{
 if(!proof?.ok||!goodHash(proof.artifact_sha256))return fail('SIGNED_PROOF_NOT_VERIFIED');
 if(!roundMatches(x.round,x.expected,x.expected))return fail('ROUND_OWNER_AND_REGISTRY_MISMATCH');
 if(!evidenceValid(x.evidence,{...x.expected,artifact_sha256:proof.artifact_sha256}))return fail('EVIDENCE_NOT_BOUND_TO_SIGNED_ARTIFACT');
 return null;
};
const validateAnchoredLedger=(x,proof)=>{
 if(typeof x.readTrustedLedger!=='function')return fail('NO_EXTERNALLY_ANCHORED_LEDGER');
 let ledger;
 try{ledger=x.readTrustedLedger()}catch{return fail('LEDGER_AUTHORITY_UNAVAILABLE')}
 if(!Array.isArray(ledger?.entries))return fail('LEDGER_SNAPSHOT_INVALID');
 const checked=inspectLedger({entries:ledger.entries,externallyTrustedHead:ledger.externalHead});
 if(!checked.ok)return fail('LEDGER_'+checked.code);
 if(!matchingLedger(ledger.entries,{...x.expected,artifact_sha256:proof.artifact_sha256}))return fail('SIGNED_EVIDENCE_ABSENT_FROM_LEDGER');
 return {ok:true,code:'SIGNED_AND_ANCHORED_READ_ONLY',artifact_sha256:proof.artifact_sha256,ledger_head:checked.head};
};
export function inspectClosedRound(x){
 const guard=validateAuthorityInputs(x);
 if(guard)return guard;
 const signed=fetchVerifiedArtifact(x);
 const binding=validateProofBinding(x,signed);
 if(binding)return binding;
 return validateAnchoredLedger(x,signed);
}

// Untrusted caller-supplied approval/ledger/gh stubs must never authorize production.
// Production integration needs fixed protected call sites and independent adapters.
export function failClosedProductionRound(){return fail('PROTECTED_TRUST_ADAPTER_NOT_DEPLOYED')}
export {verifyWithTrustedGitHub};
if(process.argv[1]?.endsWith('R4-CLOSED-ROUND-TRUST-CHECK.mjs')&&process.argv[2]==='authorize'){
 console.error('R4 review only: no independently deployed trusted Human/CI/CAS adapters');process.exitCode=2;
}
