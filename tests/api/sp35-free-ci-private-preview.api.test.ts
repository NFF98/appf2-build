import {describe,it,expect} from "vitest";
import {validFreeCiBuiltPreview,saveFreeCiBuiltPreview,
 routePrivateFreeCiPreview} from "../../src/edge/free-ci-preview.js";
import type {AgentJobExecutor} from "../../src/platform/agent/postgres-agent-jobs.js";
import type {Appf2WorkerEnv} from "../../src/edge/worker-composition.js";
const source="sha256:"+"a".repeat(64);
const artifact="sha256:"+"b".repeat(64);
const preview={project_hash:source,artifact_hash:artifact,
 index_html:"<!doctype html><html><head></head><body><div id='app'></div></body></html>",
 javascript:"document.getElementById('app').textContent='ready'",
 css:""};
const scope={jobId:"ba45436c-c3f1-44f1-adc6-bdd0fb1592e7",
 owner:"44779c4e-19eb-4780-8dbf-ec8dbe233bd2",projectHash:source,
 runId:"41182117441"};
class Db implements AgentJobExecutor{
 saved:{run_id:string;artifact_hash:string;preview_json:unknown}|null=null;
 active=true;
 async query<T>(sql:string,args:readonly unknown[]):Promise<{rows:readonly T[]}>{
  if(sql.includes("INSERT INTO public.appf2_agent_free_ci_preview")){
   if(!this.active||this.saved)return {rows:[]};
   this.saved={run_id:String(args[3]),artifact_hash:String(args[4]),
    preview_json:JSON.parse(String(args[5])) as unknown};
   return {rows:[{job_id:args[0]} as T]};
  }
  if(sql.includes("SELECT run_id,artifact_hash,preview_json")){
   return {rows:this.saved?[this.saved as T]:[]};
  }
  throw Error("FREE_CI_PREVIEW_TEST_UNEXPECTED_SQL");
 }
}
describe("SP35 free Docker built app remains private and immutable",()=>{
 it("accepts only bounded exact Vite preview shape",()=>{
  expect(validFreeCiBuiltPreview(preview)).toBe(true);
  expect(validFreeCiBuiltPreview({...preview,app_published:true})).toBe(false);
  expect(validFreeCiBuiltPreview({...preview,javascript:""})).toBe(false);
  expect(validFreeCiBuiltPreview({...preview,project_hash:artifact,artifact_hash:"not-a-sha"})).toBe(false);
  expect(validFreeCiBuiltPreview({...preview,javascript:"x".repeat(300001)})).toBe(false);
 });
 it("immutable same-run receipt-bound snapshot; incompatible replay denied",async()=>{
  const db=new Db();
  expect(await saveFreeCiBuiltPreview(db,scope,preview)).toBe("RECORDED");
  expect(await saveFreeCiBuiltPreview(db,scope,preview)).toBe("REPLAYED");
  await expect(saveFreeCiBuiltPreview(db,scope,{...preview,
   javascript:preview.javascript+";window.debug=true;"})).rejects.toThrow("CONFLICT");
  await expect(saveFreeCiBuiltPreview(db,{...scope,projectHash:artifact},
   preview)).rejects.toThrow("INVALID");
 });
 it("denies unauthenticated injection even before a database connection",async()=>{
  const request=new Request("https://staging.example/api/v1/internal/free-ci/preview",{
   method:"POST",headers:{"Content-Type":"application/json"},
   body:JSON.stringify({ticket:"fake",preview})});
  const response=await routePrivateFreeCiPreview(request,new URL(request.url),
   {APPF2_AGENT_FREE_ONLY:"1"} as Appf2WorkerEnv,Date.now());
  expect(response?.status).toBe(404);
 });
});
