// APPf2 R4 replay ledger MODEL; does NOT provide the external immutable CAS store.
import {createHash} from 'node:crypto';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const GENESIS='GENESIS';
const fail=code=>({ok:false,code});
const isHex=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const validRun=e=>e?.repo==='NFF98/appf2-build'&&
 Number.isSafeInteger(e.run_id)&&e.run_id>0&&
 Number.isSafeInteger(e.run_attempt)&&e.run_attempt>0;
const validOwnership=e=>typeof e.evidence_id==='string'&&e.evidence_id.length>0&&
 typeof e.task_id==='string'&&e.task_id.length>0&&e.baseline_id==='BS-P1-025';
const validAcceptance=e=>Array.isArray(e.acceptance_ids)&&e.acceptance_ids.length>0&&
 e.acceptance_ids.every(a=>typeof a==='string'&&a.length>0)&&
 new Set(e.acceptance_ids).size===e.acceptance_ids.length&&isHex(e.artifact_sha256);
const validEvent=e=>validRun(e)&&validOwnership(e)&&validAcceptance(e);
const key=e=>[e.repo,e.run_id,e.run_attempt,e.evidence_id,e.task_id,e.baseline_id,...e.acceptance_ids].join('|');
const makeEntry=(prev,event)=>({previous:prev,event,key:key(event),digest:digest({previous:prev,event,key:key(event)})});
export function inspectLedger({entries,externallyTrustedHead}){
 if(!Array.isArray(entries)||!(externallyTrustedHead===GENESIS||isHex(externallyTrustedHead)))return fail('MISSING_EXTERNAL_ANCHOR');
 const seen=new Set();let head=GENESIS;
 for(const row of entries){
  if(!validEvent(row?.event)||row.previous!==head||row.key!==key(row.event))return fail('BROKEN_LEDGER_CHAIN');
  if(seen.has(row.key))return fail('REPLAYED_EVENT');
  const expected=makeEntry(head,row.event);
  if(row.digest!==expected.digest)return fail('MUTATED_LEDGER_RECORD');
  seen.add(row.key);head=row.digest;
 }
 if(head!==externallyTrustedHead)return fail('UNTRUSTED_LEDGER_HEAD');
 return {ok:true,head,seen};
}
export function proposeAppend({entries,externallyTrustedHead,event,compareAndSet}){
 const inspected=inspectLedger({entries,externallyTrustedHead});
 if(!inspected.ok)return inspected;
 if(!validEvent(event))return fail('INVALID_EVENT');
 const nextKey=key(event);
 if(inspected.seen.has(nextKey))return fail('REPLAYED_EVENT');
 if(typeof compareAndSet!=='function')return fail('MISSING_EXTERNAL_ATOMIC_CAS');
 const next=makeEntry(inspected.head,event);
 // Compare-and-swap MUST be implemented by a separate trusted, durable authority;
 // mock callbacks below are tests, NOT a deployed ledger or replay guarantee.
 if(compareAndSet({expectedHead:inspected.head,nextHead:next.digest,entry:next})!==true)return fail('ATOMIC_CAS_REJECTED');
 return {ok:true,code:'TEST_DOUBLE_EXTERNAL_CAS_ONLY',head:next.digest,entry:next};
}
if(process.argv[1]?.endsWith('R4-REPLAY-LEDGER.mjs')&&process.argv[2]==='commit'){
 console.error('R4 ISOLATED LEDGER: no trusted durable CAS backend; FAIL CLOSED');
 process.exitCode=2;
}
