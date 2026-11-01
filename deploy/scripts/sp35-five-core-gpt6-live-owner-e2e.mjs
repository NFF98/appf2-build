/** One-shot user-authorized Sprint 3.5 real paid model→free Docker E2E.
 * Only API requests signed by a NEW ephemeral P-256 test owner. All AI
 * provider requests go through Worker+immutable journal+GitHub OIDC runner.
 * DO NOT reuse a failed model dispatch, expose owner keys, or fake QA.
 * 76c MAX APPROVED RESERVATION for this one test Job (not invoice).
 */
import {randomUUID,webcrypto} from "node:crypto";
const origin="https://appf2-sp35-417-staging.juiyuang69.workers.dev";
const prompt="請建立一個可操作的任務計分 App。起始必須顯示「分數：0」。按「加一」後顯示「分數：1」，再按一次顯示「分數：2」。按「歸零」後顯示「分數：0」。需要漂亮的介面且功能真的可操作。";
const plan={version:"1",criteria:[
 {id:"initial_count",source_quote:"分數：0",description:"開啟顯示分數零",
  automatable:true,steps:[],assertions:[{kind:"text_includes",text:"分數：0"}]},
 {id:"increment_once",source_quote:"按「加一」後顯示「分數：1」",description:"真實點一下加一",
  automatable:true,steps:[{action:"click",role:"button",name:"加一"}],
  assertions:[{kind:"text_appears",text:"分數：1"}]},
 {id:"increment_twice",source_quote:"再按一次顯示「分數：2」",description:"真實點兩下",
  automatable:true,steps:[{action:"click",role:"button",name:"加一"},
   {action:"click",role:"button",name:"加一"}],
  assertions:[{kind:"text_appears",text:"分數：2"}]}
]};
const crypto=webcrypto,owner=randomUUID();
const keys=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},
 false,["sign","verify"]);
const spki=Buffer.from(await crypto.subtle.exportKey("spki",keys.publicKey))
 .toString("base64url");
const sha=async bytes=>Buffer.from(await crypto.subtle.digest("SHA-256",bytes))
 .toString("base64url");
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function signed(path,body,expected=200){
 const bytes=new globalThis.TextEncoder().encode(JSON.stringify(body));
 const nonce="sp35FiveCore_"+randomUUID().replaceAll("-","");
 const now=Date.now();
 const transcript=new globalThis.TextEncoder().encode(JSON.stringify([
  "APPF2_MUTATION_PoP_V1","POST",path,await sha(bytes),nonce,now]));
 const signature=Buffer.from(await crypto.subtle.sign(
  {name:"ECDSA",hash:"SHA-256"},keys.privateKey,transcript)).toString("base64url");
 const response=await fetch(origin+path,{method:"POST",redirect:"error",
  headers:{"Origin":origin,"Sec-Fetch-Site":"same-origin",
   "Content-Type":"application/json","Idempotency-Key":nonce,
   "X-Appf2-PoP-Key":spki,"X-Appf2-PoP-Signature":signature,
   "X-Appf2-PoP-Timestamp":String(now)},
  body:bytes,signal:globalThis.AbortSignal.timeout(125000)});
 const raw=await response.json().catch(()=>null);
 if(!(Array.isArray(expected)?expected.includes(response.status):response.status===expected)||!raw?.data)
  throw Error("C5_SIGNED_HTTP_"+response.status+"_AT_"+path.split("/").at(-1)+
   "_"+String(raw?.error??"NO_DATA").slice(0,70));
 return raw.data;
}
const created=await signed("/api/v1/agent-jobs",{
 anonymous_id:owner,prompt,max_cost_cents:76,explicit_ai_consent:true},201);
if(created.revision!==0||created.approved_max_cost_cents!==76||
 created.ai_started!==false||created.app_published!==false)
 throw Error("C2_CREATOR_SIGNED_JOB_NOT_SAVED");
const base="/api/v1/agent-jobs/"+created.job_id;
const frozen=await signed(base+"/qa-plan",{
 anonymous_id:owner,expected_revision:0,
 original_prompt:prompt,original_plan:plan});
if(frozen.status!=="QA_ORIGINAL_PLAN_FROZEN")
 throw Error("C4_ORIGINAL_QA_NOT_FROZEN_BEFORE_CODING");
