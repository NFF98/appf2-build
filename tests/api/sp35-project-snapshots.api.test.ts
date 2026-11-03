import {describe,it,expect} from "vitest";
import {createProjectSnapshot,applyProjectEdits}
 from "../../src/platform/agent/project-workspace.js";
import {persistAgentProjectSnapshot,readAgentProjectSnapshot}
 from "../../src/platform/agent/postgres-project-snapshots.js";
import type {AgentJobExecutor} from "../../src/platform/agent/postgres-agent-jobs.js";
const owner="a501ed0f-f0ab-46dc-b880-c0acb35291a0";
const stranger="b501ed0f-f0ab-46dc-b880-c0acb35291a0";
type Stored={project_hash:string;parent_hash:string|null;
 project_revision:number;snapshot:unknown};
class Journal implements AgentJobExecutor{
 private rows=new Map<string,Stored>();
 attempted=0;
 async query<T>(statement:string,args:readonly unknown[]):Promise<{rows:readonly T[]}>{
  const key=String(args[0])+":"+String(args[1]);
  if(statement.startsWith("INSERT")){
   this.attempted++;
   if(!this.rows.has(key)){
    this.rows.set(key,{project_hash:String(args[1]),
     parent_hash:args[2] as string|null,project_revision:Number(args[3]),
     snapshot:JSON.parse(String(args[4])) as unknown});
    return {rows:[{project_hash:args[1]} as T]};
   }
   return {rows:[]};
  }
  const found=this.rows.get(key);
  return {rows:found?[found as T]:[]};
 }
 tamper(hash:string,change:(v:Stored)=>Stored){
  const key=owner+":"+hash;
  const record=this.rows.get(key);
  if(record)this.rows.set(key,change(record));
 }
}
const fixture=()=>createProjectSnapshot("NODE","main.mjs",[
 {path:"main.mjs",content:"import {score} from './lib.mjs';console.log(score(3))"},
 {path:"lib.mjs",content:"export const score=(x)=>x*2;"}
]);
describe("durable source bytes for Sprint 3.5 candidate Agent jobs",()=>{
 it("writes immutable initial multi-file snapshot, reloads bytes and repeats safely",async()=>{
  const db=new Journal();
  const app=await fixture();
  const stored=await persistAgentProjectSnapshot(db,owner,app);
  expect(stored.project_hash).toBe(app.project_hash);
  expect(stored.files.map(f=>f.content)).toEqual(app.files.map(f=>f.content));
  expect((await readAgentProjectSnapshot(db,owner,app.project_hash))?.files).toEqual(app.files);
  expect(await persistAgentProjectSnapshot(db,owner,app)).toEqual(app);
  expect(db.attempted).toBe(2);
  expect(await readAgentProjectSnapshot(db,stranger,app.project_hash)).toBeNull();
 });
 it("saves edit lineage and rejects snapshots without a known parent",async()=>{
  const db=new Journal(),app=await fixture();
  const updated=await applyProjectEdits(app,app.project_hash,[{
   operation:"replace",path:"lib.mjs",previous_hash:app.files[0].hash,
   content:"export const score=(x)=>x*3;"
  }]);
  await expect(persistAgentProjectSnapshot(db,owner,updated)).rejects.toThrow("AGENT_PROJECT_PARENT_MISSING");
  await persistAgentProjectSnapshot(db,owner,app);
  expect((await persistAgentProjectSnapshot(db,owner,updated)).parent_hash).toBe(app.project_hash);
  const next=await readAgentProjectSnapshot(db,owner,updated.project_hash);
  expect(next?.revision).toBe(2);
  expect(next?.files[0].content).toContain("*3");
 });
 it("fails closed on forged hash and database-corrupted JSON content",async()=>{
  const db=new Journal(),app=await fixture();
  await expect(persistAgentProjectSnapshot(db,owner,{...app,files:[]})).rejects.toThrow("AGENT_PROJECT_INVALID");
  await persistAgentProjectSnapshot(db,owner,app);
  db.tamper(app.project_hash,x=>({...x,snapshot:{...app,files:[]}}));
  await expect(readAgentProjectSnapshot(db,owner,app.project_hash)).rejects.toThrow("AGENT_PROJECT_BYTES_CORRUPTED");
  await expect(persistAgentProjectSnapshot(db,owner,app)).rejects.toThrow("AGENT_PROJECT_BYTES_CORRUPTED");
 });
});
