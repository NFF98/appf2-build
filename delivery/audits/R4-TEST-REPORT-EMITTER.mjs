// GOV-CASE-T006-REBIND-001 R4: isolated Vitest JSON -> exact Test/Acceptance proof mapping.
// NOT A CI SIGNER. The caller must separately prove this report came from trusted execution.
const validSHA=x=>typeof x==='string'&&/^[0-9a-f]{40}$/.test(x)&&!/^0+$/.test(x);
const validHex=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const exactId=s=>[...String(s||'').matchAll(/TEST-[A-Z0-9-]+/g)].map(m=>m[0]);
const uniq=a=>Array.isArray(a)&&a.length>0&&new Set(a).size===a.length;
const reject=reason=>({ok:false,reason});
const validateExpected=e=>e?.repo==='NFF98/appf2-build'&&e.ref==='refs/heads/main'&&
 e.workflow==='.github/workflows/revalidation-proof.yml'&&validSHA(e.source_sha)&&
 Number.isSafeInteger(e.run_id)&&e.run_id>0&&Number.isSafeInteger(e.run_attempt)&&e.run_attempt>0&&
 validHex(e.source_registry_sha256)&&validHex(e.target_registry_sha256)&&
 uniq(e.acceptance_ids)&&uniq(e.test_ids)&&e.acceptance_ids.length===e.test_ids.length;
const validateEnvironment=(e,v)=>v?.GITHUB_REPOSITORY===e.repo&&v.GITHUB_REF===e.ref&&
 v.GITHUB_EVENT_NAME==='push'&&v.GITHUB_SHA===e.source_sha&&
 Number(v.GITHUB_RUN_ID)===e.run_id&&Number(v.GITHUB_RUN_ATTEMPT)===e.run_attempt;
const validateReport=r=>r?.success===true&&Number.isSafeInteger(r.numTotalTests)&&r.numTotalTests>0&&
 r.numFailedTests===0&&r.numPendingTests===0&&Array.isArray(r.testResults);
const allAssertions=report=>report.testResults.flatMap(file=>file.assertionResults||[]);
const validateAssertions=tests=>tests.length>0&&tests.every(t=>t.status==='passed'&&
 typeof t.fullName==='string'&&t.fullName.length>0);
const validateMapping=(expected,tests)=>{
 const observed=new Map();
 for(const t of tests){
  const ids=exactId(t.fullName);
  if(ids.length>1)return null;
  if(ids.length===1){
   const id=ids[0];if(observed.has(id))return null;
   observed.set(id,t);
  }
 }
 if(expected.test_ids.some(id=>!observed.has(id)))return null;
 return expected.test_ids.map((test_id,i)=>({
  acceptance_id:expected.acceptance_ids[i],test_id,status:'PASS',
  executed:true,assertion_count:1,skipped:0
 }));
};
export function prepareProof({expected,env,vitest}){
 if(!validateExpected(expected))return reject('UNTRUSTED_EXPECTATION');
 if(!validateEnvironment(expected,env))return reject('UNTRUSTED_EXECUTION_ENV');
 if(!validateReport(vitest))return reject('SUITE_INCOMPLETE_OR_FAILED');
 const assertions=allAssertions(vitest);
 if(!validateAssertions(assertions)||assertions.length!==vitest.numTotalTests)return reject('ASSERTION_COUNT_OR_STATUS_MISMATCH');
 const results=validateMapping(expected,assertions);
 if(!results)return reject('MISSING_DUPLICATE_OR_AMBIGUOUS_MAPPED_TEST');
 return {ok:true,report:{...expected,product_ci_mode:'EXECUTED',gate_status:'PASS',results},status:'LOCAL_EMITTER_STRUCTURAL_ONLY'};
}

// Production proof generation is intentionally disabled until exact trusted
// preflight, covered Test report runner, and signed workflow are authorized.
if(process.argv[1]?.endsWith('R4-TEST-REPORT-EMITTER.mjs')&&process.argv[2]==='emit'){
 console.error('R4 EMITTER: no authorized runner context or real test report; FAIL CLOSED');
 process.exitCode=2;
}
