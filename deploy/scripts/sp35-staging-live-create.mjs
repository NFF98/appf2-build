// REAL staging-only signed F01 CREATE: one bounded production-path request.
// Tests browser PoP wire protocol against deployed Cloudflare Worker + Hyperdrive + OpenAI.
// No retries, no mocks, no secret or response bodies logged, no Production targets.
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
const base64url = bytes => Buffer.from(bytes).toString("base64url");
const sha256 = async bytes => new Uint8Array(await subtle.digest("SHA-256", bytes));
const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
const publicKey = new Uint8Array(await subtle.exportKey("spki", pair.publicKey));
const key = "appf2-create-v1." + base64url(await sha256(publicKey));
const path = "/api/v1/intents";
const body = JSON.stringify({
  anonymous_id: randomUUID(),
  intent_kind: "CREATE",
  raw_intent: "Create a small personal task tracker with a task name, done checkbox and a list.",
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
