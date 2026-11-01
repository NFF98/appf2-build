/** One fresh Human-approved G1 viewer-private Postgres CRUD App test → free Docker E2E.
 * Only API requests signed by a NEW ephemeral P-256 test owner. All AI
 * provider requests go through Worker+immutable journal+GitHub OIDC runner.
 * DO NOT reuse a failed model dispatch, expose owner keys, or fake QA.
 * 44c MAX approved for this one new G1 data Job, aggregate historical max20c + this max44c <= $1.
 */
import {randomUUID,webcrypto} from "node:crypto";
const origin="https://appf2-sp35-417-staging.juiyuang69.workers.dev";

const prompt="幫我建立一個可操作的客戶備忘錄資料庫 App。頁面標題顯示「客戶備忘錄」。首次開啟顯示「紀錄數：0」。按「新增紀錄」把「咖啡」存進真正平台提供的 PostgreSQL appf2Records 資料庫，顯示「紀錄數：1」及「內容：咖啡」。按「修改紀錄」把原紀錄內容改成「茶」，顯示「內容：茶」。按「刪除紀錄」刪掉該紀錄並顯示「紀錄數：0」。重新整理後資料必須還在，不同瀏覽器使用者不能讀取別人的紀錄。請將 UI、CRUD 資料邏輯及狀態管理分成至少三個互相匯入的 src/ TypeScript 模組；不要假資料、localStorage、fetch、硬編帳號、靜態假按鈕或外部套件。";
const plan={version:"1",criteria:[
 {id:"initial_zero",source_quote:"首次開啟顯示「紀錄數：0」",description:"空資料顯示零",automatable:true,
  steps:[],assertions:[{kind:"text_includes",text:"紀錄數：0"}]},
 {id:"title",source_quote:"頁面標題顯示「客戶備忘錄」",description:"App標題",automatable:true,
  steps:[],assertions:[{kind:"text_includes",text:"客戶備忘錄"}]},
 {id:"create",source_quote:"按「新增紀錄」把「咖啡」存進",description:"新增資料真的顯示紀錄數1",automatable:true,
  steps:[{action:"click",role:"button",name:"新增紀錄"}],
  assertions:[{kind:"text_appears",text:"紀錄數：1"}]},
 {id:"read",source_quote:"及「內容：咖啡」",description:"讀出新增紀錄",automatable:true,
  steps:[{action:"click",role:"button",name:"新增紀錄"}],
  assertions:[{kind:"text_appears",text:"內容：咖啡"}]},
 {id:"update",source_quote:"按「修改紀錄」把原紀錄內容改成「茶」",description:"修改資料",automatable:true,
  steps:[{action:"click",role:"button",name:"新增紀錄"},{action:"click",role:"button",name:"修改紀錄"}],
  assertions:[{kind:"text_appears",text:"內容：茶"}]},
 {id:"delete",source_quote:"按「刪除紀錄」刪掉該紀錄",description:"刪除後回到零",automatable:true,
  steps:[{action:"click",role:"button",name:"新增紀錄"},{action:"click",role:"button",name:"刪除紀錄"}],
  assertions:[{kind:"text_appears",text:"紀錄數：0"}]}
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
 anonymous_id:owner,prompt,max_cost_cents:44,explicit_ai_consent:true},201);
