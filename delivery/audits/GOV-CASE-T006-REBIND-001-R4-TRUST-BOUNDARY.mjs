// APPf2 GOV-CASE-T006-REBIND-001 / R4 trust boundary rehearsal only.
// EPHEMERAL TEST KEYS: NOT Human signatures and NOT a GitHub Actions attestation.
import { generateKeyPairSync, sign, verify, createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const canonical = x => JSON.stringify(Array.isArray(x) ? x.map(y=>JSON.parse(canonical(y))) : x && typeof x==='object' ? Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(canonical(x[k]))])) : x);
const digest = x => createHash('sha256').update(canonical(x)).digest('hex');
const { publicKey:trustedKey, privateKey:ephemeralTestSigner } = generateKeyPairSync('ed25519');
const { privateKey:foreignSigner } = generateKeyPairSync('ed25519');
const sha = '0123456789abcdef'.repeat(2)+'01234567';
const policy = Object.freeze({repo:'NFF98/appf2-build', workflow:'governance-gate.yml', ref:'refs/heads/main', audience:'APPF2-R4-SECURITY-REVALIDATION', allowed_event:'push', key:trustedKey});
const evidence = Object.freeze({evidence_id:'EV-SP-P1-004-T008-001', task_id:'T008', sprint_id:'SP-P1-004', baseline_id:'BS-P1-025', source_commit:sha, acceptance_ids:['F01-AC-017'], test_ids:['TEST-F01-SEC-007'], locator:'github-actions://NFF98/appf2-build/actions/runs/999#TEST-F01-SEC-007'});
const claims = Object.freeze({repo:policy.repo,workflow:policy.workflow,ref:policy.ref,audience:policy.audience,event:policy.allowed_event,source_commit:sha,run_id:999,run_attempt:1,run_conclusion:'success',issued_at:1000,expires_at:1100, evidence_digest:digest(evidence), nonce:'R4-TEST-NONCE-0001', verified_scopes:['revalidation:proof']});
const signed=(c=claims,key=ephemeralTestSigner)=>({claims:c, signature_base64:sign(null,Buffer.from(canonical(c)),key).toString('base64')});
const equal=(a,b)=>canonical(a)===canonical(b);

const receiptShape=({receipt,trustPolicy})=>Boolean(trustPolicy?.key&&receipt?.claims&&typeof receipt.signature_base64==='string');
const signatureValid=({receipt,trustPolicy})=>{
 if(!/^[a-zA-Z0-9+/]+={0,2}$/.test(receipt.signature_base64)) return false;
 try{return verify(null,Buffer.from(canonical(receipt.claims)),trustPolicy.key,Buffer.from(receipt.signature_base64,'base64'))}
 catch{return false}
};
const provenanceValid=({claims:c,trustPolicy:p})=>
 c.repo===p.repo&&c.workflow===p.workflow&&c.ref===p.ref&&c.audience===p.audience&&c.event===p.allowed_event;
const runValid=({claims:c})=>Number.isSafeInteger(c.run_id)&&c.run_id>0&&
 Number.isSafeInteger(c.run_attempt)&&c.run_attempt>0&&c.run_conclusion==='success';
const scopeValid=({claims:c})=>Array.isArray(c.verified_scopes)&&c.verified_scopes.includes('revalidation:proof');
const timingValid=({claims:c,now})=>Number.isSafeInteger(c.issued_at)&&Number.isSafeInteger(c.expires_at)&&
 c.issued_at<=now&&c.expires_at>=now&&c.expires_at>c.issued_at&&c.expires_at-c.issued_at<=300;
const commitValid=({claims:c,expectedEvidence:e})=>/^[0-9a-f]{40}$/.test(c.source_commit||'')&&c.source_commit===e.source_commit;
const expectedScope=({expectedEvidence:e})=>equal(e.acceptance_ids,['F01-AC-017'])&&
 equal(e.test_ids,['TEST-F01-SEC-007'])&&e.baseline_id==='BS-P1-025'&&e.task_id==='T008'&&e.sprint_id==='SP-P1-004';
