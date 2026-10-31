/** Single GPT-6 model phase on existing free GitHub-hosted runner.
 * NEVER log decrypted source/prompt, model reply, token or owner identifiers.
 * Re-running a workflow cannot claim the already claimed original request.
 * No external untrusted app code executes in this process.
 */
import fs from "node:fs/promises";
import {trustedFreeCiOidcRequestUrl}
 from "../../dist/src/edge/free-ci-oidc-request-url.js";
const origin="https://appf2-sp35-417-staging.juiyuang69.workers.dev";
const audience="appf2-sp35-gpt6-model-runner-v1";
const prefix="ai_runner_v1_";
const eventPath=process.env.GITHUB_EVENT_PATH??"";
if(!/^\/home\/runner\/work\/_temp\/_github_workflow\/event\.json$/u.test(eventPath))
 throw Error("AI_RUNNER_EVENT_PATH_UNTRUSTED");
const eventRaw=await fs.readFile(eventPath,"utf8");
if(eventRaw.length>16000)throw Error("AI_RUNNER_EVENT_TOO_LARGE");
const event=JSON.parse(eventRaw);
if(process.env.GITHUB_REPOSITORY!=="NFF98/appf2-build"||
 process.env.GITHUB_EVENT_NAME!=="workflow_dispatch"||
 process.env.GITHUB_REF!==
 "refs/heads/product/sprint-3.5-complex-intent-recovery-20261026"||
 event?.ref!==process.env.GITHUB_REF||
 typeof event?.inputs?.ticket!=="string"||
 !event.inputs.ticket.startsWith(prefix))
 throw Error("AI_RUNNER_TRUST_BOUNDARY");
const ticket=event.inputs.ticket.slice(prefix.length);
if(!/^[A-Za-z0-9_-]{80,3000}$/u.test(ticket))
 throw Error("AI_RUNNER_ENCRYPTED_TICKET_INVALID");
const apiKey=process.env.APPF2_RUNNER_AI_KEY??"";
if(apiKey.length<20)throw Error("AI_RUNNER_SECRET_MISSING_NO_POST");
async function oidc(){
 const endpoint=trustedFreeCiOidcRequestUrl(
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL??"");
 const grant=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN??"";
 if(!endpoint||grant.length<20)throw Error("AI_RUNNER_OIDC_NOT_AVAILABLE");
 endpoint.searchParams.set("audience",audience);
 const r=await fetch(endpoint,{headers:{"Authorization":"Bearer "+grant},
  signal:globalThis.AbortSignal.timeout(15000)});
 const data=await r.json().catch(()=>null);
 if(r.status!==200||typeof data?.value!=="string")
  throw Error("AI_RUNNER_OIDC_ISSUE_FAILED");
 return data.value;
}
async function worker(path,body,limit=25000){
 const r=await fetch(origin+path,{method:"POST",redirect:"error",
  headers:{"Authorization":"Bearer "+await oidc(),
   "Content-Type":"application/json"},
  body:JSON.stringify({...body,ticket}),signal:globalThis.AbortSignal.timeout(limit)});
 const data=await r.json().catch(()=>null);
 if(r.status!==200||!data?.data)
  throw Error("AI_RUNNER_PRIVATE_ACK_FAILED_HTTP_"+r.status);
 return data.data;
}
const source=await worker("/api/v1/internal/free-ai-runner/source",{});
const request=source?.request;
if(source?.model!=="gpt-6.1-sol"||
 !/^sp35_free_ai_(?:qa|code|repair)_v1$/u.test(source.call_key??"")||
 !request||request.model!=="gpt-6.1-sol"||
 request.background!==true||request.store!==true||
 typeof request.input!=="string"||request.input.length>45000)
 throw Error("AI_RUNNER_PRIVATE_REQUEST_INVALID_NO_POST");
