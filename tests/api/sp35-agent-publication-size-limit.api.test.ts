import {describe,expect,it} from "vitest";
import {routeAgentJobs} from "../../src/edge/agent-jobs.js";
import type {Appf2WorkerEnv} from "../../src/edge/worker-composition.js";

const ORIGIN="https://app.example";
const ID="7045a009-6bfc-4889-8f1b-df03ba93c406";
const SHARE="/api/v1/agent-jobs/"+ID+"/publish-code-app";
const OTHER="/api/v1/agent-jobs/"+ID+"/free-ai-stage";
const env={APPF2_AGENT_CANDIDATE_ENABLED:"1"} as Appf2WorkerEnv;

/** Deliberately invalid PoP: after size admission, 404 must result BEFORE
 * body parsing, DB access, paid AI, public sharing, or anyone else's identity.
 * A 2xx response is never acceptable for this free test.
 */
async function probe(path:string,payload:string,contentLength?:number){
 const request=new Request(ORIGIN+path,{method:"POST",headers:{
  "Content-Type":"application/json","Origin":ORIGIN,
  "Sec-Fetch-Site":"same-origin",
  "Idempotency-Key":"sp35-free-publish-limit",
  ...(contentLength===undefined?{}:{"Content-Length":String(contentLength)})
 },body:payload});
 const response=await routeAgentJobs({request,url:new URL(request.url),
  env,nowMs:Date.now()});
 return {status:response?.status,body:await response?.json()};
}
const bytes=(s:string)=>new TextEncoder().encode(s).byteLength;

describe("Sprint 3.5 owner-only publication size gate, zero model / DB",()=>{
 it("admits legitimate long UTF-8 original requirement past 1400 to signature rejection, never publishes",async()=>{
  const payload=JSON.stringify({anonymous_id:ID,
   expected_project_hash:"sha256:"+"a".repeat(64),
   original_prompt:"請做完整可操作的多檔中文互動應用。".repeat(36),
   title:"雙人拿石頭",explicit_public_share_consent:true});
  expect(bytes(payload)).toBeGreaterThan(1400);
  expect(bytes(payload)).toBeLessThanOrEqual(4096);
  const result=await probe(SHARE,payload);
  expect(result.status).toBe(404); // Invalid PoP; not 413, never ACTIVE.
  expect(result.body).toEqual({error:"AGENT_JOB_NOT_FOUND"});
 });
 it("fail closes publish POST at raw 4097+ bytes and at forged Content-Length",async()=>{
  const huge=JSON.stringify({original_prompt:"中文".repeat(760)});
  expect(bytes(huge)).toBeGreaterThan(4096);
  expect((await probe(SHARE,huge)).status).toBe(413);
  expect((await probe(SHARE,"{}",4097)).status).toBe(413);
 });
 it("keeps unrelated Agent routes at 1400 raw bytes, cannot widen model endpoints",async()=>{
  const oversized=JSON.stringify({text:"中文".repeat(265)});
  expect(bytes(oversized)).toBeGreaterThan(1400);
  expect(bytes(oversized)).toBeLessThan(4096);
  expect((await probe(OTHER,oversized)).status).toBe(413);
 });
});
