// Isolated R4 adversarial contract tests, not GitHub-issued attestations or Human approvals.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {inspectProof,verifyWithTrustedGitHub} from './R4-ATTESTATION-VERIFIER.mjs';

const H='a'.repeat(40),D='b'.repeat(64);
const expected={repo:'NFF98/appf2-build',ref:'refs/heads/main',workflow:'.github/workflows/revalidation-proof.yml',source_sha:H,run_id:42,run_attempt:1,sprint_id:'SP-P1-004',task_id:'T008',baseline_id:'BS-P1-025',evidence_id:'EV-SP-P1-004-T008-001',source_registry_sha256:D,target_registry_sha256:D,acceptance_ids:['F01-AC-017'],test_ids:['TEST-F01-SEC-007']};
const proof={...expected,product_ci_mode:'EXECUTED',gate_status:'PASS',results:[{acceptance_id:'F01-AC-017',test_id:'TEST-F01-SEC-007',status:'PASS',executed:true,assertion_count:1,skipped:0}]};
const run={id:42,run_attempt:1,status:'completed',conclusion:'success',event:'push',head_sha:H,head_branch:'main',path:expected.workflow,repository:{full_name:expected.repo}};
const job={name:'revalidation-proof',conclusion:'success',run_attempt:1,steps:['Execute exact mapped tests','Generate test proof manifest','Attest proof artifact'].map(name=>({name,conclusion:'success'}))};
const jobs={total_count:1,jobs:[job]};
const verified=[{attestation:{bundle:'TEST_DOUBLE_ONLY'},verificationResult:{signature:{certificate:'TEST_DOUBLE_ONLY'}}}];
const clone=x=>JSON.parse(JSON.stringify(x));
const tests=[];
const check=(name,shouldPass,mutate)=>{
 const sample={expected:clone(expected),proof:clone(proof),run:clone(run),jobs:clone(jobs),verified:clone(verified),ledger:[]};
 if(mutate)mutate(sample);
 const result=inspectProof(sample);
 assert.equal(result.ok,shouldPass,name+' '+result.code);
 tests.push({name,expected:shouldPass,actual:result.ok,code:result.code});
};
check('P01_STRUCTURAL_TEST_DOUBLE',true);
check('N01_NO_EXPECTATION',false,x=>{x.expected=null});
check('N02_FORK_EXPECTATION',false,x=>{x.expected.repo='evil/repo'});
check('N03_PR_REF_EXPECTATION',false,x=>{x.expected.ref='refs/pull/42/merge'});
check('N04_WRONG_SIGNER_EXPECTATION',false,x=>{x.expected.workflow='.github/workflows/ci.yml'});
check('N05_WRONG_COMMIT_EXPECTATION',false,x=>{x.expected.source_sha='wrong'});
check('N06_EMPTY_TEST',false,x=>{x.proof.results=[]});
check('N07_WRONG_TEST',false,x=>{x.proof.results[0].test_id='TEST-WRONG'});
check('N08_SKIPPED',false,x=>{x.proof.results[0].skipped=1});
check('N09_NOT_EXECUTED',false,x=>{x.proof.results[0].executed=false});
check('N10_FAKE_PASS_NO_ASSERTIONS',false,x=>{x.proof.results[0].assertion_count=0});
check('N11_FALSE_PASS',false,x=>{x.proof.results[0].status='FAIL'});
check('N12_CHANGED_TASK',false,x=>{x.proof.task_id='T007'});
check('N13_CHANGED_BASELINE',false,x=>{x.proof.baseline_id='BS-P1-024'});
check('N14_CHANGED_RUN_ATTEMPT',false,x=>{x.proof.run_attempt=2});
check('N15_REGISTRY_TAMPER',false,x=>{x.proof.target_registry_sha256='c'.repeat(64)});
check('N16_PRODUCT_HOLD',false,x=>{x.proof.product_ci_mode='HOLD'});
check('N17_GATE_NOT_PASS',false,x=>{x.proof.gate_status='N/A'});
check('N18_PR_RUN',false,x=>{x.run.event='pull_request'});
check('N19_PR_HEAD',false,x=>{x.run.head_branch='feature'});
check('N20_WRONG_SOURCE',false,x=>{x.run.head_sha='c'.repeat(40)});
check('N21_WRONG_RUN_PATH',false,x=>{x.run.path='.github/workflows/ci.yml'});
check('N22_GITHUB_JOB_FAILED',false,x=>{x.jobs.jobs[0].conclusion='failure'});
check('N23_REQUIRED_STEP_MISSING',false,x=>{x.jobs.jobs[0].steps.pop()});
check('N24_INCOMPLETE_PAGINATION',false,x=>{x.jobs.total_count=2});
check('N25_BOGUS_ATTESTATION',false,x=>{x.verified=[]});
check('N26_REPLAY',false,x=>{const r=inspectProof(x);x.ledger=[r.replay_key]});
check('N27_MISSING_RUN',false,x=>{x.run=null});
check('N28_DUPLICATE_EXPECTED_TEST',false,x=>{x.expected.test_ids.push('TEST-F01-SEC-007')});
check('N29_DUPLICATE_SIGNING_JOB',false,x=>{x.jobs.jobs.push(clone(x.jobs.jobs[0]));x.jobs.total_count=2});
check('N32_RUN_ATTEMPT_MISMATCH',false,x=>{x.run.run_attempt=2});
check('N33_JOB_ATTEMPT_MISMATCH',false,x=>{x.jobs.jobs[0].run_attempt=2});
check('N34_UNSIGNED_RESULT',false,x=>{x.verified=[{verificationResult:{}}]});
check('N35_MISSING_LEDGER',false,x=>{x.ledger=null});
check('N36_WRONG_EVIDENCE_ID',false,x=>{x.proof.evidence_id='forged'});
check('N37_RUN_IS_NOT_COMPLETE',false,x=>{x.run.status='in_progress'});
check('N38_DUPLICATE_REQUIRED_STEP',false,x=>{x.jobs.jobs[0].steps.push(clone(x.jobs.jobs[0].steps[0]))});

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'r4-attest-rehearsal-'));
const artifact=path.join(tmp,'proof.json');fs.writeFileSync(artifact,JSON.stringify(proof));
const fakeGh=(bin,args)=>{
 assert.equal(bin,'gh');
 if(args[0]==='attestation'){
  assert.deepEqual(args,['attestation','verify',artifact,'--repo',expected.repo,
   '--signer-workflow',expected.repo+'/'+expected.workflow,'--source-digest',expected.source_sha,
   '--source-ref',expected.ref,'--deny-self-hosted-runners','--format','json']);
  return JSON.stringify(verified);
 }
 if(args[0]==='api'){
  const prefix=['api','--method','GET'];
  const endpoint=args[3];
  assert.deepEqual(args.slice(0,3),prefix);
  const runPath='repos/'+expected.repo+'/actions/runs/'+expected.run_id;
  const jobsPath=runPath+'/attempts/'+expected.run_attempt+'/jobs?per_page=100';
  assert.ok(endpoint===runPath||endpoint===jobsPath);
  return JSON.stringify(endpoint===jobsPath?jobs:run);
 }
 throw Error('bad command');
};
try{
 const mock=verifyWithTrustedGitHub({artifactPath:artifact,expected,ledger:[],cli:fakeGh});
 // An injected test CLI can provide test-only structural PASS. Never production authorization.
 assert.equal(mock.ok,true,'P02 local injected test CLI');
 tests.push({name:'P02_INJECTED_CLI_TEST_DOUBLE',expected:true,actual:true,code:mock.code});
 const missing=verifyWithTrustedGitHub({artifactPath:path.join(tmp,'absent.json'),expected,ledger:[],cli:fakeGh});
 assert.equal(missing.ok,false);
 tests.push({name:'N30_NO_ARTIFACT',expected:false,actual:false,code:missing.code});
 const noGh=verifyWithTrustedGitHub({artifactPath:artifact,expected,ledger:[],cli:()=>{throw Error('no gh available')}});
 assert.equal(noGh.ok,false);
 tests.push({name:'N31_GH_UNAVAILABLE_FAIL_CLOSED',expected:false,actual:false,code:noGh.code});
 const unsafe=verifyWithTrustedGitHub({artifactPath:artifact,expected,ledger:null,cli:fakeGh});
 assert.equal(unsafe.ok,false);
 tests.push({name:'N39_UNTRUSTED_LEDGER',expected:false,actual:false,code:unsafe.code});
 const fakeResponse=verifyWithTrustedGitHub({artifactPath:artifact,expected,ledger:[],cli:()=>JSON.stringify({})});
 assert.equal(fakeResponse.ok,false);
 tests.push({name:'N40_EMPTY_CLI_RETURN',expected:false,actual:false,code:fakeResponse.code});
}finally{fs.rmSync(tmp,{recursive:true,force:true})}
const summary={case_id:'GOV-CASE-T006-REBIND-001',mode:'LOCAL_DOUBLE_ONLY',node:process.version,total:tests.length,positive:tests.filter(t=>t.expected).length,negative:tests.filter(t=>!t.expected).length,matched:tests.length,tests};
console.log(JSON.stringify(summary,null,2));
