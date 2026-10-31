/**
 * REAL staging-only Agent product proof: P-256 signed first-party POST to the
 * deployed APPf2 Worker, immutable source persisted in real PostgreSQL, then
 * a separately signed read. No model, container, QA, publication or charges.
 * Must never run against production. This is NOT the complete five-core E2E.
 */
import {randomUUID,webcrypto} from "node:crypto";
const crypto=webcrypto;
const raw=process.env.APPF2_STAGING_URL;
if(!raw)throw Error("SP35_AGENT_LIVE_DB: STAGING_URL_REQUIRED");
const base=new URL(raw);
if(base.protocol!=="https:"||base.username||base.password||
 base.search||base.hash||base.pathname!=="/"||
 !/^appf2-sp35-[a-z0-9-]*staging\./u.test(base.hostname)||
 !base.hostname.endsWith(".workers.dev"))
 throw Error("SP35_AGENT_LIVE_DB: REFUSE_NON_STAGING_HOST");
if(process.env.APPF2_STAGING_BOOTSTRAP_ONLY==="1"){
 console.log("AGENT DB LIVE: BOOTSTRAP_ONLY (no PostgreSQL; not a PASS)");
 process.exit(0);
}
const b64=bytes=>Buffer.from(bytes).toString("base64url");
const owner=randomUUID();
const keys=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},
 false,["sign","verify"]);
const spki=b64(await crypto.subtle.exportKey("spki",keys.publicKey));
const stamp=async(path,body)=>{
 const idempotency="sp35AgentSmoke_"+randomUUID().replaceAll("-","");
 const encoded=new globalThis.TextEncoder().encode(JSON.stringify(body));
 const digest=b64(await crypto.subtle.digest("SHA-256",encoded));
 const timestamp=Date.now();
 const transcript=new globalThis.TextEncoder().encode(JSON.stringify([
  "APPF2_MUTATION_PoP_V1","POST",path,digest,idempotency,timestamp
 ]));
 const signature=b64(await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},
  keys.privateKey,transcript));
 const response=await fetch(new URL(path,base),{
  method:"POST",redirect:"error",headers:{
   "Content-Type":"application/json","Origin":base.origin,
   "Sec-Fetch-Site":"same-origin","Idempotency-Key":idempotency,
   "X-Appf2-PoP-Key":spki,"X-Appf2-PoP-Signature":signature,
   "X-Appf2-PoP-Timestamp":String(timestamp)
  },body:encoded,signal:globalThis.AbortSignal.timeout(18000)});
 let data;
 try{data=await response.json()}catch{
  throw Error("SP35_AGENT_LIVE_DB: EXPECTED_WORKER_JSON_HTTP_"+response.status);}
 return {status:response.status,data};
};
const prompt="建立一個可計分、有重設按鈕的互動骰子遊戲";
const created=await stamp("/api/v1/agent-jobs",{anonymous_id:owner,prompt});
if(created.status!==201||typeof created.data?.data?.job_id!=="string"||
 created.data?.data?.app_published!==false||
 created.data?.data?.ai_started!==false)
 throw Error("SP35_AGENT_LIVE_DB: SIGNED_CREATE_FAILED_HTTP_"+created.status+
  " CODE_"+String(created.data?.error??"UNKNOWN").slice(0,80));
const jobId=created.data.data.job_id;
const saved=await stamp("/api/v1/agent-jobs/"+jobId,{anonymous_id:owner});
const job=saved.data?.data;
if(saved.status!==200||job?.job_id!==jobId||job.status!=="CREATED"||
 job.revision!==0||job.project_hash!==created.data.data.project_hash||
 !Array.isArray(job.files)||job.files.length!==4||
 !job.files.some(f=>f.path==="src/main.ts"&&f.content.includes("候選專案"))||
 !job.files.some(f=>f.path==="index.html"&&f.content.includes("src/main.ts"))||
 job.ai_started!==false||job.app_published!==false||
 job.free_ci!==null)
 throw Error("SP35_AGENT_LIVE_DB: SIGNED_POSTGRES_REOPEN_FAILED_HTTP_"+saved.status);
// The provider/model GET ran earlier on GitHub, but GPT-6 POST from the
// Cloudflare Worker failed before returning an ID. Verify the exact same
// Worker egress path using a no-charge GET and creator-signed Job first.
const probe=await stamp("/api/v1/agent-jobs/"+jobId+"/free-ai-probe",
 {anonymous_id:owner});
const classification=probe.data?.data?.status;
if(probe.status!==200||typeof classification!=="string")
 throw Error("SP35_GPT6_WORKER_EGRESS_PROBE_HTTP_"+probe.status);
console.log("SP35 GPT6 WORKER EGRESS: "+classification+
 " (signed original creator, fixed GET model info, NO Responses POST)");
if(classification!=="WORKER_MODEL_GET_200")
 throw Error("SP35_GPT6_WORKER_EGRESS_BLOCKED_"+classification);
console.log("SP35_PRODUCT_REAL_DB_PASS: signed CREATE HTTP201, "+
 "saved four-file source, signed REOPEN HTTP200, same hash, no AI or Sandbox. "+
 "Full five-core cloud E2E still NOT RUN.");
