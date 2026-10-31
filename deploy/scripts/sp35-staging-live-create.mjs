// REAL staging-only signed F01 CREATE: one bounded production-path request.
// Tests browser PoP wire protocol against deployed Cloudflare Worker + Hyperdrive + OpenAI.
// No POST retries, no mocks, no secret or response bodies logged, no Production targets.
import { randomUUID, webcrypto } from "node:crypto";
import { TextEncoder } from "node:util";

const raw = process.env.APPF2_STAGING_URL?.trim();
if (!raw) throw Error("STAGING REAL CREATE: missing APPF2_STAGING_URL");
const origin = new URL(raw);
if (origin.protocol !== "https:" || origin.username || origin.password ||
    origin.search || origin.hash || origin.pathname !== "/" ||
    !/^appf2-sp35-417-staging\.[a-z0-9-]+\.workers\.dev$/i.test(origin.hostname)) {
  throw Error("STAGING REAL CREATE: refused non-isolated or non-HTTPS target");
}
const { subtle } = webcrypto;
// Retry ONLY safe, read-only GET requests after a transient transport/reset or
// temporary gateway error. Never replay CREATE/COMPILE POSTs or grant assumptions.
async function safeRead(url, options, label, timeoutMs = 25_000) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        method: "GET",
        signal: globalThis.AbortSignal.timeout(timeoutMs)
      });
      if (![502, 503, 504].includes(response.status) || attempt === 3) return response;
      await response.body?.cancel().catch(() => {});
      console.log("STAGING REAL OPEN: " + label + " transient HTTP " + response.status + " retry " + attempt + "/2");
    } catch (error) {
      if (attempt === 3) throw Error("STAGING REAL OPEN: " + label + " GET transport failed after 3 tries (" + String(error?.name || "unknown") + ")", { cause: error });
      console.log("STAGING REAL OPEN: " + label + " transient GET connection failure; retry " + attempt + "/2");
    }
    await new Promise(resolve => setTimeout(resolve, attempt * 400));
  }
  throw Error("STAGING REAL OPEN: unreachable GET retry state");
}
const base64url = bytes => Buffer.from(bytes).toString("base64url");
const sha256 = async bytes => new Uint8Array(await subtle.digest("SHA-256", bytes));
const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
const publicKey = new Uint8Array(await subtle.exportKey("spki", pair.publicKey));
const key = "appf2-create-v1." + base64url(await sha256(publicKey));
const path = "/api/v1/intents";
const body = JSON.stringify({
  anonymous_id: randomUUID(),
  intent_kind: "CREATE",
  raw_intent: "Create a read-only one-screen welcome app titled Hello World. Show the text Hello World. No user input, payments, accounts, or external services.",
  source: { type: "DIRECT_PROMPT", capsule_id: null }
});
const bodyBytes = new TextEncoder().encode(body);
const timestamp = Date.now();
const transcript = new TextEncoder().encode(JSON.stringify([
  "APPF2_MUTATION_PoP_V1", "POST", path, base64url(await sha256(bodyBytes)), key, timestamp
]));
const signature = new Uint8Array(
  await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, transcript)
);
console.log("STAGING REAL CREATE: sending ONE signed CREATE to isolated Cloudflare Worker");
let response;
try {
  response = await fetch(new URL(path, origin), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": origin.origin,
      "Idempotency-Key": key,
      "X-Appf2-PoP-Key": base64url(publicKey),
      "X-Appf2-PoP-Signature": base64url(signature),
      "X-Appf2-PoP-Timestamp": String(timestamp)
    },
    body,
    redirect: "error",
    signal: globalThis.AbortSignal.timeout(85_000)
  });
} catch (error) {
  throw Error("STAGING REAL CREATE: network/timeout failure (" +
    String(error?.name || "unknown") + "): no E2E PASS", { cause: error });
}
if (!response.headers.get("content-type")?.includes("application/json")) {
  throw Error("STAGING REAL CREATE: non-JSON response HTTP " + response.status);
}
let result;
try {result = await response.json()} catch {throw Error("STAGING REAL CREATE: malformed JSON HTTP " + response.status)}
const code = result?.error?.code || "NONE";
const intent = result?.data?.intent_id;
console.log("STAGING REAL CREATE: HTTP "+response.status+" API_CODE="+code+
  " HAS_INTENT_ID="+Boolean(typeof intent==="string" && /^[0-9a-f-]{36}$/i.test(intent)));
if (response.status!==200 || typeof intent!=="string" || !/^[0-9a-f-]{36}$/i.test(intent)) {
  throw Error("STAGING REAL CREATE: NOT VERIFIED HTTP "+response.status+" CODE="+code);
}
console.log("STAGING REAL CREATE: SIGNED CREATE 200; verify PostgreSQL durable row and real model receipts separately.");

// Continue with the *same* proof-of-possession key and continuity cookie.
// No mocks or bypass of F01 original-holder identity. One compile request only.
const decision = result?.data;
const version = decision?.intent_version;
console.log("STAGING REAL CREATE: F01 STATUS="+String(decision?.status||"UNKNOWN")+
  " HAS_VERSION="+Number.isInteger(version));
