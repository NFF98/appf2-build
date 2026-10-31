/** Real FREE_ONLY Stage E2E, NO model calls: private owner source → GitHub
 * workflow_dispatch → OIDC → Docker → Chromium frozen QA → Postgres receipt.
 * Local test-authored source is NOT an AI-generated product acceptance PASS.
 * Never run against Production. A missing callback is FAIL, not optimistic PASS.
 */
import {randomUUID,webcrypto} from "node:crypto";
const origin=process.env.APPF2_STAGING_URL??"";
if(!/^https:\/\/appf2-sp35-[a-z0-9-]*staging\.[a-z0-9-]+\.workers\.dev$/iu.test(origin))
 throw Error("FREE_LIVE_DISPATCH_REFUSE_NON_STAGING");
const crypto=webcrypto,owner=randomUUID(),prompt="請建立有按鈕可擲骰，點擊後顯示得分 6 的互動骰子遊戲";
const keys=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},
 false,["sign","verify"]);
const spki=Buffer.from(await crypto.subtle.exportKey("spki",keys.publicKey))
 .toString("base64url");
const sha=async raw=>Buffer.from(await crypto.subtle.digest("SHA-256",raw)).toString("base64url");
async function signed(path,body,expected){
 const bytes=new TextEncoder().encode(JSON.stringify(body));
 const nonce="sp35FreeReal_"+randomUUID().replaceAll("-","");
 const now=Date.now();
 const signature=Buffer.from(await crypto.subtle.sign(
  {name:"ECDSA",hash:"SHA-256"},keys.privateKey,
  new TextEncoder().encode(JSON.stringify([
   "APPF2_MUTATION_PoP_V1","POST",path,await sha(bytes),nonce,now]))))
  .toString("base64url");
 const response=await fetch(origin+path,{
  method:"POST",redirect:"error",headers:{
   "Content-Type":"application/json","Origin":origin,
   "Sec-Fetch-Site":"same-origin","Idempotency-Key":nonce,
   "X-Appf2-PoP-Key":spki,"X-Appf2-PoP-Signature":signature,
   "X-Appf2-PoP-Timestamp":String(now)},
  body:bytes,signal:AbortSignal.timeout(25000)});
 const reply=await response.json().catch(()=>null);
 if(response.status!==expected||!reply?.data)
  throw Error("FREE_LIVE_DISPATCH_UNEXPECTED_HTTP_"+response.status+"_PATH_"+path);
 return reply.data;
}
const initial=await signed("/api/v1/agent-jobs",{anonymous_id:owner,prompt},201);
if(initial.revision!==0||initial.ai_started!==false||initial.app_published!==false)
 throw Error("FREE_LIVE_DISPATCH_INIT_NOT_NO_AI");
const job=initial.job_id,base="/api/v1/agent-jobs/"+job;
const plan={version:"1",criteria:[{
 id:"dice_button",source_quote:"按鈕",description:"點擊擲骰後真實出現得分",
 steps:[{action:"click",role:"button",name:"擲骰"}],
 assertions:[{kind:"text_appears",text:"得分：6"}],automatable:true}]};
const frozen=await signed(base+"/qa-plan",{anonymous_id:owner,
 expected_revision:0,original_prompt:prompt,original_plan:plan},200);
if(frozen.status!=="QA_ORIGINAL_PLAN_FROZEN")
 throw Error("FREE_LIVE_DISPATCH_NOT_PRE_CODE_FROZEN");
const source=`import "./style.css";
const app=document.querySelector("#app");
if(!app)throw Error("APP_NOT_FOUND");
const title=document.createElement("h1");
title.textContent="免費 Docker 真實互動測試";
const output=document.createElement("p");
output.textContent="得分：0";
const button=document.createElement("button");
button.textContent="擲骰";
button.addEventListener("click",()=>{output.textContent="得分：6";});
app.replaceChildren(title,output,button);
`;
const imported=await signed(base+"/import-files",{anonymous_id:owner,
 expected_revision:0,expected_project_hash:initial.project_hash,
 files:[{path:"src/main.ts",content:source}]},200);
if(imported.status!=="IMPORTED_NO_AI"||imported.revision!==2||
 imported.project_hash===initial.project_hash||imported.app_published!==false)
 throw Error("FREE_LIVE_DISPATCH_IMPORT_NOT_PERSISTED");
const persisted=await signed(base,{anonymous_id:owner},200);
if(persisted.project_hash!==imported.project_hash||
 persisted.checkpoint?.cost_cents!==0||persisted.checkpoint?.step!==0||
 persisted.ai_started!==false||persisted.free_ci!==null)
 throw Error("FREE_LIVE_DISPATCH_IMPORTED_JOB_NOT_REAL");
console.log("SP35_FREE_REAL_IMPORTED_JOB: owner P-256, frozen QA, revision2, real PostgreSQL, zero AI cost");
const queued=await signed(base+"/free-ci-dispatch",{anonymous_id:owner,
 explicit_free_ci_consent:true},202);
if(queued.status!=="FREE_CI_QUEUED"||queued.app_published!==false)
 throw Error("FREE_LIVE_DISPATCH_NOT_ACCEPTED");
console.log("SP35_FREE_REAL_DISPATCH: Worker→GitHub Actions HTTP204 accepted, no paid AI");
const deadline=Date.now()+9*60_000;
let last=null;
while(Date.now()<deadline){
 await new Promise(resolve=>setTimeout(resolve,14000));
 const current=await signed(base,{anonymous_id:owner},200);
 if(current.project_hash!==imported.project_hash||
  current.app_published!==false||current.ai_started!==false)
  throw Error("FREE_LIVE_DISPATCH_JOB_CHANGED_OR_FALSE_AUTHORITY");
 last=current.free_ci;
 if(!last)continue;
 if(last.status!=="BUILD_BROWSER_SMOKE"||
  last.original_requirements_qa!==false||last.app_published!==false||
  !/^sha256:[a-f0-9]{64}$/u.test(last.artifact_hash)||
  !/^[0-9]{6,20}$/u.test(last.run_id)||
  last.qa_checks?.length!==1||
  last.qa_checks[0]?.criterion_id!=="dice_button"||
  last.qa_checks[0]?.verdict!=="PASS"||
  !/^sha256:[a-f0-9]{64}$/u.test(last.qa_checks[0].evidence_hash))
  throw Error("FREE_LIVE_DISPATCH_RECEIPT_NOT_VERIFIED");
 console.log("SP35 REAL FREE JOB→GITHUB OIDC→DOCKER→CHROMIUM QA→ORIGINAL POSTGRES JOB PASS");
 console.log("SP35 FREE REAL GITHUB RUN: "+last.run_id);
 console.log("SP35 LIMIT: fixed zero-cost operator-authored source only, NOT AI-generated or public Blueprint v2");
 process.exit(0);
}
throw Error("FREE_LIVE_DISPATCH_RECEIPT_TIMEOUT_NO_PASS_"+String(last?.status??"MISSING"));
