import {describe,it,expect} from "vitest";
import {trustedFreeCiOidcRequestUrl}
 from "../../src/edge/free-ci-oidc-request-url.js";
import {validFreeCiGitHubToken,sendFreeCiGithubDispatch}
 from "../../src/edge/free-ci-dispatch.js";
describe("SP35 actual GitHub-hosted OIDC source access",()=>{
 it("accepts GitHub classic and regional OIDC endpoints without exposing tokens",()=>{
  expect(trustedFreeCiOidcRequestUrl(
   "https://pipelines.actions.githubusercontent.com/runner/oidc?api-version=2.0"
  )?.hostname).toBe("pipelines.actions.githubusercontent.com");
  const regional=trustedFreeCiOidcRequestUrl(
   "https://pipelinesghubeus6.actions.githubusercontent.com/runner/oidc?api-version=2.0");
  expect(regional?.hostname).toBe("pipelinesghubeus6.actions.githubusercontent.com");
  regional?.searchParams.set("audience","appf2-sp35-free-ci-private-source-v1");
  expect(regional?.searchParams.get("audience")).toBe("appf2-sp35-free-ci-private-source-v1");
 });
 it("rejects malicious lookalike hosts, credentials, insecure schemes and redirects",()=>{
  for(const url of [
   "http://pipelines.actions.githubusercontent.com/runner/oidc",
   "https://pipelines.actions.githubusercontent.com.attacker.test/runner/oidc",
   "https://pipelines.actions.githubusercontent.com@attacker.test/runner/oidc",
   "https://pipelines-actions.githubusercontent.com/runner/oidc",
   "https://example.com/runner/oidc",
   "https://pipelinesghubeus6.actions.githubusercontent.com/",
   "https://pipelinesghubeus6.actions.githubusercontent.com/runner#fragment",
   "https://user:password@pipelines.actions.githubusercontent.com/runner"
  ])expect(trustedFreeCiOidcRequestUrl(url)).toBeNull();
 });
 it("preserves native fetch receiver in the Cloudflare Worker dispatch",async()=>{
  const original=globalThis.fetch;
  let correct=false;
  try{
   globalThis.fetch=function(this:typeof globalThis){
    correct=this===globalThis;
    return Promise.resolve(new Response(null,{status:204}));
   } as typeof fetch;
   const response=await sendFreeCiGithubDispatch("https://api.github.com/",{});
   expect(response.status).toBe(204);
   expect(correct).toBe(true);
  }finally{globalThis.fetch=original;}
 });
 it("accepts only scoped GitHub PAT or App installation token shapes",()=>{
  expect(validFreeCiGitHubToken("github_pat_"+"x".repeat(40))).toBe(true);
  expect(validFreeCiGitHubToken("ghs_"+"x".repeat(40))).toBe(true);
  expect(validFreeCiGitHubToken("ghp_"+"x".repeat(40))).toBe(true);
  expect(validFreeCiGitHubToken("")).toBe(false);
  expect(validFreeCiGitHubToken("glpat_"+"x".repeat(40))).toBe(false);
  expect(validFreeCiGitHubToken("Bearer "+"x".repeat(40))).toBe(false);
 });
});
