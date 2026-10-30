import {describe,it,expect} from "vitest";
import {sandboxJobAllowed,OWNER_SCOPED_SANDBOX_JOBS}
 from "../../src/platform/agent/private-sandbox-authorization.js";
import {validPrivateBrokerConfig}
 from "../../src/edge/agent-sandbox-run.js";
const FIRST="ba45436c-c3f1-44f1-adc6-bdd0fb1592e7";
const SECOND="a6e2c5f0-a8d2-4aa6-ac2a-62f740e3bd0a";
const URL="https://private-sandbox.workers.dev/";
const TOKEN="0123456789abcdef0123456789abcdef";
describe("Private Sandbox owner-scoped multi-job opt-in",()=>{
 it("retains exact UUID pin by default and explicitly accepts other jobs only in owner-scoped mode",()=>{
  expect(sandboxJobAllowed(FIRST,FIRST)).toBe(true);
  expect(sandboxJobAllowed(FIRST,SECOND)).toBe(false);
  expect(sandboxJobAllowed(OWNER_SCOPED_SANDBOX_JOBS,FIRST)).toBe(true);
  expect(sandboxJobAllowed(OWNER_SCOPED_SANDBOX_JOBS,SECOND)).toBe(true);
  expect(sandboxJobAllowed("",SECOND)).toBe(false);
  expect(sandboxJobAllowed("ANY","not-a-valid-job")).toBe(false);
  expect(sandboxJobAllowed(OWNER_SCOPED_SANDBOX_JOBS,"../escape")).toBe(false);
  expect(sandboxJobAllowed(OWNER_SCOPED_SANDBOX_JOBS,"call_bad_key")).toBe(false);
 });
 it("preserves strict https, fixed private host and secret even with multi-job opt-in",()=>{
  expect(validPrivateBrokerConfig(URL,TOKEN,FIRST,FIRST)).toBe(true);
  expect(validPrivateBrokerConfig(URL,TOKEN,FIRST,SECOND)).toBe(false);
  expect(validPrivateBrokerConfig(URL,TOKEN,OWNER_SCOPED_SANDBOX_JOBS,SECOND)).toBe(true);
  expect(validPrivateBrokerConfig("https://evil.example/",TOKEN,
   OWNER_SCOPED_SANDBOX_JOBS,FIRST)).toBe(false);
  expect(validPrivateBrokerConfig("http://private-sandbox.workers.dev/",TOKEN,
   OWNER_SCOPED_SANDBOX_JOBS,FIRST)).toBe(false);
  expect(validPrivateBrokerConfig(URL,"short",OWNER_SCOPED_SANDBOX_JOBS,FIRST)).toBe(false);
 });
});

// Service binding is the required path when the Sandbox Worker has workers_dev:false.
import {sendPrivateSandboxTask,type SandboxServiceBinding}
 from "../../src/edge/agent-sandbox-run.js";
describe("private Worker service binding (no public URL, no fallback, no paid retry)",()=>{
 it("admits only authorized owner-scoped job + private binding + bearer token",()=>{
  const service={fetch:async()=>new Response("{}")} as SandboxServiceBinding;
  expect(validPrivateBrokerConfig("",TOKEN,OWNER_SCOPED_SANDBOX_JOBS,FIRST,service)).toBe(true);
  expect(validPrivateBrokerConfig("",TOKEN,FIRST,SECOND,service)).toBe(false);
  expect(validPrivateBrokerConfig("",TOKEN,OWNER_SCOPED_SANDBOX_JOBS,FIRST)).toBe(false);
  expect(validPrivateBrokerConfig(URL,TOKEN,FIRST,FIRST,service)).toBe(false);
  expect(validPrivateBrokerConfig("","short",FIRST,FIRST,service)).toBe(false);
 });
 it("dispatches exactly once over binding, never global fetch",async()=>{
  const calls:Request[]=[];
  const service:SandboxServiceBinding={fetch:async request=>{
   calls.push(request);
   return Response.json({data:{call_id:"call_signed_123456",ok:true}});
  }};
  const task={job_id:FIRST,project:{version:"test"},call:{name:"run_build"}};
  const data=await sendPrivateSandboxTask(task as never,"",TOKEN,service);
  expect(data).toMatchObject({call_id:"call_signed_123456",ok:true});
  expect(calls).toHaveLength(1);
  expect(new globalThis.URL(calls[0]!.url).hostname).toBe("appf2-private-sandbox.invalid");
  expect(calls[0]!.headers.get("Authorization")).toBe("Bearer "+TOKEN);
  expect(await calls[0]!.json()).toEqual(task);
 });
 it("does not retry or downgrade when private service fails",async()=>{
  let called=0;
  const service:SandboxServiceBinding={fetch:async()=>{called++;throw Error("BROKER_DOWN");}};
  await expect(sendPrivateSandboxTask({job_id:FIRST,project:{} as never,
   call:{} as never},"",TOKEN,service)).rejects.toThrow("BROKER_DOWN");
  expect(called).toBe(1);
 });
});
