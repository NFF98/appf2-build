// GOV-CASE-T006-REBIND-001 R4 ISOLATED integration candidate (NOT production).
// Injected dependencies MUST be replaced by independent, protected adapters after Human approvals.
import {inspectAuthorizedPreflight} from './R4-AUTHORIZED-PREFLIGHT.mjs';
import {verifyWithTrustedGitHub} from './R4-ATTESTATION-VERIFIER.mjs';
import {inspectLedger,proposeAppend} from './R4-REPLAY-LEDGER.mjs';
const fail=code=>({ok:false,code});
const validLedger=x=>x&&Array.isArray(x.entries)&&typeof x.externalHead==='string';
const eventFrom=(expected,result)=>({repo:expected.repo,run_id:expected.run_id,run_attempt:expected.run_attempt,evidence_id:expected.evidence_id,task_id:expected.task_id,baseline_id:expected.baseline_id,acceptance_ids:expected.acceptance_ids,artifact_sha256:result.artifact_sha256});
export function reviewSecurityRound({expected,snapshot,env,artifactPath,approvalVerifier,ancestryVerifier,ledgerAdapter,ghCli}){
 if(!expected||!snapshot||!env||typeof artifactPath!=='string'||typeof ghCli!=='function')return fail('MISSING_TRUST_MATERIAL');
 const preflight=inspectAuthorizedPreflight({expected,snapshot,env,verifyIndependentApproval:approvalVerifier,verifyGitAncestry:ancestryVerifier});
 if(!preflight.ok)return fail('PREFLIGHT_'+preflight.code);
 if(typeof ledgerAdapter?.getTrustedSnapshot!=='function'||typeof ledgerAdapter.compareAndSet!=='function')return fail('NO_EXTERNAL_LEDGER_AUTHORITY');
 let ledger;try{ledger=ledgerAdapter.getTrustedSnapshot()}catch{return fail('LEDGER_UNAVAILABLE')}
 if(!validLedger(ledger))return fail('LEDGER_UNTRUSTED_INPUT');
 const checked=inspectLedger({entries:ledger.entries,externallyTrustedHead:ledger.externalHead});
 if(!checked.ok)return fail('LEDGER_'+checked.code);
 const attest=verifyWithTrustedGitHub({artifactPath,expected,ledger:ledger.entries.map(x=>x.key),cli:ghCli});
 if(!attest.ok)return fail('ATTEST_'+attest.code);
 const append=proposeAppend({entries:ledger.entries,externallyTrustedHead:ledger.externalHead,event:eventFrom(expected,attest),compareAndSet:ledgerAdapter.compareAndSet});
 if(!append.ok)return fail('REPLAY_'+append.code);
 return {ok:true,code:'SYNTHETIC_DEPENDENCY_INJECTION_ONLY',artifact_sha256:attest.artifact_sha256,proposed_head:append.head};
}
if(process.argv[1]?.endsWith('R4-PROOF-GATE-INTEGRATION-CANDIDATE.mjs')&&process.argv[2]==='verify'){
 console.error('R4: no constitutional authorization, independent signer or externally anchored CAS; FAIL CLOSED');
 process.exitCode=2;
}