console.log("C2 REAL: owner signed Staging PostgreSQL Job + frozen original QA PASS; no provider calls yet");
const deadline=Date.now()+17*60*1000;
const stages=["CODE","REPAIR","REPAIR","REPAIR"];
let phase=0,repaired=0,sawQa=false,sawPass=false;
for(const stage of stages){
 if(Date.now()>=deadline)throw Error("C4_C5_TIME_BUDGET_EXHAUSTED_KEEP_JOB");
 phase++;
 let stageFinished=false;
 // Same immutable phase+owner+Job, repeated POST is GET-only recovery.
 for(let attempt=0;attempt<100&&Date.now()<deadline;attempt++){
  const before=await signed(base,{anonymous_id:owner});
  const result=await signed(base+"/free-ai-stage",{
   anonymous_id:owner,original_prompt:prompt,
   expected_project_hash:before.project_hash,stage,
   explicit_ai_consent:true,explicit_free_ci_consent:true},[200,202]);
  if(result?.status==="AI_SOURCE_SAVED_FREE_CI_QUEUED"){
   stageFinished=true;break;
  }
  if(result?.status==="AI_SOURCE_SAVED_CI_DISPATCH_UNCONFIRMED")
   throw Error("C4_PAID_RESULT_SAVED_CI_DISPATCH_UNCONFIRMED_NO_RETRY");
  if(result!==null&&result?.status!=="AI_BACKGROUND_PENDING")
   throw Error("C4_C5_MODEL_STAGE_UNEXPECTED_"+String(result?.status));
  await sleep(7000);
 }
 if(!stageFinished)throw Error("C4_MODEL_RESULT_NOT_CONFIRMED_NO_SECOND_PAID_POST");
 console.log("C4 GPT-6.1 Sol stage "+stage+" #"+phase+
  " saved; exact new source revision and free Docker dispatch verified");
 let next=null;
 for(let poll=0;poll<75&&Date.now()<deadline;poll++){
  await sleep(9000);
  const j=await signed(base,{anonymous_id:owner});
  if(j.free_ci&&j.free_ci.original_requirements_qa===false){
   next=j;break;
  }
 }
 if(!next)throw Error("C3_DOCKER_RECEIPT_MISSING_NO_PASS");
 const receipt=next.free_ci;
 const checks=receipt.qa_checks??[];
 sawQa||=checks.length===plan.criteria.length;
 const failed=receipt.status==="BUILD_FAILED"||checks.some(c=>c.verdict==="FAIL");
 if(failed){
  console.log("C4 REAL CHROMIUM: independent failure detected on revision "+
   next.revision+"; immutable receipt; repair round "+(repaired+1)+" eligible");
  repaired++;
  if(repaired>=4)break;
  continue;
 }
 if(receipt.status!=="BUILD_BROWSER_SMOKE"||
  checks.length!==plan.criteria.length||
  !checks.every((c,i)=>c.criterion_id===plan.criteria[i].id&&
   c.verdict==="PASS"&&/^sha256:[a-f0-9]{64}$/u.test(c.evidence_hash)))
  throw Error("C4_FREE_QA_NOT_ALL_PASS_NO_RELEASE");
 for(let tries=0;tries<40;tries++){
  if(next.free_ci?.preview_ready===true)break;
  await sleep(4500);
  next=await signed(base,{anonymous_id:owner});
 }
 if(!next.free_ci?.preview_ready)
  throw Error("C2_C3_PERSISTED_PRIVATE_PREVIEW_MISSING");
 const privateApp=await signed(base+"/free-ci-preview",{
  anonymous_id:owner,expected_project_hash:next.project_hash});
 const reopen=await signed(base+"/free-ci-preview",{
  anonymous_id:owner,expected_project_hash:next.project_hash});
 if(typeof privateApp.javascript!=="string"||privateApp.javascript.length<100||
  privateApp.javascript!==reopen.javascript||
  privateApp.css!==reopen.css||
  privateApp.index_html!==reopen.index_html)
  throw Error("C2_APP_REOPEN_IMMUTABILITY_FAILED");
 sawPass=true;
 console.log("C2+C3+C4 ACTUAL: GPT-6 source → owner-signed Job → "+
  "free Docker build → Chromium frozen criteria ALL PASS → immutable private re-open");
 break;
}
if(!sawQa)throw Error("C4_CHROMIUM_ORIGINAL_QA_NEVER_RAN");
if(!sawPass)throw Error("C4_C5_REAL_REPAIR_DID_NOT_REACH_PASS");
if(repaired===0)console.log("C4 INITIAL GPT-6 APP PASS; paid repair and C5 strategy NOT EXERCISED");
if(repaired>0)console.log("C4 REAL GPT-6 FAILED APP → paid repair → new free Chromium PASS");
if(repaired>=3)console.log("C5 real repeated failed snapshots existed; strategy must be corroborated from saved model prompt before claiming root-cause switch");
console.log("SP35 FIVE CORE E2E SAMPLE FINISHED; this is ONE original prompt, "+
 "NOT universal all-app C1/C2/C3/C4/C5 completion");
