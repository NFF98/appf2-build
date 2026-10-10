// GOV-CASE-T006-REBIND-001 R4; ISOLATED candidate verifier only.
// DO NOT claim production authorization: the signer workflow and trust ledger do not exist yet.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const REPO='NFF98/appf2-build';
const REF='refs/heads/main';
const WORKFLOW='.github/workflows/revalidation-proof.yml';
const SIGNER=REPO+'/'+WORKFLOW;
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(x,y)=>JSON.stringify(x)===JSON.stringify(y);
const fail=code=>({ok:false,code});
const cleanIds=a=>Array.isArray(a)&&a.length>0&&a.every(x=>typeof x==='string'&&x.length>0)&&new Set(a).size===a.length;
const validSHA=s=>typeof s==='string'&&/^[0-9a-f]{40}$/.test(s)&&!/^0+$/.test(s);
const validHex=s=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);

const checkExpected=e=>e.repo===REPO&&e.ref===REF&&e.workflow===WORKFLOW&&validSHA(e.source_sha)&&
 cleanIds(e.acceptance_ids)&&cleanIds(e.test_ids)&&e.test_ids.length===e.acceptance_ids.length&&
 Number.isSafeInteger(e.run_id)&&e.run_id>0&&Number.isSafeInteger(e.run_attempt)&&e.run_attempt>0;
const checkResults=(e,p)=>Array.isArray(p.results)&&p.results.length>0&&
 same(p.results.map(x=>x.acceptance_id),e.acceptance_ids)&&
 same(p.results.map(x=>x.test_id),e.test_ids)&&
 p.results.every(x=>x.status==='PASS'&&x.executed===true&&Number.isSafeInteger(x.assertion_count)&&x.assertion_count>0&&x.skipped===0);
const checkProofIdentity=(e,p)=>{
 const keys=['repo','ref','workflow','source_sha','run_id','run_attempt','sprint_id','task_id','baseline_id','evidence_id'];
 return keys.every(k=>p[k]===e[k]);
};
const checkRegistry=(e,p)=>validHex(p.source_registry_sha256)&&validHex(p.target_registry_sha256)&&
 p.source_registry_sha256===e.source_registry_sha256&&p.target_registry_sha256===e.target_registry_sha256;
const checkRun=(e,r)=>r.repository?.full_name===REPO&&r.path===WORKFLOW&&r.event==='push'&&
 r.head_branch==='main'&&r.head_sha===e.source_sha&&r.run_attempt===e.run_attempt&&
 r.id===e.run_id&&r.status==='completed'&&r.conclusion==='success';
const requiredSteps=['Execute exact mapped tests','Generate test proof manifest','Attest proof artifact'];
const checkSteps=j=>requiredSteps.every(name=>{
 const matching=(j.steps||[]).filter(s=>s.name===name);
 return matching.length===1&&matching[0].conclusion==='success';
});
const checkJobs=(e,inventory)=>{
 if(!Array.isArray(inventory.jobs)||!inventory.jobs.length||inventory.jobs.length!==inventory.total_count)return false;
 const selected=inventory.jobs.filter(x=>x.name==='revalidation-proof');
 return selected.length===1&&selected[0].conclusion==='success'&&
 selected[0].run_attempt===e.run_attempt&&checkSteps(selected[0]);
};
const checkVerified=v=>v.length===1&&Boolean(v[0]?.verificationResult&&v[0]?.attestation);
const checks=[
 ['UNTRUSTED_EXPECTATION',({expected})=>checkExpected(expected)],
 ['MISSING_OR_FAILED_TEST_RESULTS',({expected,proof})=>checkResults(expected,proof)],
 ['PROOF_IDENTITY_MISMATCH',({expected,proof})=>checkProofIdentity(expected,proof)],
 ['REGISTRY_HASH_MISMATCH',({expected,proof})=>checkRegistry(expected,proof)],
 ['PRODUCT_NOT_PROVEN',({proof})=>proof.product_ci_mode==='EXECUTED'&&proof.gate_status==='PASS'],
 ['UNTRUSTED_GITHUB_RUN',({expected,run})=>checkRun(expected,run)],
 ['UNTRUSTED_JOB',({expected,jobs})=>checkJobs(expected,jobs)],
 ['NO_VERIFIED_ATTESTATION',({verified})=>checkVerified(verified)]
];
export function inspectProof({expected,proof,verified,run,jobs,ledger}){
 if(!expected||!proof||!run||!jobs||!Array.isArray(verified)||!Array.isArray(ledger))return fail('MISSING_TRUST_INPUT');
 const context={expected,proof,verified,run,jobs};
 for(const [code,predicate] of checks){if(!predicate(context))return fail(code)}
 const replay=[REPO,expected.run_id,expected.run_attempt,expected.evidence_id,expected.task_id,expected.baseline_id,...expected.acceptance_ids].join('|');
 if(ledger.includes(replay))return fail('REPLAY');
 return {ok:true,code:'STRUCTURALLY_VALID_TRUST_INPUTS_ONLY',replay_key:replay};
}

// Only a successful gh attestation verify process counts as cryptographic verification.
// Never accept a checked-in JSON file claiming to be gh's stdout.
export function verifyWithTrustedGitHub({artifactPath,expected,ledger,cli=execFileSync}){
 if(!expected||expected.repo!==REPO||expected.ref!==REF||expected.workflow!==WORKFLOW||!validSHA(expected.source_sha))return fail('UNTRUSTED_EXPECTATION');
 let data,verified,run,jobs;
 try{
  data=fs.readFileSync(artifactPath);
  if(data.length<16||data.length>1048576)return fail('INVALID_ARTIFACT_SIZE');
  const digest=sha256(data);
  if(!validHex(digest))return fail('INVALID_ARTIFACT_DIGEST');
  const args=['attestation','verify',artifactPath,'--repo',REPO,'--signer-workflow',SIGNER,
   '--source-digest',expected.source_sha,'--source-ref',REF,'--deny-self-hosted-runners','--format','json'];
  verified=JSON.parse(cli('gh',args,{encoding:'utf8',maxBuffer:1048576}));
  run=JSON.parse(cli('gh',['api','--method','GET',`repos/${REPO}/actions/runs/${expected.run_id}`],{encoding:'utf8',maxBuffer:1048576}));
  jobs=JSON.parse(cli('gh',['api','--method','GET',`repos/${REPO}/actions/runs/${expected.run_id}/attempts/${expected.run_attempt}/jobs?per_page=100`],{encoding:'utf8',maxBuffer:1048576}));
  const proof=JSON.parse(data.toString('utf8'));
  const inspected=inspectProof({expected,proof,verified,run,jobs,ledger});
  if(!inspected.ok)return inspected;
  return {...inspected,artifact_sha256:digest};
 }catch{return fail('VERIFICATION_OR_GITHUB_API_FAILED_CLOSED')}
}

if(process.argv[1]&&process.argv[1].endsWith('R4-ATTESTATION-VERIFIER.mjs')&&process.argv[2]==='verify'){
 // Fail closed until constitutionally authorized expectation AND replay ledger adapters exist.
 console.error('R4 ISOLATED: no production expectation / ledger trust adapter. Refusing to certify.');
 process.exitCode=2;
}