const evidenceValid=({claims:c,expectedEvidence:e})=>c.evidence_digest===digest(e)&&expectedScope({expectedEvidence:e});
const predicates=[
 ['INVALID_SIGNATURE',signatureValid],['FORBIDDEN_PROVENANCE',provenanceValid],
 ['RUN_NOT_SUCCESS',runValid],['PERMISSION_DENIED',scopeValid],
 ['TIMING_INVALID',timingValid],['SOURCE_SHA_MISMATCH',commitValid],
 ['EVIDENCE_SCOPE_OR_DIGEST_MISMATCH',evidenceValid]
];
function verifyReceipt({receipt,expectedEvidence,trustPolicy,now,used}){
 if(!receiptShape({receipt,trustPolicy}))return {ok:false,reason:'MISSING_TRUST_ANCHOR_OR_RECEIPT'};
 const ctx={receipt,claims:receipt.claims,expectedEvidence,trustPolicy,now,used};
 for(const [reason,validate] of predicates){
  if(!validate(ctx))return {ok:false,reason};
 }
 const c=receipt.claims;
 const token=[c.repo,c.run_id,c.run_attempt,c.nonce,expectedEvidence.evidence_id].join('/');
 if(used.has(token))return {ok:false,reason:'REPLAY'};
 used.add(token);
 return {ok:true,reason:'CRYPTOGRAPHIC_RECEIPT_MODEL_ACCEPTED_TEST_ONLY'};
}
const results=[];
function check(id,accept,receipt=signed(),opts={}){
 const result=verifyReceipt({receipt,expectedEvidence:opts.ev||evidence,trustPolicy:opts.pol||policy,now:opts.now??1050,used:opts.used||new Set()});
 results.push({id,expected:accept,actual:result.ok,reason:result.reason,matched:result.ok===accept});
 assert.equal(result.ok,accept,id+' :: '+result.reason);
}
const tamper=patch=>signed({...claims,...patch});
check('P01_CORRECT_EPHEMERAL_SIGNED_FIXTURE',true);
check('N01_NO_RECEIPT',false,null);
check('N02_NO_TRUST_ANCHOR',false,signed(),{pol:{...policy,key:null}});
check('N03_WRONG_SIGNER',false,signed(claims,foreignSigner));
check('N04_TAMPERED_AFTER_SIGNATURE',false,{...signed(),claims:{...claims,run_id:1000}});
check('N05_WRONG_REPO',false,tamper({repo:'attacker/fork'}));
check('N06_WRONG_WORKFLOW',false,tamper({workflow:'untrusted.yml'}));
check('N07_WRONG_REF',false,tamper({ref:'refs/heads/untrusted'}));
check('N08_WRONG_AUDIENCE',false,tamper({audience:'OTHER'}));
check('N09_WRONG_EVENT',false,tamper({event:'pull_request_target'}));
check('N10_NO_SCOPE_PERMISSION',false,tamper({verified_scopes:[]}));
check('N11_FAILED_CI',false,tamper({run_conclusion:'failure'}));
check('N12_NO_RUN_ID',false,tamper({run_id:0}));
check('N13_EXPIRED',false,signed(),{now:1101});
check('N14_NOT_YET_ISSUED',false,signed(),{now:999});
check('N15_LONG_LIVED_CLAIM',false,tamper({expires_at:3000}));
check('N16_WRONG_SHA',false,tamper({source_commit:'f'.repeat(40)}));
check('N17_HASH_ONLY_WITHOUT_SIGNATURE',false,{claims:{...claims},signature_base64:''});
check('N18_WRONG_EVIDENCE_DIGEST',false,tamper({evidence_digest:'0'.repeat(64)}));
check('N19_WRONG_TEST_MAPPING',false,signed(),{ev:{...evidence,test_ids:['TEST-F01-API-001']}});
check('N20_FOREIGN_TASK',false,signed(),{ev:{...evidence,task_id:'T007'}});
check('N21_UNVERIFIED_BASELINE',false,signed(),{ev:{...evidence,baseline_id:'BS-P1-024'}});
check('N22_FAKE_PASS_FIELD',false,signed(),{ev:{...evidence,status:'PASS',independently_verified:true}});
{
 const used=new Set();
 check('P02_FIRST_RECEIPT_CONSUMED',true,signed(),{used});
 check('N23_REPLAY_IDENTICAL_RECEIPT',false,signed(),{used});
}
check('N24_NON_BASE64_SIGNATURE',false,{claims,signature_base64:'%%%%'});
const actual={case_id:'GOV-CASE-T006-REBIND-001',stage:'R4',mode:'NODE_LOCAL_EPHEMERAL_KEY_ONLY',node:process.version,tests:results,total:results.length,matched:results.filter(r=>r.matched).length,positive:results.filter(r=>r.expected).length,negative:results.filter(r=>!r.expected).length,all_matched:results.every(r=>r.matched),key_origin:'EPHEMERAL_TEST_ONLY_NOT_HUMAN_OR_GITHUB_ACTIONS',no_production_authority:true};
console.log(JSON.stringify(actual,null,2));
