import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {sealFreeCiTicket,openFreeCiTicket}
 from "../../src/platform/agent/free-ci-ticket.js";
import {verifyFreeCiOidc,FREE_CI_AUDIENCE}
 from "../../src/edge/free-ci-oidc.js";
import {validFreeCiDispatchInput}
 from "../../src/edge/free-ci-dispatch.js";
const now=Date.now();
const input={job_id:"ba45436c-c3f1-44f1-adc6-bdd0fb1592e7",
 owner:"44779c4e-19eb-4780-8dbf-ec8dbe233bd2",
 project_hash:"sha256:"+"a".repeat(64)};
const secret="private-cookie-key-".repeat(3);
const b64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes))
 .replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
const packed=(value:unknown)=>b64(new TextEncoder().encode(JSON.stringify(value)));
describe("SP35 free runner confidential source transport",()=>{
 it("dispatch uses the workflow already present on main, with no deploy if ticket supplied",()=>{
  const path=readFileSync(".github/workflows/sp35-staging-only.yml","utf8");
  const dispatch=readFileSync("src/edge/free-ci-dispatch.ts","utf8");
  const verifier=readFileSync("src/edge/free-ci-oidc.ts","utf8");
  expect(dispatch).toContain('"sp35-staging-only.yml/dispatches"');
  expect(path).toContain("inputs.ticket == '' &&");
  expect(path).toContain("inputs.ticket != '' &&");
  expect(path).toContain("id-token: write");
  expect(path).toContain("sp35-free-ci-dispatched-build.mjs");
  expect(path).toContain("APPF2_FREE_CI_GITHUB_TOKEN: ${{ secrets.APPF2_FREE_CI_GITHUB_TOKEN }}");
  expect(verifier).toContain("sp35-staging-only.yml@");
  expect(dispatch).not.toContain("inputs:{source");
 });

 it("AES-GCM ticket hides private owner/source, expires and rejects tampering",async()=>{
  const ticket=await sealFreeCiTicket(input,secret,now);
  expect(ticket).not.toContain(input.owner);
  expect(ticket).not.toContain(input.project_hash);
  expect(await openFreeCiTicket(ticket,secret,now+60000)).toMatchObject(input);
  expect(await openFreeCiTicket(ticket,secret,now+31*60000)).toBeNull();
  expect(await openFreeCiTicket(ticket,secret+"x",now)).toBeNull();
  const altered=ticket.slice(0,-3)+"123";
  expect(await openFreeCiTicket(altered,secret,now)).toBeNull();
 });
 it("creator must explicitly opt in; never sends source with dispatch request",()=>{
  expect(validFreeCiDispatchInput({anonymous_id:input.owner,
   explicit_free_ci_consent:true})).toBe(true);
  expect(validFreeCiDispatchInput({anonymous_id:input.owner})).toBe(false);
  expect(validFreeCiDispatchInput({anonymous_id:input.owner,
   explicit_free_ci_consent:true,source:"secret"})).toBe(false);
 });
 it("verifies RSA signature, strict repo/workflow/ref/audience, then rejects forged token",async()=>{
  const kp=await crypto.subtle.generateKey({name:"RSASSA-PKCS1-v1_5",
   modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),
   hash:"SHA-256"},true,["sign","verify"]);
  const jwk=await crypto.subtle.exportKey("jwk",kp.publicKey);
  const current=Math.floor(now/1000);
  const claims={iss:"https://token.actions.githubusercontent.com",
   aud:FREE_CI_AUDIENCE,repository:"NFF98/appf2-build",
   ref:"refs/heads/product/sprint-3.5-complex-intent-recovery-20261026",
   workflow_ref:"NFF98/appf2-build/.github/workflows/sp35-staging-only.yml@"+
    "refs/heads/product/sprint-3.5-complex-intent-recovery-20261026",
   event_name:"workflow_dispatch",runner_environment:"github-hosted",
   repository_visibility:"public",run_id:"41170526299",
   iat:current-5,exp:current+600};
  const head=packed({kid:"test-key",alg:"RS256",typ:"JWT"});
  const issue=async(body:unknown)=>{
   const raw=head+"."+packed(body);
   const sig=new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",kp.privateKey,new TextEncoder().encode(raw)));
   return raw+"."+b64(sig);
  };
  const keys={keys:[{...jwk,kid:"test-key",use:"sig",alg:"RS256"}]};
  const token=await issue(claims);
  expect(await verifyFreeCiOidc(token,now,async()=>keys)).toBe(true);
  expect(await verifyFreeCiOidc(token+"fake",now,async()=>keys)).toBe(false);
  expect(await verifyFreeCiOidc(await issue({...claims,
   repository:"attacker/bad"}),now,async()=>keys)).toBe(false);
  expect(await verifyFreeCiOidc(await issue({...claims,
   event_name:"pull_request"}),now,async()=>keys)).toBe(false);
  expect(await verifyFreeCiOidc(await issue({...claims,
   aud:"other"}),now,async()=>keys)).toBe(false);
 });
});
