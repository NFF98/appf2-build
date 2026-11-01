/* global TextEncoder, AbortSignal -- available in GitHub Actions Node.js 22 runtime */
/** 
 * Staging-only, zero-AI, zero-publication ingress proof for the G3/G4
 * HTTP 413 root-cause fix. Invalid PoP MUST remain 404 for an otherwise
 * legitimate Chinese publication payload, and oversized payloads remain 413.
 * No API keys, paid Job requests, DB modifications, new creators or cards.
 */
const base="https://appf2-sp35-417-staging.juiyuang69.workers.dev";
const job="7045a009-6bfc-4889-8f1b-df03ba93c406";
const publish="/api/v1/agent-jobs/"+job+"/publish-code-app";
const create="/api/v1/agent-jobs";
const other="/api/v1/agent-jobs/"+job+"/free-ai-stage";
const encoder=new TextEncoder();
const longChinese=JSON.stringify({
 anonymous_id:job,expected_project_hash:"sha256:"+"a".repeat(64),
 original_prompt:"請做完整可操作的多檔中文互動應用。".repeat(36),
 title:"雙人拿石頭",explicit_public_share_consent:true
});
if(encoder.encode(longChinese).length<=1400||
   encoder.encode(longChinese).length>4096)
 throw Error("SP35_STAGING_PUBLISH_TEST_DATA_INVALID");
const longCreate=JSON.stringify({anonymous_id:job,
 prompt:"請做完整可操作的多檔中文互動應用。".repeat(36),
 explicit_ai_consent:true,max_cost_cents:44});
const tooLarge=JSON.stringify({original_prompt:"中文".repeat(760)});
const generalTooLarge=JSON.stringify({text:"中文".repeat(265)});
async function probe(path,raw){
 const reply=await fetch(base+path,{method:"POST",headers:{
  "Content-Type":"application/json","Origin":base,
  "Idempotency-Key":"sp35-free-413-negative-probe",
  "Sec-Fetch-Site":"same-origin"
 },body:raw,signal:AbortSignal.timeout(20000)});
 const payload=await reply.json().catch(()=>({}));
 // NEVER log server bytes, signed app source, prompt, cookie or credentials.
 return {http:reply.status,error:typeof payload?.error==="string"?
  payload.error:"NON_STRING_CODE"};
}
const ready=await fetch(base+"/api/v1/agent-readiness",
 {signal:AbortSignal.timeout(20000)});
if(ready.status!==200)throw Error("SP35_STAGING_AGENT_READINESS_FAIL");
const createProbe=await probe(create,longCreate);
if(process.argv.includes("--before-deploy")){
 console.log("SP35 BEFORE DEPLOY INVALID-POP CREATE: "+JSON.stringify(createProbe)+
  " raw_bytes="+encoder.encode(longCreate).length+"; 0 Jobs; 0 model");
 if(![404,413].includes(createProbe.http))
  throw Error("SP35_CREATE_BASELINE_UNEXPECTED");
 process.exit(0);
}
if(createProbe.http!==404||createProbe.error!=="AGENT_JOB_NOT_FOUND")
 throw Error("SP35_CREATE_UTF8_SIZE_GATE_NOT_FIXED "+JSON.stringify(createProbe));
const createTooLarge=await probe(create,tooLarge);
if(createTooLarge.http!==413)throw Error("SP35_CREATE_4097_PLUS_NOT_REJECTED");
const acceptedThenDenied=await probe(publish,longChinese);
if(acceptedThenDenied.http!==404||
   acceptedThenDenied.error!=="AGENT_JOB_NOT_FOUND")
 throw Error("SP35_PUBLISH_UTF8_SIZE_GATE_NOT_FIXED "+
  JSON.stringify(acceptedThenDenied));
const blocked=await probe(publish,tooLarge);
if(blocked.http!==413||blocked.error!=="AGENT_JOB_TOO_LARGE")
 throw Error("SP35_PUBLISH_4097_PLUS_NOT_REJECTED "+JSON.stringify(blocked));
const otherBlocked=await probe(other,generalTooLarge);
if(otherBlocked.http!==413||otherBlocked.error!=="AGENT_JOB_TOO_LARGE")
 throw Error("SP35_OTHER_AGENT_1400_GUARD_WIDENED "+
  JSON.stringify(otherBlocked));
console.log("SP35 STAGING PUBLISH 413 ROOT CAUSE FIX VERIFIED: "+
 "CREATE and PUBLISH UTF8 >1400 and <=4096 -> invalid PoP 404 (NOT 413); >4096 -> 413; "+
 "other Agent >1400 -> 413; 0 paid AI; 0 created Jobs; 0 published cards.");