if(decision?.status !== "READY" || !Number.isInteger(version) || version<1) {
  throw Error("STAGING REAL COMPILE: Intent is not READY (no fake Blueprint PASS)");
}
const cookie = response.headers.get("set-cookie")?.split(";",1)[0];
if (!cookie?.includes("=")) throw Error("STAGING REAL COMPILE: continuity cookie missing");
const compilePath="/api/v1/intents/"+encodeURIComponent(intent)+"/compile";
const compileKey="appf2-sp35-compile-"+randomUUID();
const compileBody=JSON.stringify({intent_version:version});
const compileTimestamp=Date.now();
const compileTranscript=new TextEncoder().encode(JSON.stringify([
  "APPF2_MUTATION_PoP_V1", "POST", compilePath,
  base64url(await sha256(new TextEncoder().encode(compileBody))),
  compileKey, compileTimestamp
]));
const compileSignature=new Uint8Array(await subtle.sign(
  {name:"ECDSA",hash:"SHA-256"},pair.privateKey,compileTranscript
));
let compiled;
try {
  compiled=await fetch(new URL(compilePath,origin),{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      Origin:origin.origin,
      Cookie:cookie,
      "Idempotency-Key":compileKey,
      "X-Appf2-PoP-Key":base64url(publicKey),
      "X-Appf2-PoP-Signature":base64url(compileSignature),
      "X-Appf2-PoP-Timestamp":String(compileTimestamp)
    },
    body:compileBody,
    redirect:"error",
    signal:globalThis.AbortSignal.timeout(125_000)
  });
}catch(error){
  throw Error("STAGING REAL COMPILE: network or timeout; no Blueprint PASS",{cause:error});
}
if(!compiled.headers.get("content-type")?.includes("application/json"))
  throw Error("STAGING REAL COMPILE: non-JSON HTTP "+compiled.status);
const compileData=await compiled.json().catch(()=>({}));
const hash=compileData?.data?.content_hash;
const validHash=typeof hash==="string" && /^sha256:[a-f0-9]{64}$/.test(hash);
console.log("STAGING REAL COMPILE: HTTP "+compiled.status+
  " API_CODE="+String(compileData?.error?.code||"NONE")+
  " VALIDATED_HASH="+validHash);
if(compiled.status!==200 || compileData?.data?.status!=="VALIDATED" || !validHash){
  throw Error("STAGING REAL COMPILE: NOT VERIFIED; do not claim executable App");
}
console.log("STAGING REAL COMPILE: validated Blueprint from real OpenAI + PostgreSQL; browser hydration NOT VERIFIED.");

// Read the Blueprint as the same real original Intent holder; never expose
// grants or canonical content to CI logs. No mock or privileged API.
const grantPath="/api/v1/intents/"+encodeURIComponent(intent)+"/blueprint-access-grant";
const grantTimestamp=Date.now();
const grantTranscript=new TextEncoder().encode(JSON.stringify([
  "APPF2_READ_PoP_V1","GET",grantPath,hash,grantTimestamp
]));
const grantSignature=new Uint8Array(await subtle.sign(
  {name:"ECDSA",hash:"SHA-256"},pair.privateKey,grantTranscript
));
const grantResponse=await safeRead(
  new URL(grantPath+"?content_hash="+encodeURIComponent(hash),origin),{
    method:"GET",redirect:"error",
    headers:{Origin:origin.origin,Cookie:cookie,
      "X-Appf2-PoP-Key":base64url(publicKey),
      "X-Appf2-PoP-Signature":base64url(grantSignature),
      "X-Appf2-PoP-Timestamp":String(grantTimestamp)},
  }, "holder grant", 25_000
);
const grantData=await grantResponse.json().catch(()=>({}));
const accessGrant=grantData?.data?.intent_blueprint_access_grant;
console.log("STAGING REAL OPEN: grant HTTP "+grantResponse.status+
  " HAS_GRANT="+Boolean(typeof accessGrant==="string"&&accessGrant.length>30));
if(grantResponse.status!==200||typeof accessGrant!=="string"||accessGrant.length<30)
  throw Error("STAGING REAL OPEN: original-holder grant NOT VERIFIED");
const authorization={Authorization:"Bearer "+accessGrant,Origin:origin.origin};
const bodyResponse=await safeRead(new URL("/b/"+hash,origin),{
  headers:authorization,redirect:"error"
}, "Blueprint body", 20_000);
const bodyText=await bodyResponse.text();
const hasApp=bodyResponse.status===200 && (()=>{try{
  const bp=JSON.parse(bodyText);
  return bp.kind==="APP"&&Array.isArray(bp.nodes)&&bp.nodes.length>0;
}catch{return false}})();
console.log("STAGING REAL OPEN: Blueprint body HTTP "+bodyResponse.status+
  " PARSED_APP="+hasApp);
if(!hasApp)throw Error("STAGING REAL OPEN: canonical Blueprint body NOT VERIFIED");
const admissionResponse=await safeRead(
  new URL("/api/v1/blueprints/"+hash+"/execution-admission",origin),{
    headers:authorization,redirect:"error"
  }, "execution admission", 25_000
);
const admissionData=await admissionResponse.json().catch(()=>({}));
const executable=admissionResponse.status===200 &&
  admissionData?.data?.executable===true &&
  admissionData?.data?.content_hash===hash;
console.log("STAGING REAL OPEN: execution-admission HTTP "+admissionResponse.status+
  " EXECUTABLE="+executable);
if(!executable)throw Error("STAGING REAL OPEN: runtime execution admission NOT VERIFIED");
console.log("STAGING REAL OPEN: ORIGINAL-HOLDER BLUEPRINT DELIVERY + EXECUTION ADMISSION PASS; browser render NOT VERIFIED.");


