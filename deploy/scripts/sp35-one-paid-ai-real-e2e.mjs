/** One expressly authorized, bounded real paid AI model E2E on FREE Staging.
 * The real AI output is saved in an owner-P256 original Job; the EXISTING
 * Worker dispatches it to GitHub OIDC / locked Docker / real browser QA.
 * No Cloudflare Containers, no paid Browser Run, NO public publication.
 * This is a test-run provenance, not proof the customer UI paid Agent is wired.
 * One model request at most. Never print the secret, model text or ticket.
 */
import {randomUUID,webcrypto} from "node:crypto";
const origin=process.env.APPF2_STAGING_URL??"";
if(!/^https:\/\/appf2-sp35-[a-z0-9-]*staging\.[a-z0-9-]+\.workers\.dev$/iu.test(origin))
 throw Error("FREE_LIVE_DISPATCH_REFUSE_NON_STAGING");
const crypto=webcrypto,owner=randomUUID(),prompt="請製作一個可操作的計分 App，初始顯示「分數：0」，並有名為「加一」的按鈕。按下「加一」後必須顯示「分數：1」，能繼續累計分數。";
const key=(process.env.APPF2_PAID_AI_E2E_KEY??"").trim();
if(!/^sk-[A-Za-z0-9_-]{16,}$/u.test(key))
 throw Error("SP35_REAL_AI_KEY_MISSING_IN_GITHUB_ACTIONS_SECRET");
