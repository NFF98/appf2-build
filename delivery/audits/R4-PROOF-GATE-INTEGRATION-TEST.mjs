// Local-only model tests. Does NOT sign as Human, install GitHub Workflow, or start T006.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {reviewSecurityRound} from './R4-PROOF-GATE-INTEGRATION-CANDIDATE.mjs';
import {prepareProof} from './R4-TEST-REPORT-EMITTER.mjs';
import {proposeAppend} from './R4-REPLAY-LEDGER.mjs';
const H='a'.repeat(40),D='b'.repeat(64),BASE='BS-P1-025';
const expected={case_id:'GOV-CASE-T006-REBIND-001',repo:'NFF98/appf2-build',ref:'refs/heads/main',workflow:'.github/workflows/revalidation-proof.yml',source_sha:H,run_id:42,run_attempt:1,sprint_id:'SP-P1-004',task_id:'T008',baseline_id:BASE,target_baseline:BASE,evidence_id:'EV-SP-P1-004-T008-001',source_registry_sha256:D,target_registry_sha256:D,acceptance_ids:['F01-AC-017'],test_ids:['TEST-F01-SEC-007']};
const env={GITHUB_REPOSITORY:expected.repo,GITHUB_REF:expected.ref,GITHUB_EVENT_NAME:'push',GITHUB_SHA:H,GITHUB_RUN_ID:'42',GITHUB_RUN_ATTEMPT:'1'};
const snapshot={build:{active_baseline:BASE,implementation_enabled:true},sprint:{status:'ACTIVE',active_sprint:expected.sprint_id,active_task:expected.task_id,active_build_spec:BASE},manifest:{baseline_id:BASE,status:'LOCKED',approval:{status:'USER_APPROVED',decision_ref:'SYNTHETIC ONLY'},source_working_commit:H,acceptance_registry:'registries/acceptance-test-registry.json',file_inventory:[{path:'registries/acceptance-test-registry.json',sha256:D}]},activation:{baseline_id:BASE,status:'USER_APPROVED',type:'REBASELINE',previous_baseline:'BS-P1-024',source_working_commit:H,decision_ref:'SYNTHETIC ONLY'},tasks:{sprint_id:expected.sprint_id,tasks:[{task_id:expected.task_id,status:'IN_PROGRESS',build_spec_id:BASE,allowed_write_paths:['tests/'],acceptance_links:[{acceptance_id:expected.acceptance_ids[0],test_id:expected.test_ids[0]}]}]},sprintManifest:{sprint_id:expected.sprint_id,status:'ACTIVE',build_spec_id:BASE},source_registry_sha256:D,actual_registry_sha256:D};
const vitest={success:true,numTotalTests:1,numFailedTests:0,numPendingTests:0,testResults:[{assertionResults:[{fullName:'TEST-F01-SEC-007 MOCK ONLY',status:'passed'}]}]};
const proof=prepareProof({expected,env,vitest}).report;
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'r4-bridge-'));const artifactPath=path.join(temp,'proof.json');fs.writeFileSync(artifactPath,JSON.stringify(proof));
const verified=[{attestation:{test:true},verificationResult:{test:true}}];
const run={id:42,run_attempt:1,status:'completed',conclusion:'success',event:'push',head_sha:H,head_branch:'main',path:expected.workflow,repository:{full_name:expected.repo}};
const jobs={total_count:1,jobs:[{name:'revalidation-proof',conclusion:'success',run_attempt:1,steps:['Verify exact Human-authorized Revalidation Task','Governance Gate','Execute exact mapped tests','Generate test proof manifest','Attest proof artifact'].map(name=>({name,conclusion:'success'}))}]};
const ghCli=(bin,args)=>{assert.equal(bin,'gh');if(args[0]==='attestation')return JSON.stringify(verified);if(args[0]==='api')return JSON.stringify(args[3].includes('/jobs?')?jobs:run);throw Error('untrusted tool')};
const makeLedger=()=>({getTrustedSnapshot:()=>({entries:[],externalHead:'GENESIS'}),compareAndSet:()=>true});
const tests=[];
function check(name,pass,mutate){const args={expected:JSON.parse(JSON.stringify(expected)),snapshot:JSON.parse(JSON.stringify(snapshot)),env:JSON.parse(JSON.stringify(env)),artifactPath,approvalVerifier:()=>true,ancestryVerifier:()=>true,ledgerAdapter:makeLedger(),ghCli};mutate?.(args);const r=reviewSecurityRound(args);assert.equal(r.ok,pass,name+' '+r.code);tests.push({name,ok:r.ok,code:r.code})}
try{
 check('P01_FULL_CHAIN_INJECTED_TEST_DOUBLE',true);
 check('N01_UNAUTHORIZED_CURRENT_MAIN',false,c=>{c.snapshot.build.active_baseline='BS-P1-024';c.snapshot.build.implementation_enabled=false});
 check('N02_MISSING_HUMAN_SIGNATURE',false,c=>{c.approvalVerifier=()=>false});
 check('N03_MISSING_HUMAN_ADAPTER',false,c=>{c.approvalVerifier=null});
 check('N04_GIT_ANCESTRY_DENIED',false,c=>{c.ancestryVerifier=()=>false});
 check('N05_PR_EVENT_REJECTED',false,c=>{c.env.GITHUB_EVENT_NAME='pull_request'});
 check('N06_WRONG_TASK_BINDING',false,c=>{c.snapshot.tasks.tasks[0].task_id='T999'});
 check('N07_UNTRUSTED_REGISTRY',false,c=>{c.snapshot.actual_registry_sha256='c'.repeat(64)});
 check('N08_NO_LEDGER_AUTHORITY',false,c=>{c.ledgerAdapter=null});
 check('N09_NO_LEDGER_ANCHOR',false,c=>{c.ledgerAdapter.getTrustedSnapshot=()=>({entries:[],externalHead:'a'.repeat(64)})});
 check('N10_LEDGER_API_DOWN',false,c=>{c.ledgerAdapter.getTrustedSnapshot=()=>{throw Error('API down')}});
 check('N11_CAS_CONFLICT',false,c=>{c.ledgerAdapter.compareAndSet=()=>false});
 check('N12_MISSING_ATTESTATION',false,c=>{c.ghCli=()=>JSON.stringify([])});
 check('N13_CLI_UNAVAILABLE',false,c=>{c.ghCli=()=>{throw Error('unavailable')}});
 check('N14_MISSING_SIGNED_PROOF',false,c=>{c.artifactPath=path.join(temp,'nonexistent.json')});
 check('N15_BOOTSTRAP_MUST_NOT_COUNT_AS_PRODUCT',false,c=>{const smoke=path.join(temp,'smoke.json');fs.writeFileSync(smoke,JSON.stringify({...proof,product_ci_mode:'NOT_EXECUTED'}));c.artifactPath=smoke});
 check('N16_REPLAY_WITH_TRUSTED_LEDGER',false,c=>{const ev={repo:expected.repo,run_id:42,run_attempt:1,evidence_id:expected.evidence_id,task_id:expected.task_id,baseline_id:BASE,acceptance_ids:expected.acceptance_ids,artifact_sha256:'c'.repeat(64)};const row=proposeAppend({entries:[],externallyTrustedHead:'GENESIS',event:ev,compareAndSet:()=>true});assert.equal(row.ok,true);c.ledgerAdapter.getTrustedSnapshot=()=>({entries:[row.entry],externalHead:row.head})});
 check('N17_BAD_ARTIFACT_JSON',false,c=>{const bad=path.join(temp,'bad.json');fs.writeFileSync(bad,'{"bad":true}');c.artifactPath=bad});
 const out={case_id:'GOV-CASE-T006-REBIND-001',scope:'LOCAL_SYNTHETIC_EXTERNAL_VERIFICATION_AND_LEDGER_TEST_DOUBLES',node:process.version,total:tests.length,matched:tests.length,positive:1,negative:17,tests,real_human_signature:false,real_github_attestation:false,production_execution:false};console.log(JSON.stringify(out,null,2));
}finally{fs.rmSync(temp,{recursive:true,force:true})}
