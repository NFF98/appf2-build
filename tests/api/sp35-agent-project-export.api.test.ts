import {describe,it,expect} from "vitest";
import {savedAgentProjectZip} from "../../src/app/code-builder/agent-project-zip.js";
import type {CandidateJob} from "../../src/app/code-builder/agent-browser-client.js";
const enc=new TextEncoder(),dec=new TextDecoder();
async function hash(content:string):Promise<string>{
 const d=new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(content)));
 return "sha256:"+Array.from(d,v=>v.toString(16).padStart(2,"0")).join("");
}
async function project():Promise<CandidateJob>{
 const files=[{path:"index.html",content:"<main>中文 App</main>"},
  {path:"src/main.ts",content:"export const score=42;"}];
 return {job_id:"ba45436c-c3f1-44f1-adc6-bdd0fb1592e7",revision:4,
  project_hash:"sha256:"+"a".repeat(64),status:"CODING",app_published:false,
  files:await Promise.all(files.map(async f=>({...f,bytes:enc.encode(f.content).length,
   hash:await hash(f.content)}))),
  checkpoint:{step:2,completed_call_ids:[],budget:{max_steps:8,
   max_cost_cents:60,max_tokens:8000}}};
}
function zipFiles(zip:Uint8Array):Map<string,string>{
 const view=new DataView(zip.buffer,zip.byteOffset,zip.byteLength);
 const result=new Map<string,string>();let pos=0;
 while(pos<zip.length&&view.getUint32(pos,true)===0x04034b50){
  const size=view.getUint32(pos+18,true),names=view.getUint16(pos+26,true),
   extras=view.getUint16(pos+28,true);
  expect(view.getUint16(pos+8,true)).toBe(0);
  const path=dec.decode(zip.subarray(pos+30,pos+30+names));
  const start=pos+30+names+extras;
  result.set(path,dec.decode(zip.subarray(start,start+size)));
  pos=start+size;
 }
 expect(view.getUint32(zip.length-22,true)).toBe(0x06054b50);
 expect(view.getUint16(zip.length-22+8,true)).toBe(result.size);
 expect(view.getUint32(zip.length-22+16,true)).toBe(pos);
 return result;
}
describe("Sprint 3.5 durable multi-file Agent download is a real offline ZIP",()=>{
 it("exports current source exactly, a revision manifest, and valid ZIP directory",async()=>{
  const job=await project(),zip=await savedAgentProjectZip(job);
  const files=zipFiles(zip);
  expect([...files.keys()]).toEqual(["index.html","src/main.ts","APPF2-PROJECT.json"]);
  expect(files.get("index.html")).toBe("<main>中文 App</main>");
  expect(files.get("src/main.ts")).toBe("export const score=42;");
  expect(JSON.parse(files.get("APPF2-PROJECT.json")??"null")).toMatchObject({
   schema:"APPF2_AGENT_EXPORT_V1",project_hash:job.project_hash,
   revision:job.revision,app_published:false
  });
  expect(await savedAgentProjectZip(job)).toEqual(zip);
 });
 it("rejects any tampered bytes, mismatched sizes and missing source integrity",async()=>{
  const job=await project();
  await expect(savedAgentProjectZip({...job,files:job.files.map((f,i)=>
   i===0?{...f,content:"CHANGED"}:f)}))
   .rejects.toThrow("AGENT_ZIP_SIZE_INVALID");
  await expect(savedAgentProjectZip({...job,files:job.files.map((f,i)=>
   i===0?{...f,content:"<main>other! App</main>"}:f)}))
   .rejects.toThrow("AGENT_ZIP_SOURCE_HASH_MISMATCH");
  await expect(savedAgentProjectZip({...job,files:job.files.map((f,i)=>
   i===0?{path:f.path,content:f.content}:f)}))
   .rejects.toThrow("AGENT_ZIP_PATH_INVALID");
 });
 it("rejects traversal and case-insensitive duplicate export paths",async()=>{
  const job=await project();
  await expect(savedAgentProjectZip({...job,files:job.files.map((f,i)=>
   i===0?{...f,path:"../.env"}:f)}))
   .rejects.toThrow("AGENT_ZIP_PATH_INVALID");
  await expect(savedAgentProjectZip({...job,
   files:[...job.files,{...job.files[0],path:"INDEX.HTML"}]}))
   .rejects.toThrow("AGENT_ZIP_PATH_INVALID");
 });
});
