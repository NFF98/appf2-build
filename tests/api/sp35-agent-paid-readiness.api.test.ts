import {describe,it,expect,vi,afterEach} from "vitest";
import {createWorkerFetch} from "../../src/edge/worker-entry.js";
import {agentReadiness} from "../../src/edge/agent-readiness.js";
import {requireAgentBuildReadiness} from "../../src/app/code-builder/agent-readiness.js";
import type {Appf2WorkerEnv} from "../../src/edge/worker-composition.js";
const url="https://app.example/api/v1/agent-readiness";
const env={APPF2_AGENT_CANDIDATE_ENABLED:"1",
 APPF2_AGENT_MODEL_EXECUTION_ENABLED:"1",
 APPF2_OPENAI_AGENT_API_KEY:"k".repeat(32),
 APPF2_AGENT_SANDBOX_EXECUTION_ENABLED:"1",
 APPF2_SANDBOX_BROKER_SERVICE:{fetch:async()=>new Response("")},
 APPF2_SANDBOX_BROKER_TOKEN:"s".repeat(32),
 APPF2_SANDBOX_ALLOWED_JOB_ID:"OWNER_SCOPED_JOBS",
 APPF2_AGENT_QA_BROWSER_ENABLED:"1",
 APPF2_AGENT_QA_REVIEW_ENABLED:"1",
 APPF2_QA_BROWSER_SERVICE:{fetch:async()=>new Response("")},
 APPF2_QA_PRIVATE_TOKEN:"q".repeat(32),
 APPF2_AGENT_QA_VERIFIER_SECRET:"v".repeat(32)} as unknown as Appf2WorkerEnv;
afterEach(()=>vi.unstubAllGlobals());
describe("SP35 real product paid-step readiness preflight",()=>{
 it("GET is DB/AI/Container-free; reports CONFIGURED, never a live PASS",async()=>{
  const fetch=createWorkerFetch({intent:()=>{throw Error("DB_must_not_run");}});
  const response=await fetch(new Request(url),env);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(await response.json()).toEqual({data:{
   status:"CONFIGURED_NOT_VERIFIED",can_start_paid_generation:true,missing:[]}});
 });
 it("fail closed when browser QA or Sandbox binding is absent",async()=>{
  const noQa={...env,APPF2_QA_BROWSER_SERVICE:undefined};
  expect(agentReadiness(noQa).missing).toContain("BROWSER_QA");
  const noSandbox={...env,APPF2_SANDBOX_BROKER_SERVICE:undefined};
  expect(agentReadiness(noSandbox).missing).toContain("SANDBOX");
  expect(agentReadiness({...env,APPF2_AGENT_CANDIDATE_ENABLED:"0"})
   .can_start_paid_generation).toBe(false);
 });
 it("refuses non-GET probes without calling model or DB",async()=>{
  const fetch=createWorkerFetch({intent:()=>{throw Error("DB_must_not_run");}});
  const response=await fetch(new Request(url,{method:"POST",body:"{}"}),env);
  expect(response.status).toBe(405);
 });
 it("browser never starts paid creation on an old or incomplete Worker",async()=>{
  const request=vi.fn(async()=>new Response(JSON.stringify({error:"API-NOT-FOUND"}),
   {status:404,headers:{"Content-Type":"application/json"}}));
  vi.stubGlobal("fetch",request);
  await expect(requireAgentBuildReadiness()).rejects.toThrow("沒有呼叫付費 AI");
  expect(request).toHaveBeenCalledOnce();
  const incomplete=vi.fn(async()=>new Response(JSON.stringify({data:{
   status:"BLOCKED",can_start_paid_generation:false,missing:["SANDBOX"]}}),
   {status:200,headers:{"Content-Type":"application/json"}}));
  vi.stubGlobal("fetch",incomplete);
  await expect(requireAgentBuildReadiness()).rejects.toThrow("不會先付費");
 });
 it("browser proceeds only with complete configured flags, no model called",async()=>{
  const request=vi.fn(async()=>new Response(JSON.stringify({data:{
   status:"CONFIGURED_NOT_VERIFIED",can_start_paid_generation:true,missing:[]}}),
   {status:200,headers:{"Content-Type":"application/json"}}));
  vi.stubGlobal("fetch",request);
  await expect(requireAgentBuildReadiness()).resolves.toBeUndefined();
  expect(request).toHaveBeenCalledOnce();
 });
});
