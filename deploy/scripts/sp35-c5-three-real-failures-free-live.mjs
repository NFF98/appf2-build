/** C5 REAL independent browser QA receipt LINEAGE, zero-model-call fixture.
 * Three distinct SAME-owner, SAME-Job, SAME-frozen-plan project versions
 * genuinely FAIL in separate OIDC GitHub Docker/Chromium Actions runs.
 * A fourth manually changed source PASSes. This never simulates model repair,
 * auto-switches model/provider, or claims a paid GPT-6 strategy PASS.
 */
import {randomUUID,webcrypto} from "node:crypto";
const origin="https://appf2-sp35-417-staging.juiyuang69.workers.dev";
const crypto=webcrypto,owner=randomUUID();
const keys=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},
 false,["sign","verify"]);
const spki=Buffer.from(await crypto.subtle.exportKey("spki",keys.publicKey))
 .toString("base64url");
const digest=async b=>Buffer.from(await crypto.subtle.digest("SHA-256",b))
 .toString("base64url");
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function signed(path,body,status=200){
 const bytes=new globalThis.TextEncoder().encode(JSON.stringify(body));
 const nonce="sp35C4Free_"+randomUUID().replaceAll("-","");
 const now=Date.now();
 const transcript=new globalThis.TextEncoder().encode(JSON.stringify([
  "APPF2_MUTATION_PoP_V1","POST",path,await digest(bytes),nonce,now]));
 const sig=Buffer.from(await crypto.subtle.sign(
  {name:"ECDSA",hash:"SHA-256"},keys.privateKey,transcript))
  .toString("base64url");
 const response=await fetch(origin+path,{method:"POST",redirect:"error",headers:{
  "Content-Type":"application/json","Origin":origin,"Sec-Fetch-Site":"same-origin",
  "Idempotency-Key":nonce,"X-Appf2-PoP-Key":spki,
  "X-Appf2-PoP-Signature":sig,"X-Appf2-PoP-Timestamp":String(now)},
  body:bytes,signal:globalThis.AbortSignal.timeout(125000)});
 const json=await response.json().catch(()=>null);
 if(response.status!==status||!json?.data)
  throw Error("C4_SIGNED_HTTP_"+response.status+"_ROUTE_"+path.split("/").at(-1)+
   "_"+String(json?.error??"NO_DATA").slice(0,80));
 return json.data;
}
const prompt="請做一個可操作骰子遊戲：按「擲骰」按鈕後顯示「得分：6」。";
const plan={version:"1",criteria:[{
 id:"dice_action",source_quote:"按「擲骰」按鈕後顯示「得分：6」",
 description:"Chromium 實際按擲骰並觀察文字",
 automatable:true,
 steps:[{action:"click",role:"button",name:"擲骰"}],
 assertions:[{kind:"text_appears",text:"得分：6"}]}]};

const script=value=>`import "./style.css";
const app=document.querySelector("#app");
if(!app)throw Error("ROOT_NOT_FOUND");
const button=document.createElement("button");
button.textContent="擲骰";
const output=document.createElement("p");
output.textContent="得分：0";
button.addEventListener("click",()=>{output.textContent="得分：${value}";});
app.replaceChildren(button,output);`;
const created=await signed("/api/v1/agent-jobs",{
 anonymous_id:owner,prompt},201);
if(created.revision!==0||created.ai_started!==false||
 created.approved_max_cost_cents!==0||created.app_published!==false)
 throw Error("C5_NO_CHARGE_OWNER_JOB_INVALID");
const base="/api/v1/agent-jobs/"+created.job_id;
await signed(base+"/qa-plan",{anonymous_id:owner,expected_revision:0,
 original_prompt:prompt,original_plan:plan});
const first=await signed(base+"/import-files",{
 anonymous_id:owner,expected_revision:0,
 expected_project_hash:created.project_hash,
 files:[{path:"src/main.ts",content:script(0)}]});
