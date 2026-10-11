import assert from 'node:assert/strict';
import {inspectProposedMainAnchor, inspectGitHubMainLedgerPR} from './R4-MAIN-ANCHORED-LEDGER-CANDIDATE.mjs';
import {proposeAppend} from './R4-REPLAY-LEDGER.mjs';
const H='a'.repeat(40), NEXT='b'.repeat(40), D='c'.repeat(64);
const ruleset={enforcement:'active',conditions:{ref_name:{include:['~DEFAULT_BRANCH'],exclude:[]}},bypass_actors:[],rules:[
 {type:'deletion'},{type:'non_fast_forward'},
 {type:'pull_request',parameters:{required_approving_review_count:0}},
 {type:'required_status_checks',parameters:{strict_required_status_checks_policy:true,required_status_checks:['ci','attack','governance','Analyze JavaScript / TypeScript'].map(context=>({context}))}}]};
const event={repo:'NFF98/appf2-build',run_id:52,run_attempt:1,evidence_id:'EV-SP-P1-004-T008-001',task_id:'T008',baseline_id:'BS-P1-025',acceptance_ids:['F01-AC-017'],artifact_sha256:D};
const initial={schema_version:1,entries:[],head:'GENESIS'};
const append=proposeAppend({entries:initial.entries,externallyTrustedHead:initial.head,event,compareAndSet:()=>true});
assert.equal(append.ok,true);
const next={schema_version:1,entries:[append.entry],head:append.head};
const args={repository:'NFF98/appf2-build',baseSha:H,headSha:NEXT,liveMainSha:H,ruleset,baseLedger:initial,proposedLedger:next,isBaseAncestor:true};
const clone=o=>JSON.parse(JSON.stringify(o));
const tests=[];
function check(name,expected,mutation){const x=clone(args);mutation?.(x);const got=inspectProposedMainAnchor(x);assert.equal(got.ok,expected,name+': '+got.code);tests.push({name,ok:got.ok,code:got.code});}
check('P01_REAL_GITHUB_RULESET_STRUCTURE_PLUS_ONE_APPEND',true);
check('N01_STALE_REMOTE_MAIN',false,x=>{x.liveMainSha='d'.repeat(40)});
check('N02_UNRELATED_PR_HEAD',false,x=>{x.isBaseAncestor=false});
check('N03_GITHUB_RULESET_DISABLED',false,x=>{x.ruleset.enforcement='disabled'});
check('N04_WRITABLE_FORCE_PUSH',false,x=>{x.ruleset.rules=x.ruleset.rules.filter(y=>y.type!=='non_fast_forward')});
check('N05_DELETE_ALLOWED',false,x=>{x.ruleset.rules=x.ruleset.rules.filter(y=>y.type!=='deletion')});
check('N06_NO_PR_MERGE_REQUIREMENT',false,x=>{x.ruleset.rules=x.ruleset.rules.filter(y=>y.type!=='pull_request')});
check('N07_NONSTRICT_STATUS',false,x=>{x.ruleset.rules.find(y=>y.type==='required_status_checks').parameters.strict_required_status_checks_policy=false});
check('N08_MISSING_CODEQL',false,x=>{x.ruleset.rules.find(y=>y.type==='required_status_checks').parameters.required_status_checks.pop()});
check('N09_UNTRUSTED_BYPASS_ACTOR',false,x=>{x.ruleset.bypass_actors=[{actor_type:'User'}]});
check('N10_WRONG_BRANCH_SELECTOR',false,x=>{x.ruleset.conditions.ref_name.include=['refs/heads/staging']});
check('N11_FOREIGN_REPOSITORY',false,x=>{x.repository='other/appf2-build'});
check('N12_CHANGED_HISTORIC_ENTRY',false,x=>{x.baseLedger=next;x.proposedLedger={schema_version:1,entries:[{...append.entry,key:'forged'}],head:next.head}});
check('N13_LEDGER_HEAD_TAMPER',false,x=>{x.proposedLedger.head='f'.repeat(64)});
check('N14_MISSING_NEW_ENTRY',false,x=>{x.proposedLedger=initial});
check('N15_DANGLING_LEDGER_PREVIOUS',false,x=>{x.proposedLedger.entries[0].previous='f'.repeat(64)});
check('N16_EMPTY_REMOTE_SHA',false,x=>{x.liveMainSha=''});
check('N17_FAKE_EXTRA_ENTRY',false,x=>{x.proposedLedger.entries.push(x.proposedLedger.entries[0])});
check('N18_OTHER_REPO_LEDGER_ENTRY',false,x=>{x.proposedLedger.entries[0].event.repo='other/repo'});
const direct=inspectGitHubMainLedgerPR({baseSha:H,headSha:NEXT});assert.equal(direct.ok,false);
assert.equal(direct.code,'UNTRUSTED_GITHUB_EVENT');
const out={mode:'REVIEW_ONLY_SYNTHETIC_GITHUB_RULESET_STRUCTURE',node:process.version,total:tests.length,matched:tests.length,positive:1,negative:18,direct_cli_fail_closed:direct.code,tests};
console.log(JSON.stringify(out,null,2));
