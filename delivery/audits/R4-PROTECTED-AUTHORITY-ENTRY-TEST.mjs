import assert from 'node:assert/strict';
import {inspectProposedProtectedAuthority,verifyClosedRoundForRepo} from './R4-PROTECTED-AUTHORITY-ENTRY-CANDIDATE.mjs';
const BASE={round:{status:'CLOSED',evidence_ids:['EV-SAMPLE']},scope:'EVIDENCE',item:{backlog_item_id:'BL-P1-008'},evidence:{evidence_id:'EV-SAMPLE'},expected:{},artifactPath:'/not-trusted/a.json',approvalSigner:()=>false,ledgerSource:()=>null,ghCli:()=>{throw Error('fake')}};
const clone=x=>({...x,round:{...x.round,evidence_ids:[...x.round.evidence_ids]},item:{...x.item},evidence:{...x.evidence},expected:{...x.expected}});
const results=[];const test=(name,m)=>{const input=clone(BASE);m?.(input);const result=inspectProposedProtectedAuthority(input);assert.equal(result.ok,false,name);results.push({name,code:result.code})};
for(const scope of ['BACKLOG','SCOPE','EVIDENCE']){
 const x=verifyClosedRoundForRepo({round:{status:'CLOSED',evidence_ids:['EV-SAMPLE']},scope});
 assert.equal(x.ok,false);assert.equal(x.code,'INDEPENDENT_APPROVAL_AND_DURABLE_LEDGER_NOT_PROVISIONED');results.push({name:'N_PRODUCTION_'+scope,code:x.code});
}
test('N_UNBOUND_EVIDENCE');
test('N_INVALID_SCOPE',x=>{x.scope='PRODUCT'});
test('N_INVALID_ROUND',x=>{x.round.status='IN_PROGRESS'});
test('N_NO_BACKLOG_OWNER',x=>{x.item=null});
test('N_NO_EXPECTATION',x=>{x.expected=null});
test('N_NO_ARTIFACT_PATH',x=>{x.artifactPath=''});
test('N_WRONG_EVIDENCE_OWNER',x=>{x.evidence.evidence_id='OTHER'});
test('N_NO_EVIDENCE_LOOKUP_FOR_SCOPE',x=>{x.scope='SCOPE';x.evidence=undefined});
test('N_NO_APPROVAL_SIGNER',x=>{x.approvalSigner=null});
test('N_NO_LEDGER',x=>{x.ledgerSource=null});
test('N_NO_SIGNER_PROOF',x=>{x.approvalSigner=()=>true});
test('N_FORGED_INJECTED_CI',x=>{x.approvalSigner=()=>true;x.ghCli=()=>'{"forged":true}'});
console.log(JSON.stringify({total:results.length,negative:results.length,matched:results.length,real_attestation_positive:0,not_installed:true,results},null,2));