// Pre-POST conservative GPT-6.1 Sol Standard-price ceiling (2026-11):
// input $2/1M, output $10/1M tokens. A UTF-8 byte is an upper bound
// on input token count; max_output_tokens bounds reasoning + visible output.
// This estimate is NOT a provider invoice or a blanket billing guarantee.
const caps={sp35_free_ai_qa_v1:8,sp35_free_ai_code_v1:20,
 sp35_free_ai_repair_v1:16};
const cap=caps[source.call_key];
const maxOutput=request.max_output_tokens;
if(!Number.isSafeInteger(maxOutput)||maxOutput<1||maxOutput>12000||
 !Number.isSafeInteger(cap))
 throw Error("AI_RUNNER_UNBOUNDED_MODEL_REQUEST_NO_POST");
const upperCents=Math.ceil((Buffer.byteLength(request.input,"utf8")*2+
 maxOutput*10)*100/1_000_000);
if(upperCents>cap)
 throw Error("AI_RUNNER_PRICE_CEILING_EXCEEDS_SIGNED_RESERVATION_NO_POST");
console.log("SP35 PAID AI RUNNER: owner/OIDC/immutable phase claim PASS; one model POST permitted");
// Exactly one HTTPS model POST. Never retry, even on timeout/5xx or re-run.
let first;
try{
 const r=await fetch("https://api.openai.com/v1/responses",{
  method:"POST",headers:{"Authorization":"Bearer "+apiKey,
   "Content-Type":"application/json"},
  body:JSON.stringify(request),redirect:"error",
  signal:globalThis.AbortSignal.timeout(28000)});
 if(r.status!==200)throw Error("AI_RUNNER_PROVIDER_HTTP_"+r.status);
 first=await r.json().catch(()=>null);
}catch(e){
 console.log("SP35 PAID AI RUNNER: outcome uncertain; NO SECOND POST");
 throw e instanceof Error?Error(e.message):Error("AI_RUNNER_NETWORK_UNKNOWN");
}
const id=first?.id;
if(typeof id!=="string"||!/^resp_[A-Za-z0-9_-]{6,160}$/u.test(id))
 throw Error("AI_RUNNER_PROVIDER_ID_UNAVAILABLE_NO_REPEAT");
const accepted=await worker("/api/v1/internal/free-ai-runner/result",{
 kind:"ACK",response_id:id,response:null});
if(accepted.status!=="ACK_SAVED")
 throw Error("AI_RUNNER_RESPONSE_ID_NOT_DURABLE");
console.log("SP35 PAID AI RUNNER: provider response ID saved to original Job; GET-only continuation");
let response=first;
for(let attempt=0;attempt<85;attempt++){
 if(response?.id!==id)throw Error("AI_RUNNER_MODEL_ID_CHANGED");
 if(response.status==="completed")break;
 if(response.status!=="queued"&&response.status!=="in_progress")
  throw Error("AI_RUNNER_MODEL_NOT_COMPLETED_NO_REPEAT");
 await new Promise(resolve=>setTimeout(resolve,6500));
 const r=await fetch("https://api.openai.com/v1/responses/"+
  encodeURIComponent(id),{method:"GET",redirect:"error",
  headers:{"Authorization":"Bearer "+apiKey},
  signal:globalThis.AbortSignal.timeout(18000)});
 if(r.status!==200)throw Error("AI_RUNNER_PROVIDER_GET_HTTP_"+r.status);
 response=await r.json().catch(()=>null);
}
if(response?.status!=="completed"||
 !Number.isSafeInteger(response.usage?.input_tokens)||
 !Number.isSafeInteger(response.usage?.output_tokens))
 throw Error("AI_RUNNER_MODEL_UNFINISHED_NO_REPEAT");
const finished=await worker("/api/v1/internal/free-ai-runner/result",{
 kind:"FINISHED",response_id:id,response},40000);
if(finished.status!=="RESULT_SAVED")
 throw Error("AI_RUNNER_RESULT_NOT_DURABLE");
console.log("SP35 PAID AI RUNNER: GPT-6.1 Sol response completed and journaled in SAME owner Job; no publish");