const MAX_OUTPUT_TOKENS=3200;
async function callRealOpenAi(){
 const system=[
  "You are an application coding agent. Return ONLY a valid JSON object, no markdown.",
  "Return JSON with two string fields: main_ts (complete src/main.ts), style_css (complete src/style.css)." ,
  "Implement ORIGINAL_USER_REQUEST in a production-quality usable DOM app, not a placeholder.",
  "Use only native browser APIs and existing Vite; no external dependencies/assets/network.",
  "The preexisting index.html has a #app element and imports src/main.ts.",
  "Implement an exact accessible button with visible text 加一 and visible score 分數：0 initially.",
  "On one real click of 加一, update visible page text to 分數：1. Further clicks increment.",
  "Keep JavaScript/TypeScript valid, no inline source map or remote import.",
  "Do NOT read environment secrets or execute arbitrary shell commands.",
  "ORIGINAL_USER_REQUEST_JSON: "+JSON.stringify(prompt)
 ].join("\n");
 const response=await fetch("https://api.openai.com/v1/responses",{
  method:"POST",headers:{"Authorization":"Bearer "+key,
   "Content-Type":"application/json"},
  body:JSON.stringify({model:"gpt-4.1-mini",input:system,
   max_output_tokens:MAX_OUTPUT_TOKENS,store:false,
   text:{format:{type:"json_schema",name:"appf2_vite_generated_files",
    strict:true,schema:{type:"object",additionalProperties:false,
     required:["main_ts","style_css"],properties:{
      main_ts:{type:"string"},style_css:{type:"string"}}}}}}),
  signal:globalThis.AbortSignal.timeout(90000),redirect:"error"});
 const obj=await response.json().catch(()=>null);
 if(response.status!==200||obj?.status!=="completed")
  throw Error("SP35_REAL_AI_PROVIDER_FAILED_HTTP_"+response.status+
   "_STATUS_"+String(obj?.status??"NO_JSON").slice(0,30));
 const output=(obj.output??[]).filter(x=>x.type==="message")
  .flatMap(x=>x.content??[]).filter(x=>x.type==="output_text")
  .map(x=>x.text).join("");
 let payload;
 try{payload=JSON.parse(output);}catch{throw Error("SP35_REAL_AI_OUTPUT_NOT_JSON");}
 if(!payload||Object.keys(payload).sort().join(",")!=="main_ts,style_css"||
  typeof payload.main_ts!=="string"||typeof payload.style_css!=="string")
  throw Error("SP35_REAL_AI_OUTPUT_SCHEMA_REJECTED");
 const files=[{path:"src/main.ts",content:payload.main_ts},
  {path:"src/style.css",content:payload.style_css}];
 const paths=new Set(files.map(x=>x?.path));
 if(paths.size!==2||!paths.has("src/main.ts")||!paths.has("src/style.css")||
  files.some(x=>Object.keys(x).sort().join(",")!=="content,path"||
  typeof x.content!=="string"||x.content.length<80||x.content.length>20000||
  /https?:\/\/|from\s+['"]https?:|import\s*\(['"]https?:/u.test(x.content)))
  throw Error("SP35_REAL_AI_OUTPUT_UNSAFE_OR_INCOMPLETE");
 console.log("SP35 REAL PAID AI: OpenAI Responses status=completed, model=gpt-4.1-mini, output_tokens="+
  Number(obj.usage?.output_tokens??0)+", no output or key logged, one call only");
 return files;
}
const keys=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},
 false,["sign","verify"]);
const spki=Buffer.from(await crypto.subtle.exportKey("spki",keys.publicKey))
 .toString("base64url");
const sha=async raw=>Buffer.from(await crypto.subtle.digest("SHA-256",raw)).toString("base64url");
async function signed(path,body,expected){
 const bytes=new globalThis.TextEncoder().encode(JSON.stringify(body));
 const nonce="sp35FreeReal_"+randomUUID().replaceAll("-","");
 const now=Date.now();
 const signature=Buffer.from(await crypto.subtle.sign(
  {name:"ECDSA",hash:"SHA-256"},keys.privateKey,
  new globalThis.TextEncoder().encode(JSON.stringify([
   "APPF2_MUTATION_PoP_V1","POST",path,await sha(bytes),nonce,now]))))
  .toString("base64url");
 const response=await fetch(origin+path,{
  method:"POST",redirect:"error",headers:{
   "Content-Type":"application/json","Origin":origin,
   "Sec-Fetch-Site":"same-origin","Idempotency-Key":nonce,
   "X-Appf2-PoP-Key":spki,"X-Appf2-PoP-Signature":signature,
   "X-Appf2-PoP-Timestamp":String(now)},
  body:bytes,signal:globalThis.AbortSignal.timeout(path.endsWith("/import-files")?110000:45000)});
 const reply=await response.json().catch(()=>null);
 if(response.status!==expected||!reply?.data)
  throw Error("FREE_LIVE_DISPATCH_UNEXPECTED_HTTP_"+response.status+"_PATH_"+path+
   (Number.isSafeInteger(reply?.github_http_status)?
     "_GITHUB_HTTP_"+reply.github_http_status:"")+
   (reply?.error==="AGENT_JOB_UNAVAILABLE"?"_WORKER_INTERNAL":""));
 return reply.data;
}
const initial=await signed("/api/v1/agent-jobs",{anonymous_id:owner,prompt},201);
if(initial.revision!==0||initial.ai_started!==false||initial.app_published!==false)
 throw Error("FREE_LIVE_DISPATCH_INIT_NOT_NO_AI");
const job=initial.job_id,base="/api/v1/agent-jobs/"+job;
const plan={version:"1",criteria:[{
 id:"increment_button",source_quote:"加一",description:"真實點擊加一後分數從 0 變成 1",
 steps:[{action:"click",role:"button",name:"加一"}],
 assertions:[{kind:"text_appears",text:"分數：1"}],automatable:true}]};
const frozen=await signed(base+"/qa-plan",{anonymous_id:owner,
 expected_revision:0,original_prompt:prompt,original_plan:plan},200);
if(frozen.status!=="QA_ORIGINAL_PLAN_FROZEN")
 throw Error("FREE_LIVE_DISPATCH_NOT_PRE_CODE_FROZEN");
const generatedFiles=await callRealOpenAi();
const imported=await signed(base+"/import-files",{anonymous_id:owner,
 expected_revision:0,expected_project_hash:initial.project_hash,
 files:generatedFiles},200);
if(imported.status!=="IMPORTED_NO_AI"||imported.revision!==2||
 imported.project_hash===initial.project_hash||imported.app_published!==false)
 throw Error("FREE_LIVE_DISPATCH_IMPORT_NOT_PERSISTED");
const persisted=await signed(base,{anonymous_id:owner},200);
if(persisted.project_hash!==imported.project_hash||
 persisted.checkpoint?.cost_cents!==0||persisted.checkpoint?.step!==0||
 persisted.ai_started!==false||persisted.free_ci!==null)
 throw Error("FREE_LIVE_DISPATCH_IMPORTED_JOB_NOT_REAL");
console.log("SP35_REAL_AI_GENERATED_JOB: owner P-256, 2 AI-generated files, frozen QA, real PostgreSQL, revision2; model billed externally in this GitHub test only");
const queued=await signed(base+"/free-ci-dispatch",{anonymous_id:owner,
 explicit_free_ci_consent:true},202);
if(queued.status!=="FREE_CI_QUEUED"||queued.app_published!==false)
 throw Error("FREE_LIVE_DISPATCH_NOT_ACCEPTED");
console.log("SP35_REAL_AI_TO_FREE_DOCKER: Worker→GitHub Actions HTTP204; separate one-call paid AI done, no paid Containers");
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
  last.qa_checks[0]?.criterion_id!=="increment_button"||
  last.qa_checks[0]?.verdict!=="PASS"||
  !/^sha256:[a-f0-9]{64}$/u.test(last.qa_checks[0].evidence_hash))
  throw Error("FREE_LIVE_DISPATCH_RECEIPT_NOT_VERIFIED");
 // An immutable smoke/QA receipt can arrive BEFORE the separate artifact
 // upload; do not mislabel the App as reopenable until PostgreSQL confirms.
 if(current.free_ci.preview_ready!==true)continue;
 const reopened=await signed(base+"/free-ci-preview",{
  anonymous_id:owner,expected_project_hash:imported.project_hash},200);
 if(reopened.project_hash!==imported.project_hash||
  reopened.app_published!==false||
  typeof reopened.index_html!=="string"||
  !reopened.index_html.includes("assets/")||
  typeof reopened.javascript!=="string"||
  reopened.javascript.length<100||
  typeof reopened.css!=="string")
  throw Error("FREE_LIVE_PRIVATE_SAVED_APP_REOPEN_NOT_VERIFIED");
 const another=await signed(base+"/free-ci-preview",{
  anonymous_id:owner,expected_project_hash:imported.project_hash},200);
 if(another.javascript!==reopened.javascript||
  another.index_html!==reopened.index_html||
  another.css!==reopened.css)
  throw Error("FREE_LIVE_PRIVATE_SAVED_APP_REOPEN_NOT_IMMUTABLE");
 console.log("SP35 REAL FREE APP PRIVATE SAVED→OWNER-P256 REOPEN SAME BYTES, NO AI PASS");
 console.log("SP35 REAL FREE JOB→GITHUB OIDC→DOCKER→CHROMIUM QA→ORIGINAL POSTGRES JOB PASS");
 console.log("SP35 FREE REAL GITHUB RUN: "+last.run_id);
 console.log("SP35 TRUE PAID AI→REAL P256 JOB→FREE DOCKER→CHROMIUM QA→PG PRIVATE REOPEN: PASS; still NOT public Blueprint or fully automated customer Agent");
 process.exit(0);
}
throw Error("FREE_LIVE_DISPATCH_RECEIPT_TIMEOUT_NO_PASS_"+String(last?.status??"MISSING"));
