import {describe,it,expect} from "vitest";
import {inspectProvenPreviewPair}
 from "../../src/edge/agent-proven-preview.js";
import type {AgentJobExecutor} from "../../src/platform/agent/postgres-agent-jobs.js";
const job="ba45436c-c3f1-44f1-adc6-bdd0fb1592e7";
const owner="c264c7c2-a967-4fbc-b201-ae9e942e03bc";
const source="sha256:"+"a".repeat(64);
const build="call_proven_build123456",test="call_proven_test123456";
const receipt=(id:string)=>({call_id:id,project_hash:source,
 exit_code:0,timed_out:false,output_digest:"sha256:"+"b".repeat(64),
 runner_attestation:"APPF2_ISOLATED_CLOUDFLARE_CONTAINER_V1"});
function fixture(){
 const sandbox=[
  {job_id:job,owner_anonymous_id:owner,call_id:build,
   model_call_key:"agent_build_12345678",job_revision:2,
   checkpoint_hash:"sha256:"+"d".repeat(64),project_hash:source,
   status:"SUCCEEDED",receipt_json:receipt(build)},
  {job_id:job,owner_anonymous_id:owner,call_id:test,
   model_call_key:"agent_test_12345678",job_revision:14,
   checkpoint_hash:"sha256:"+"e".repeat(64),project_hash:source,
   status:"SUCCEEDED",receipt_json:receipt(test)}];
 const models=sandbox.map((r,i)=>({
  job_id:job,owner_anonymous_id:owner,call_key:r.model_call_key,
  job_revision:r.job_revision,checkpoint_hash:r.checkpoint_hash,
  status:"SUCCEEDED",response_id:"resp_proven_"+i+"12345678",
  response_json:{id:"resp_proven_"+i+"12345678",status:"completed",
   output:[{type:"function_call",name:i===0?"run_build":"run_test",
    call_id:r.call_id,arguments:JSON.stringify({target:"project"})}]}
 }));
 let lookupCount=0;
 const db={query:async <T>(sql:string,args:readonly unknown[])=>{
  if(sql.includes("FROM public.appf2_agent_sandbox_call"))
   return {rows:sandbox.filter(x=>args[3] instanceof Array&&
    args[3].includes(x.call_id)) as T[]};
  if(sql.includes("FROM public.appf2_agent_model_call")){
   lookupCount++;
   return {rows:models.filter(x=>x.call_key===args[2]) as T[]};
  }
  throw Error("UNEXPECTED_DB_READ");
 }} as AgentJobExecutor;
 return {db,sandbox,models,get lookupCount(){return lookupCount;}};
}
describe("Sprint 3.5 full-journal build/test provenance",()=>{
 it("recovers a valid build older than eight Agent turns, without paid tools",async()=>{
  const f=fixture();
  const ids=[build,...Array.from({length:11},(_,i)=>"call_inspect_"+i),test];
  expect(await inspectProvenPreviewPair(f.db,job,owner,source,ids))
   .toEqual({build_call_id:build,test_call_id:test});
  expect(f.lookupCount).toBe(2);
 });
 it("rejects altered independent test evidence and changed source",async()=>{
  const f=fixture();
  f.sandbox[1]!.receipt_json={...receipt(test),timed_out:true};
  expect(await inspectProvenPreviewPair(f.db,job,owner,source,[build,test]))
   .toBeNull();
  expect(f.lookupCount).toBe(0);
  f.sandbox[1]!.receipt_json=receipt(test);
  expect(await inspectProvenPreviewPair(f.db,job,owner,
   "sha256:"+"c".repeat(64),[build,test])).toBeNull();
 });
 it("rejects model-dispatched tool mismatch and false checkpoint chronology",async()=>{
  const f=fixture();
  f.models[0]!.response_json={id:"resp_proven_012345678",status:"completed",
   output:[{type:"function_call",name:"run_test",call_id:build,
    arguments:JSON.stringify({target:"project"})}]};
  expect(await inspectProvenPreviewPair(f.db,job,owner,source,[build,test]))
   .toBeNull();
  f.sandbox[0]!.job_revision=20;
  expect(await inspectProvenPreviewPair(f.db,job,owner,source,[build,test]))
   .toBeNull();
 });
 it("refuses a non-latest run_test or duplicate checkpoint identities",async()=>{
  const f=fixture();
  expect(await inspectProvenPreviewPair(f.db,job,owner,source,
   [build,test,"call_read_after_test"])).toBeNull();
  expect(await inspectProvenPreviewPair(f.db,job,owner,source,
   [build,build,test])).toBeNull();
  expect(await inspectProvenPreviewPair(f.db,job,owner,source,
   [test,build])).toBeNull();
 });
});
