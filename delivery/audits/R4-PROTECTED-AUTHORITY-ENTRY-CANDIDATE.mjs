// R4 proposed destination: harness/scripts/revalidation-proof-authority.mjs
// L3 PROTECTED SOURCE CANDIDATE ONLY: this file lives under delivery/audits.
// Legitimate Governance gates never accept an injected callback as proof of Human identity.
import {inspectClosedRound} from './R4-CLOSED-ROUND-TRUST-CHECK.mjs';
import {verifyWithTrustedGitHub} from './R4-ATTESTATION-VERIFIER.mjs';

const fail=code=>({ok:false,code});
const allowedScopes=new Set(['BACKLOG','SCOPE','EVIDENCE']);
const baseValid=({round,scope})=>allowedScopes.has(scope)&&round!==null&&typeof round==='object'&&
 ['CLOSED','VERIFIED'].includes(round.status)&&Array.isArray(round.evidence_ids)&&round.evidence_ids.length>0;

/** Pure adapter contract to exercise all three Gate call sites with an isolated test double.
 *  A reviewer must NEVER wire this dependency-injectable function into a live Gate without
 *  first installing independent protected authority and a signed immutable expectation.
 */
export function inspectProposedProtectedAuthority({round,item,evidence,scope,expected,artifactPath,approvalSigner,ledgerSource,ghCli}){
 if(!baseValid({round,scope}))return fail('INVALID_CLOSED_ROUND_SCOPE');
 if(!item||typeof item.backlog_item_id!=='string')return fail('MISSING_BACKLOG_OWNER');
 if(!expected||typeof artifactPath!=='string'||!artifactPath)return fail('MISSING_SIGNED_EXPECTATION');
 if(scope==='EVIDENCE'&&(!evidence||!round.evidence_ids.includes(evidence.evidence_id)))return fail('EVIDENCE_NOT_ROUND_OWNED');
 if(scope!=='EVIDENCE'&&evidence===undefined)return fail('EVIDENCE_LOOKUP_NOT_PROVISIONED');
 if(typeof approvalSigner!=='function'||typeof ledgerSource!=='function')return fail('INDEPENDENT_TRUST_SERVICES_MISSING');
 const signed=({expected:ctx,artifactPath:p})=>verifyWithTrustedGitHub({expected:ctx,artifactPath:p,ledger:[],cli:ghCli});
 return inspectClosedRound({round,evidence,expected,artifactPath,
  verifiedProof:signed,verifyIndependentApproval:approvalSigner,readTrustedLedger:ledgerSource});
}
/** Fixed production entry point used by each protected Gate in the proposed overlay.
 *  This must remain FAIL-CLOSED until Human-authorized trust adapters are deployed:
 *  immutable signed expectation lookup, independent signature key, trusted artifact
 *  fetch, gh runner/attestation verification, and external durable anchored ledger.
 *  No env var, checked-in JSON, GitHub author label, or caller-provided function is authority.
 */
export function verifyClosedRoundForRepo({round,scope}){
 if(!baseValid({round,scope}))return fail('INVALID_CLOSED_ROUND_SCOPE');
 return fail('INDEPENDENT_APPROVAL_AND_DURABLE_LEDGER_NOT_PROVISIONED');
}
if(process.argv[1]?.endsWith('R4-PROTECTED-AUTHORITY-ENTRY-CANDIDATE.mjs')&&process.argv[2]==='authorize'){
 console.error('R4 production authority not provisioned; review-only source');process.exitCode=2;
}
