import {describe,it,expect,vi,afterEach} from "vitest";
import {readSignedPreviewAsset,validPreviewAssetBody}
 from "../../src/edge/agent-preview-asset.js";
import type {AgentJobExecutor} from "../../src/platform/agent/postgres-agent-jobs.js";
const mockState=vi.hoisted(()=>({completed:[
 "call_build_1234","call_test_1234"]}));
vi.mock("../../src/platform/agent/durable-agent-service.js",()=>({
 recoverAgentJob:vi.fn(async()=>({
  job:{revision:5,job_state:"TESTING",
   checkpoint:{completed_call_ids:mockState.completed}},
  project:{project_hash:"sha256:"+"a".repeat(64)}
 }))
}));
const jobId="ba45436c-c3f1-44f1-adc6-bdd0fb1592e7";
const owner="b55df946-2258-4a0c-98cb-b20c442ce337";
const hash="sha256:"+"a".repeat(64);
const input={anonymous_id:owner,expected_revision:5,project_hash:hash,
 build_call_id:"call_build_1234",test_call_id:"call_test_1234",
 path:"index.html",explicit_container_preview_consent:true as const};
function proof(id:string){
 return {call_id:id,project_hash:hash,job_revision:id===input.build_call_id?3:4,
  status:"SUCCEEDED",receipt_json:{
  call_id:id,project_hash:hash,exit_code:0,timed_out:false,
  runner_attestation:"APPF2_ISOLATED_CLOUDFLARE_CONTAINER_V1"}};
}
function fixture(){
 const calls:{sql:string;args:unknown[]}[]=[];
 const rows=[proof(input.build_call_id),proof(input.test_call_id)];
 const db={query:async(sql:string,args:unknown[])=>{
  calls.push({sql,args});
  return {rows:sql.includes("appf2_agent_sandbox_call")?rows:
   [{job_id:jobId}]};
 }} as unknown as AgentJobExecutor;
 let fetchCount=0;
 const service={fetch:async(request:Request)=>{
  fetchCount++;
  expect(request.headers.get("Authorization")).toBe("Bearer "+"x".repeat(32));
  expect(await request.json()).toEqual({
   job_id:jobId,build_call_id:input.build_call_id,
   project_hash:hash,path:"index.html"
  });
  return new Response("<!doctype html><main id='app'></main>",{status:200});
 }};
 return {calls,rows,db,service,get fetchCount(){return fetchCount;}};
}
const deps=(f:ReturnType<typeof fixture>)=>({
 db:f.db,jobId,owner,ownerThumb:"sha256:"+"f".repeat(64),
 brokerToken:"x".repeat(32),brokerService:f.service,
 allowedJobId:jobId
});
afterEach(()=>{
 mockState.completed=["call_build_1234","call_test_1234"];
 vi.restoreAllMocks();
});
describe("Sprint 3.5 private executable App preview gate",()=>{
 it("requires explicit consent and strictly shaped build + test IDs",()=>{
  expect(validPreviewAssetBody(input)).toBe(true);
  expect(validPreviewAssetBody({...input,explicit_container_preview_consent:false}))
   .toBe(false);
  expect(validPreviewAssetBody({...input,path:"../secrets"})).toBe(false);
  expect(validPreviewAssetBody({...input,test_call_id:input.build_call_id}))
   .toBe(false);
  expect(validPreviewAssetBody({...input,unknown:"hidden"})).toBe(false);
 });
 it("retrieves owner-scoped compiled HTML only after independently saved PASS",async()=>{
  const f=fixture();
  const value=await readSignedPreviewAsset(input,deps(f));
  expect(value).toMatchObject({path:"index.html",
   content_type:"text/html; charset=utf-8",project_hash:hash});
  expect(value.text).toContain("id='app'");
  expect(f.fetchCount).toBe(1);
  expect(f.calls.some(c=>c.sql.includes("owner_key_thumbprint"))).toBe(true);
  expect(f.calls.some(c=>c.sql.includes("appf2_agent_sandbox_call"))).toBe(true);
 });
 it("previews a real build followed by read-only tools then the latest test",async()=>{
  mockState.completed=[
   "call_build_1234","call_inspect_5678","call_test_1234"];
  const f=fixture();
  const value=await readSignedPreviewAsset(input,deps(f));
  expect(value.project_hash).toBe(hash);
  expect(f.fetchCount).toBe(1);
 });
 it("denies a build after the test, or a non-latest tested head",async()=>{
  const f=fixture();
  mockState.completed=["call_test_1234","call_build_1234"];
  await expect(readSignedPreviewAsset(input,deps(f)))
   .rejects.toThrow("PREVIEW_NOT_LAST_PROVEN_BUILD_AND_TEST");
  mockState.completed=["call_build_1234","call_test_1234","call_read_9999"];
  await expect(readSignedPreviewAsset(input,deps(f)))
   .rejects.toThrow("PREVIEW_NOT_LAST_PROVEN_BUILD_AND_TEST");
  expect(f.fetchCount).toBe(0);
 });
 it("never contacts the broker when build/test receipt is not proven",async()=>{
  const f=fixture();
  f.rows[1]!.status="BLOCKED_UNCERTAIN";
  await expect(readSignedPreviewAsset(input,deps(f)))
   .rejects.toThrow("PREVIEW_SUCCESSFUL_BUILD_TEST_NOT_PROVEN");
  expect(f.fetchCount).toBe(0);
 });
 it("rejects a build receipt from a future revision relative to the latest test",async()=>{
  const f=fixture();
  f.rows[0]!.job_revision=6;
  await expect(readSignedPreviewAsset(input,deps(f)))
   .rejects.toThrow("PREVIEW_SUCCESSFUL_BUILD_TEST_NOT_PROVEN");
  expect(f.fetchCount).toBe(0);
 });
 it("denies stale revision, path traversal and absent private service",async()=>{
  const f=fixture();
  await expect(readSignedPreviewAsset({...input,expected_revision:4},deps(f)))
   .rejects.toThrow("PREVIEW_PROJECT_REVISION_MISMATCH");
  await expect(readSignedPreviewAsset({...input,path:"../../.env"},deps(f)))
   .rejects.toThrow("PREVIEW_PRIVATE_BROKER_DISABLED");
  await expect(readSignedPreviewAsset(input,{...deps(f),brokerService:undefined}))
   .rejects.toThrow("PREVIEW_PRIVATE_BROKER_DISABLED");
  expect(f.fetchCount).toBe(0);
 });
});