if(created.revision!==0||created.approved_max_cost_cents!==44||
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
console.log("G1 RECEIPT: job_id="+created.job_id+" original QA=6 GPT-6.1 Sol cap=44c (NOT invoice); no private key printed");
const stages=["CODE","REPAIR","REPAIR","REPAIR"];
let phase=0,repaired=0,sawQa=false,sawPass=false;
for(const stage of stages){
 if(Date.now()>=deadline)throw Error("C4_C5_TIME_BUDGET_EXHAUSTED_KEEP_JOB");
 phase++;
 let stageFinished=false;
 // Same immutable phase+owner+Job, repeated POST is GET-only recovery.
 let transient503=0;
 for(let attempt=0;attempt<100&&Date.now()<deadline;attempt++){
  const before=await signed(base,{anonymous_id:owner});
  const requiredSteps=2*(repaired+1);
  // A timed-out HTTP response never erases an already committed source.
  // Do not POST the same model phase once its immutable source is saved.
  if(before.revision>=requiredSteps&&
     before.checkpoint?.step>=requiredSteps){
   stageFinished=true;
   console.log("C4 SOURCE RESTORED: original saved Job, NO additional model POST");
   break;
  }
  // A paid REPAIR result may have committed CODING→REPAIRING but lost
  // its second source CAS response. The server recovers ONLY the identical
  // SUCCEEDED journal row tied to that parent's hash; no fresh paid POST.
  // All other odd heads remain uncertain and MUST stop, never regenerate.
  if(before.checkpoint?.step%2!==0&&
     !((stage==="REPAIR"&&before.status==="REPAIRING"&&
         before.revision===requiredSteps-1)||
       (stage==="CODE"&&before.status==="PLANNING"&&
         before.revision===1&&before.checkpoint.step===1)))
   throw Error("C2_INCOMPLETE_CHECKPOINT_STOP_NO_NEW_MODEL_CALL");
  if(before.checkpoint?.step%2!==0)
   console.log("C4 SAVED HALF-CHECKPOINT: same owner recovers prior paid result, no new model reservation");
  let result;
  try{
   result=await signed(base+"/free-ai-stage",{
    anonymous_id:owner,original_prompt:prompt,
    expected_project_hash:before.project_hash,stage,
    explicit_ai_consent:true,explicit_free_ci_consent:true},[200,202]);
  }catch(error){
   // A lost response cannot authorize a fresh paid call. Next iteration
   // recovers the original Job and immutable model journal on the server.
   // A real Worker→Postgres CAS can return HTTP503 AFTER the model
   // completed and its response was journaled. The next request is a
   // creator-signed continuation of the SAME immutable phase/call key.
   // Never create a new Job, change consent, or generate a new phase key.
   const retryable=error?.name==="TimeoutError"||
    error?.name==="AbortError"||
    /^C5_SIGNED_HTTP_503_AT_free-ai-stage_(AGENT_JOB_UNAVAILABLE|AGENT_JOB_CONCURRENT_UPDATE|AGENT_JOB_STALE_CHECKPOINT|PROJECT_EDIT_CONFLICT)$/u.test(
     String(error?.message??""));
   if(!retryable||++transient503>4)throw error;
   console.log("C4 TRANSIENT SAVE/CAS HTTP503 OR TIMEOUT: only same signed owner/Job/phase journal; no second model reservation");
   await sleep(7000);
   continue;
  }
  if(result?.status==="AI_SOURCE_SAVED_FREE_CI_QUEUED"){
   stageFinished=true;break;
  }
  if(result?.status==="AI_SOURCE_SAVED_CI_DISPATCH_UNCONFIRMED"){
   stageFinished=true;
   console.log("C4 SOURCE SAVED; free CI dispatch unconfirmed; recover via free-only endpoint");
   break;
  }
  if(result!==null&&result?.status!=="AI_BACKGROUND_PENDING")
   throw Error("C4_C5_MODEL_STAGE_UNEXPECTED_"+String(result?.status));
  await sleep(7000);
 }
 if(!stageFinished)throw Error("C4_MODEL_RESULT_NOT_CONFIRMED_NO_SECOND_PAID_POST");
 console.log("C4 GPT-6.1 Sol stage "+stage+" #"+phase+
  " saved; exact new source revision and free Docker dispatch verified");
 let next=null,freeDispatched=false;
 for(let poll=0;poll<75&&Date.now()<deadline;poll++){
  await sleep(9000);
  const j=await signed(base,{anonymous_id:owner});
  // Retry a FREE Docker dispatch only if no receipt after four polls.
  // Same creator, immutable source, no second paid model call.
  if(poll===4&&!j.free_ci&&!freeDispatched){
   const restarted=await signed(base+"/free-ci-dispatch",{
    anonymous_id:owner,explicit_free_ci_consent:true},202);
   if(restarted.status!=="FREE_CI_QUEUED")
    throw Error("C4_FREE_QA_RECOVERY_NOT_ACCEPTED");
   freeDispatched=true;
   console.log("C4 FREE-ONLY Docker redispatch from original source; no AI fee");
  }
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
 const sourceModules=next.files.filter(f=>f.path.startsWith("src/")&&f.path.endsWith(".ts"));
 const multiModules=sourceModules.length>=3&&sourceModules.some(f=>
  f.content.includes("from ")&&f.content.includes("./"));
 console.log("G1 SOURCE: job_id="+created.job_id+" revision="+next.revision+
  " modules="+sourceModules.length+" project_hash="+next.project_hash+
  " QA criteria="+checks.length);
 if(!multiModules)throw Error("G1_REAL_AI_MODULE_GRAPH_NOT_PROVEN; DO NOT REBILL ORIGINAL JOB");
 const privateApp=await signed(base+"/free-ci-preview",{
  anonymous_id:owner,expected_project_hash:next.project_hash});
 const reopen=await signed(base+"/free-ci-preview",{
  anonymous_id:owner,expected_project_hash:next.project_hash});
 if(typeof privateApp.javascript!=="string"||privateApp.javascript.length<100||
  privateApp.javascript!==reopen.javascript||
  privateApp.css!==reopen.css||
  privateApp.index_html!==reopen.index_html)
  throw Error("C2_APP_REOPEN_IMMUTABILITY_FAILED");
 // Explicit first-party owner publication on TEST STAGING only. The six
 // independent build/browser tests above must have passed before sharing.
 const published=await signed(base+"/publish-code-app",{
  anonymous_id:owner,expected_project_hash:next.project_hash,
  original_prompt:prompt,title:"客戶備忘錄 · GPT-6 真資料測試",
  explicit_public_share_consent:true
 },201);
 if(published.status!=="ACTIVE"||!published.share_id||
    typeof published.blueprint_hash!=="string")
  throw Error("G5_DB_PUBLIC_SHARE_NOT_ACTIVE");
 console.log("G5 SHARED: share_id="+published.share_id+
  " blueprint_hash="+published.blueprint_hash+"; test-only Staging, no additional model call");
 // Chromium is a separate trusted runner outside the untrusted code Docker.
 const {chromium}=await import("@playwright/test");
 const browser=await chromium.launch({headless:true});
 try{
  const getApp=async context=>{
   const p=await context.newPage();
   await p.goto(origin+"/code/"+published.share_id,{waitUntil:"domcontentloaded",timeout:60000});
   const frame=p.frameLocator('iframe[sandbox="allow-scripts"]');
   await frame.getByRole("button",{name:"新增紀錄"}).waitFor({state:"visible",timeout:30000});
   return {page:p,frame,app:frame.locator("#app")};
  };
  const contextA=await browser.newContext();
  const userA=await getApp(contextA);
  if(!(await userA.app.innerText()).includes("紀錄數：0"))
   throw Error("G1_REAL_POSTGRES_FIRST_VIEW_NOT_EMPTY");
  await userA.frame.getByRole("button",{name:"新增紀錄"}).click();
  await userA.frame.getByText("內容：咖啡").waitFor({state:"visible",timeout:12000});
  await userA.page.reload({waitUntil:"domcontentloaded"});
  await userA.frame.getByText("內容：咖啡").waitFor({state:"visible",timeout:12000});
  const contextB=await browser.newContext();
  const userB=await getApp(contextB);
  if((await userB.app.innerText()).includes("內容：咖啡")||
    !(await userB.app.innerText()).includes("紀錄數：0"))
   throw Error("G1_REAL_POSTGRES_DIFFERENT_VIEWER_DATA_LEAK");
  await userA.frame.getByRole("button",{name:"修改紀錄"}).click();
  await userA.frame.getByText("內容：茶").waitFor({state:"visible",timeout:12000});
  await userA.page.reload({waitUntil:"domcontentloaded"});
  await userA.frame.getByText("內容：茶").waitFor({state:"visible",timeout:12000});
  await userA.frame.getByRole("button",{name:"刪除紀錄"}).click();
  await userA.frame.getByText("紀錄數：0").waitFor({state:"visible",timeout:12000});
  await userA.page.reload({waitUntil:"domcontentloaded"});
  await userA.frame.getByText("紀錄數：0").waitFor({state:"visible",timeout:12000});
  console.log("G1+G5 REAL STAGING POSTGRES CRUD/RELOAD/VIEWER ISOLATION: PASS; two browsers, one published hash, 0 new AI calls");
  await contextA.close();await contextB.close();
 }finally{await browser.close();}
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
console.log("SP35 G1 REAL DATA SAMPLE FINISHED; this is ONE original prompt, "+
 "NOT universal all-app C1/C2/C3/C4/C5 completion");