if(first.revision!==2)throw Error("C5_INITIAL_SOURCE_NOT_DURABLE");
let currentHash=first.project_hash;
let currentRevision=first.revision;
const observed=[];
async function dispatch(){
 const queued=await signed(base+"/free-ci-dispatch",{
  anonymous_id:owner,explicit_free_ci_consent:true},202);
 if(queued.status!=="FREE_CI_QUEUED")
  throw Error("C5_REAL_FREE_CI_NOT_DISPATCHED");
}
// eslint-disable-next-line complexity -- Every signed independent QA, replay and spend fence must fail closed.
async function receiptFor(hash,verdict){
 const cutoff=Date.now()+9*60*1000;
 while(Date.now()<cutoff){
  await sleep(11000);
  const saved=await signed(base,{anonymous_id:owner});
  if(saved.project_hash!==hash||saved.app_published!==false||
    saved.ai_started!==false||saved.checkpoint.cost_cents!==0)
   throw Error("C5_ORIGINAL_OWNER_HASH_OR_SPEND_CHANGED");
  const r=saved.free_ci;
  if(!r)continue;
  if(r.status!=="BUILD_BROWSER_SMOKE"||r.qa_checks?.length!==1||
   r.qa_checks[0].criterion_id!=="dice_action"||
   r.qa_checks[0].verdict!==verdict||
   r.original_requirements_qa!==false||
   !/^[0-9]{6,20}$/u.test(r.run_id))
   throw Error("C5_REAL_CHROMIUM_WRONG_RECEIPT");
  if(verdict==="FAIL"&&
   r.qa_checks[0].failure_code!=="ASSERTION_FAILED")
   throw Error("C5_FAILURE_SIGNATURE_CHANGED");
  if(verdict==="PASS"&&
   (!/^sha256:[a-f0-9]{64}$/u.test(r.qa_checks[0].evidence_hash)||
    r.preview_ready!==true))continue;
  return {receipt:r,job:saved};
 }
 throw Error("C5_REAL_CHROMIUM_RECEIPT_TIMEOUT_"+verdict);
}
// Three independent BAD project snapshots, all on this one signed Job.
// Never forge an attestation: the locked Docker + Chromium runner decides.
for(let index=0;index<3;index++){
 await dispatch();
 const actual=await receiptFor(currentHash,"FAIL");
 if(actual.job.revision!==currentRevision)
  throw Error("C5_INDEPENDENT_FAIL_STALE_JOB");
 observed.push({revision:currentRevision,hash:currentHash,
  plan:actual.receipt.qa_plan_hash,code:actual.receipt.qa_checks[0].failure_code,
  run_id:actual.receipt.run_id});
 console.log("C5 REAL FAIL "+(index+1)+"/3: immutable source revision "+
  currentRevision+" with independent Chromium ASSERTION_FAILED");
 if(index===2)break;
 const repaired=await signed(base+"/import-repair",{
  anonymous_id:owner,expected_revision:currentRevision,
  expected_project_hash:currentHash,
  files:[{path:"src/main.ts",content:script(index+1)}]});
 if(repaired.status!=="MANUAL_REPAIR_SAVED_NO_AI"||
    repaired.revision!==currentRevision+2||
    repaired.project_hash===currentHash)
  throw Error("C5_INTERMEDIATE_MANUAL_SOURCE_NOT_SAVED");
 currentHash=repaired.project_hash;
 currentRevision=repaired.revision;
}
if(observed.length!==3||new Set(observed.map(x=>x.hash)).size!==3||
 new Set(observed.map(x=>x.plan)).size!==1||
 observed.some((x,i)=>x.revision!==2*(i+1)||x.code!=="ASSERTION_FAILED"))
 throw Error("C5_THREE_CONSECUTIVE_FROZEN_FAILURES_NOT_PROVEN");
console.log("C5 REAL HISTORY: exactly 3 distinct signed failed source versions "+
 "with one immutable QA plan, before any strategy choice; NO model call");
const evidence=await signed(base+"/free-ai-repair-evidence",{
 anonymous_id:owner,original_prompt:prompt});
if(evidence.status!=="C5_EVIDENCE_ONLY"||
 evidence.project_hash!==currentHash||
 evidence.job_revision!==currentRevision||
 evidence.project_revision!==4||
 evidence.next_round!==3||
 evidence.repeated_failure_count!==3||
 evidence.evidence_snapshots!==3||
 evidence.mode!=="RETHINK_ROOT_CAUSE"||
 evidence.paid_model_requests_issued_by_inspection!==0)
 throw Error("C5_REAL_POLICY_DID_NOT_SWITCH_AFTER_3_CHROMIUM_FAILS");
console.log("C5 REAL STAGING STRATEGY POLICY PASS: after three independent "+
 "frozen-QA FAILs, same production repair analyzer recommends "+
 "RETHINK_ROOT_CAUSE; NO AI/model charges");
const fixed=await signed(base+"/import-repair",{
 anonymous_id:owner,expected_revision:currentRevision,
 expected_project_hash:currentHash,
 files:[{path:"src/main.ts",content:script(6)}]});
if(fixed.revision!==8||fixed.project_hash===currentHash||
 fixed.ai_started!==false||fixed.app_published!==false)
 throw Error("C5_NEW_SOURCE_AFTER_3_FAILS_NOT_PERSISTED");
await dispatch();
const passed=await receiptFor(fixed.project_hash,"PASS");
if(passed.job.revision!==8||passed.job.checkpoint.cost_cents!==0)
 throw Error("C5_FINAL_ZERO_COST_RESULT_INVALID");
const reopened=await signed(base+"/free-ci-preview",{
 anonymous_id:owner,expected_project_hash:fixed.project_hash});
if(typeof reopened.javascript!=="string"||reopened.javascript.length<100)
 throw Error("C5_FINAL_PRIVATE_SAVED_APP_NOT_REOPENABLE");
console.log("C5 FREE LIVE HISTORY PASS: 3 real failed versions "+
 "→ manual changed source → independent Chromium PASS → same-Job reopen");
console.log("C5 LIMIT: zero-provider-call/manual source. AUTO paid GPT-6 "+
 "RETHINK_ROOT_CAUSE and model/provider switching remain NOT VERIFIED");
