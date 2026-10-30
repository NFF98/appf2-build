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
