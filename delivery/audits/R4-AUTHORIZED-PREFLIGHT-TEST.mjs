import assert from 'node:assert/strict';
import {inspectAuthorizedPreflight} from './R4-AUTHORIZED-PREFLIGHT.mjs';
const H='a'.repeat(40),D='b'.repeat(64);
const expected={case_id:'GOV-CASE-T006-REBIND-001',repo:'NFF98/appf2-build',ref:'refs/heads/main',workflow:'.github/workflows/revalidation-proof.yml',source_sha:H,run_id:42,run_attempt:1,sprint_id:'SP-P1-004',task_id:'T008',evidence_id:'EV-SP-P1-004-T008-001',target_baseline:'BS-P1-025',source_registry_sha256:D,target_registry_sha256:D,acceptance_ids:['F01-AC-017'],test_ids:['TEST-F01-SEC-007']};
const env={GITHUB_REPOSITORY:expected.repo,GITHUB_EVENT_NAME:'push',GITHUB_REF:expected.ref,GITHUB_SHA:H,GITHUB_RUN_ID:'42',GITHUB_RUN_ATTEMPT:'1'};
const snapshot={
 build:{active_baseline:'BS-P1-025',implementation_enabled:true},
 sprint:{status:'ACTIVE',active_sprint:'SP-P1-004',active_task:'T008',active_build_spec:'BS-P1-025'},
 manifest:{baseline_id:'BS-P1-025',status:'LOCKED',approval:{status:'USER_APPROVED',decision_ref:'TEST-ONLY'},source_working_commit:H,acceptance_registry:'registries/acceptance-test-registry.json',file_inventory:[{path:'registries/acceptance-test-registry.json',sha256:D}]},
 activation:{baseline_id:'BS-P1-025',status:'USER_APPROVED',type:'REBASELINE',previous_baseline:'BS-P1-024',source_working_commit:H,decision_ref:'TEST-ONLY'},
 tasks:{sprint_id:'SP-P1-004',tasks:[{task_id:'T008',status:'IN_PROGRESS',build_spec_id:'BS-P1-025',allowed_write_paths:['tests/'],acceptance_links:[{acceptance_id:'F01-AC-017',test_id:'TEST-F01-SEC-007'}]}]},
 sprintManifest:{sprint_id:'SP-P1-004',status:'ACTIVE',build_spec_id:'BS-P1-025'},
 source_registry_sha256:D,actual_registry_sha256:D
};
const clone=x=>JSON.parse(JSON.stringify(x));
const tests=[];
function check(name,shouldPass,mutate){
 const ctx={expected:clone(expected),snapshot:clone(snapshot),env:clone(env),verifyIndependentApproval:()=>true,verifyGitAncestry:()=>true};
 mutate?.(ctx);const actual=inspectAuthorizedPreflight(ctx);
 assert.equal(actual.ok,shouldPass,`${name} unexpectedly ${actual.code}`);
 tests.push({name,expected:shouldPass,actual:actual.ok,code:actual.code});
}
check('P01_SYNTHETIC_AUTHORIZED_FUTURE',true);
check('N01_EXPECTATION_MISSING',false,x=>{x.expected=null});
check('N02_SNAPSHOT_MISSING',false,x=>{x.snapshot=null});
check('N03_WRONG_REPO',false,x=>{x.expected.repo='fake/repo'});
check('N04_UNTRUSTED_EVENT',false,x=>{x.env.GITHUB_EVENT_NAME='pull_request'});
check('N05_WRONG_BRANCH',false,x=>{x.env.GITHUB_REF='refs/heads/feature'});
check('N06_WRONG_WORKFLOW',false,x=>{x.expected.workflow='.github/workflows/ci.yml'});
check('N07_WRONG_SHA',false,x=>{x.env.GITHUB_SHA='c'.repeat(40)});
check('N08_WRONG_RUN_ID',false,x=>{x.env.GITHUB_RUN_ID='999'});
check('N09_WRONG_ATTEMPT',false,x=>{x.env.GITHUB_RUN_ATTEMPT='2'});
check('N10_TARGET_NOT_ACTIVE',false,x=>{x.snapshot.build.active_baseline='BS-P1-024'});
check('N11_IMPLEMENTATION_HOLD',false,x=>{x.snapshot.build.implementation_enabled=false});
check('N12_NO_ACTIVATION',false,x=>{x.snapshot.activation=null});
check('N13_UNAPPROVED_ACTIVATION',false,x=>{x.snapshot.activation.status='PLANNED'});
check('N14_BAD_ACTIVATION_SOURCE',false,x=>{x.snapshot.activation.source_working_commit='c'.repeat(40)});
check('N15_BAD_BASELINE_APPROVAL',false,x=>{x.snapshot.manifest.approval.status='PENDING'});
check('N16_BAD_BASELINE_STATUS',false,x=>{x.snapshot.manifest.status='DRAFT'});
check('N17_SPRINT_HOLD',false,x=>{x.snapshot.sprint.status='HOLD'});
check('N18_SPRINT_NOT_ACTIVE',false,x=>{x.snapshot.sprint.active_task=null});
check('N19_SPRINT_BASELINE_WRONG',false,x=>{x.snapshot.sprint.active_build_spec='BS-P1-024'});
check('N20_SPRINT_MANIFEST_WRONG',false,x=>{x.snapshot.sprintManifest.status='BLOCKED'});
check('N21_MISSING_TASK',false,x=>{x.snapshot.tasks.tasks=[]});
check('N22_TASK_CLOSED',false,x=>{x.snapshot.tasks.tasks[0].status='CLOSED'});
check('N23_TASK_BASELINE_WRONG',false,x=>{x.snapshot.tasks.tasks[0].build_spec_id='BS-P1-024'});
check('N24_WRONG_TEST_MAPPING',false,x=>{x.snapshot.tasks.tasks[0].acceptance_links[0].test_id='TEST-WRONG'});
check('N25_BAD_HASH_IN_MANIFEST',false,x=>{x.snapshot.manifest.file_inventory[0].sha256='c'.repeat(64)});
check('N26_BAD_ACTUAL_REGISTRY',false,x=>{x.snapshot.actual_registry_sha256='c'.repeat(64)});
check('N27_BAD_SOURCE_REGISTRY',false,x=>{x.snapshot.source_registry_sha256='c'.repeat(64)});
check('N28_UNTRUSTED_CASE',false,x=>{x.expected.case_id='WRONG'});
check('N29_DUPLICATE_ACCEPTANCE',false,x=>{x.expected.acceptance_ids.push(x.expected.acceptance_ids[0])});
check('N30_NO_SIGNATURE_ADAPTER',false,x=>{x.verifyIndependentApproval=null});
check('N31_HUMAN_SIGNATURE_DENIED',false,x=>{x.verifyIndependentApproval=()=>false});
check('N32_NO_ANCESTRY_ADAPTER',false,x=>{x.verifyGitAncestry=null});
check('N33_FOREIGN_GIT_ANCESTRY',false,x=>{x.verifyGitAncestry=()=>false});
check('N34_CANONICAL_2026_10_11_HOLD',false,x=>{
 x.snapshot.build={active_baseline:'BS-P1-024',implementation_enabled:false};
 x.snapshot.sprint={status:'HOLD',active_sprint:null,active_task:null,active_build_spec:null};
 x.snapshot.activation=null;
});
check('N35_MISSING_TEST_IDS',false,x=>{x.expected.test_ids=[]});
check('N36_MANIFEST_REGISTRY_PATH_WRONG',false,x=>{x.snapshot.manifest.acceptance_registry='untrusted.json'});
const result={case_id:'GOV-CASE-T006-REBIND-001',mode:'EPHEMERAL_APPROVAL_AND_GIT_ANCESTRY_TEST_DOUBLES_NOT_PRODUCTION',node:process.version,total:tests.length,matched:tests.length,positive:tests.filter(x=>x.expected).length,negative:tests.filter(x=>!x.expected).length,tests};
console.log(JSON.stringify(result,null,2));
