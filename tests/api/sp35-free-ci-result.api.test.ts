import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {persistFreeCiSmoke,validFreeCiSmoke,readFreeCiSmoke}
 from "../../src/edge/free-ci-result.js";
import type {AgentJobExecutor} from "../../src/platform/agent/postgres-agent-jobs.js";
const hash="sha256:"+"a".repeat(64);
const artifact="sha256:"+"b".repeat(64);
const job="ba45436c-c3f1-44f1-adc6-bdd0fb1592e7";
const owner="44779c4e-19eb-4780-8dbf-ec8dbe233bd2";
const scope={jobId:job,owner,projectHash:hash,runId:"41176651218"};
const report={version:"APPF2_FREE_CI_SMOKE_V1" as const,
 project_hash:hash,artifact_hash:artifact,
 checks:{locked_build:true as const,chromium_render:true as const}};
class Db implements AgentJobExecutor{
 saved:{run_id:string;built_artifact_hash:string;receipt_json:unknown}|null=null;
 active=true;
 async query<T>(sql:string,args:readonly unknown[]):Promise<{rows:readonly T[]}>{
  if(sql.includes("INSERT INTO public.appf2_agent_free_ci_receipt")){
   if(!this.active||this.saved)return {rows:[]};
   this.saved={run_id:String(args[3]),built_artifact_hash:String(args[4]),receipt_json:JSON.parse(String(args[5])) as unknown};
   return {rows:[{job_id:args[0]} as T]};
  }
  if(sql.includes("SELECT run_id,built_artifact_hash")){
   return {rows:this.saved?[this.saved as T]:[]};
  }
  throw Error("UNEXPECTED_SQL");
 }
}
describe("SP35 free GitHub OIDC result returns to original private Job",()=>{
 it("stores immutable same job/hash and idempotent exact replay",async()=>{
  const db=new Db();
  expect(await persistFreeCiSmoke(db,scope,report)).toBe("RECORDED");
  expect(await persistFreeCiSmoke(db,scope,report)).toBe("REPLAYED");
  expect(await readFreeCiSmoke(db,job,owner,hash)).toEqual({
   status:"BUILD_BROWSER_SMOKE",run_id:scope.runId,artifact_hash:artifact,
   original_requirements_qa:false,app_published:false});
  await expect(persistFreeCiSmoke(db,scope,{...report,
   artifact_hash:"sha256:"+"c".repeat(64)})).rejects.toThrow("CONFLICT");
 });
 it("rejects false QA, wrong hash, omitted Chrome and stale project",async()=>{
  const db=new Db();db.active=false;
  expect(validFreeCiSmoke({...report,checks:{locked_build:true,chromium_render:false}})).toBe(false);
  expect(validFreeCiSmoke({...report,app_published:true})).toBe(false);
  await expect(persistFreeCiSmoke(db,{...scope,projectHash:artifact},
   report)).rejects.toThrow("INVALID");
  await expect(persistFreeCiSmoke(db,scope,report)).rejects.toThrow("CONFLICT");
 });
 it("runner performs independent OIDC callback, not just a console PASS",()=>{
  const script=readFileSync("deploy/scripts/sp35-free-ci-dispatched-build.mjs","utf8");
  expect(script).toContain('"/api/v1/internal/free-ci/result"');
  expect(script).toContain('original_requirements_qa!==false');
  expect(script).toContain('FREE_CI_SMOKE_RECEIPT_NOT_DURABLE');
  expect(script).toContain('await newOidc()');
  expect(script).toContain('process.env.GITHUB_EVENT_PATH');
  expect(script).not.toContain('process.env.APPF2_FREE_CI_TICKET');
  expect(script).toContain('const ticket=event.inputs.ticket');
  expect(script).toContain('"/api/v1/internal/free-ci/preview"');
  expect(script).toContain('FREE_CI_PRIVATE_PREVIEW_NOT_DURABLE');
 });
});
