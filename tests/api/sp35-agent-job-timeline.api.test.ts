import {describe,it,expect} from "vitest";
import {readOwnerJobTimeline,TIMELINE_SQL}
 from "../../src/edge/agent-job-timeline.js";
import type {AgentJobExecutor}
 from "../../src/platform/agent/postgres-agent-jobs.js";

const jobId="ba45436c-c3f1-44f1-adc6-bdd0fb1592e7";
const owner="c264c7c2-a967-4fbc-b201-ae9e942e03bc";
const thumb="a".repeat(64);
const saved=1793530000000;
const row={
 job_id:jobId,revision:4,job_state:"CODING",
 job_saved_ms:saved,qa_frozen_ms:saved+1000,
 first_model_reserved_ms:saved+2000,first_model_completed_ms:saved+12000,
 first_code_source_saved_ms:saved+14000,
 current_source_saved_ms:saved+39000,
 first_qa_receipt_ms:saved+28000,last_qa_receipt_ms:saved+41000,
 first_verified_preview_ms:saved+42000,
 current_private_preview_ms:saved+42000,
 model_calls_count:"2",qa_receipts_count:"2"
};
type Row=typeof row;
function fakeDB(record:Row|null){
 const queries:{sql:string;args:readonly unknown[]}[]=[];
 const db:AgentJobExecutor={
  query:async <T>(sql:string,args:readonly unknown[])=>{
   queries.push({sql,args});
   const allowed=args[0]===jobId&&args[1]===owner&&args[2]===thumb;
   return {rows:(allowed&&record?[record]:[]) as T[]};
  }
 };
 return {db,queries};
}
describe("SP35 G0 original-Job server timeline (free/no model dispatch)",()=>{
 it("reports immutable server milestone durations but never invents user interaction time",async()=>{
  const {db,queries}=fakeDB(row);
  const result=await readOwnerJobTimeline(db,{jobId,owner,ownerThumb:thumb});
  expect(result).toMatchObject({
   status:"SP35_REAL_TIMELINE_READ_ONLY",
   job_saved_at_ms:saved,time_to_first_source_ms:14000,
   time_to_first_qa_pass_preview_ms:42000,
   model_calls_recorded:2,qa_receipts_recorded:2,
   new_paid_model_calls_by_inspection:0,
   real_user_first_interaction_ms:null,app_published_by_inspection:false
  });
  expect(queries).toHaveLength(1);
  expect(queries[0]?.sql).toContain("owner_key_thumbprint=$3::text");
  expect(queries[0]?.args).toEqual([jobId,owner,thumb]);
  expect(JSON.stringify(result)).not.toContain(owner);
  expect(JSON.stringify(result)).not.toContain(thumb);
 });
 it("returns NOT_MEASURED null timestamps, not fake zeroes or a PASS",async()=>{
  const {db}=fakeDB({...row,
   first_code_source_saved_ms:null as unknown as number,
   first_verified_preview_ms:null as unknown as number,
   first_qa_receipt_ms:null as unknown as number,
   model_calls_count:0,qa_receipts_count:0});
  const result=await readOwnerJobTimeline(db,{jobId,owner,ownerThumb:thumb});
  expect(result?.time_to_first_source_ms).toBeNull();
  expect(result?.time_to_first_qa_pass_preview_ms).toBeNull();
  expect(result?.real_user_first_interaction_ms).toBeNull();
  expect(result?.qa_receipts_recorded).toBe(0);
 });
 it("fails closed for wrong owner/thumb, invalid inputs and missing Job",async()=>{
  const {db,queries}=fakeDB(row);
  expect(await readOwnerJobTimeline(db,{jobId,owner,ownerThumb:"b".repeat(64)}))
   .toBeNull();
  expect(await readOwnerJobTimeline(db,{jobId,owner:"someone",ownerThumb:thumb}))
   .toBeNull();
  expect(await readOwnerJobTimeline(db,{jobId:"../pass",owner,ownerThumb:thumb}))
   .toBeNull();
  expect(queries).toHaveLength(1);
  expect(await readOwnerJobTimeline(fakeDB(null).db,{jobId,owner,ownerThumb:thumb}))
   .toBeNull();
 });
 it("requires exact source+artifact+runner receipt and original frozen QA checks",()=>{
  expect(TIMELINE_SQL).toContain("p.project_hash=r.project_hash");
  expect(TIMELINE_SQL).toContain("p.run_id=r.run_id");
  expect(TIMELINE_SQL).toContain("p.artifact_hash=r.built_artifact_hash");
  expect(TIMELINE_SQL).toContain("required->>'id'");
  expect(TIMELINE_SQL).toContain("observed->>'criterion_id'");
  expect(TIMELINE_SQL).toContain("observed->>'verdict'='PASS'");
  expect(TIMELINE_SQL).not.toMatch(/UPDATE |INSERT |DELETE /u);
 });
});
