import {describe,it,expect} from "vitest";
import {createProjectSnapshot,applyProjectEdits}
 from "../../src/platform/agent/project-workspace.js";
import {parseAgentResponsesBatch,makeAgentToolOutputs,
 RESPONSES_AGENT_TOOLS}
 from "../../src/platform/agent/responses-api.js";
import {provenProjectInspection}
 from "../../src/platform/agent/verified-project-inspection.js";
import type {AgentToolCall} from "../../src/platform/agent/agent-contract.js";

const call=(hash:string,path:string,offset:string):AgentToolCall=>({
 name:"inspect_project",call_id:"call_inspect_123456",project_hash:hash,
 args:{path,offset}
});
const snapshot=()=>createProjectSnapshot("VITE_WEB","index.html",[
 {path:"index.html",content:"<html></html>"},
 ...Array.from({length:24},(_,i)=>({
  path:"src/file-"+String(i).padStart(2,"0")+".ts",
  content:"const language='中文🧩';\n".repeat(210)+"export default "+i+";"
 }))
]);
describe("Sprint 3.5 complex project inspector (data only; no model/cloud)",()=>{
 it("advertises a strict bounded Responses tool with no shell field",()=>{
  const tool=RESPONSES_AGENT_TOOLS.find(x=>x.name==="inspect_project");
  expect(tool?.strict).toBe(true);
  expect(tool?.parameters.required).toEqual(["path","offset"]);
  expect(tool?.parameters.additionalProperties).toBe(false);
  expect(Object.keys(tool?.parameters.properties??{})).toEqual(["path","offset"]);
 });
 it("pages every project file including beyond the old ten-file repair limit",async()=>{
  const project=await snapshot(),names:string[]=[];
  let next:number|null=0;
  for(let pages=0;next!==null;pages++){
   expect(pages).toBeLessThan(5);
   const receipt=await provenProjectInspection(project,
    call(project.project_hash,".",String(next)));
   expect(receipt.exit_code).toBe(0);
   expect(receipt.detail.length).toBeLessThanOrEqual(4096);
   const data=JSON.parse(receipt.detail) as {
    kind:string;total_files:number;files:{path:string;hash:string}[];
    next_offset:number|null
   };
   expect(data.kind).toBe("DIRECTORY");
   expect(data.total_files).toBe(25);
   expect(data.files.every(x=>/^sha256:[0-9a-f]{64}$/u.test(x.hash))).toBe(true);
   names.push(...data.files.map(x=>x.path));
   next=data.next_offset;
  }
  expect(names).toEqual(project.files.map(x=>x.path));
  expect(new Set(names).size).toBe(25);
 });
 it("reads Unicode-safe nonoverlapping large-file chunks with explicit continuation",async()=>{
  const project=await snapshot();
  const source=project.files.find(f=>f.path==="src/file-17.ts")!;
  const combined:string[]=[];
  let cursor:number|null=0;
  for(let pages=0;cursor!==null;pages++){
   expect(pages).toBeLessThan(10);
   const receipt=await provenProjectInspection(project,
    call(project.project_hash,source.path,String(cursor)));
   const data=JSON.parse(receipt.detail) as {
    kind:string;found:boolean;file_hash:string;total_bytes:number;
    offset:number;next_offset:number|null;content:string
   };
   expect(data.kind).toBe("FILE");
   expect(data.found).toBe(true);
   expect(data.file_hash).toBe(source.hash);
   expect(data.total_bytes).toBe(source.bytes);
   expect(receipt.output_digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
   combined.push(data.content);
   cursor=data.next_offset;
  }
  expect(combined.join("")).toBe(source.content);
 });
 it("rejects traversal, SQL or shell-like paths and invalid cursors before dispatch",async()=>{
  const project=await snapshot(),hash=project.project_hash;
  const model=(path:string,offset:string)=>({
   id:"resp_inspection123456",status:"completed",output:[{
    type:"function_call",call_id:"call_inspect_123456",
    name:"inspect_project",arguments:JSON.stringify({path,offset})
   }]
  });
  for(const [path,offset] of [
   ["../../.env","0"],["/etc/passwd","0"],["src/file-01.ts","-1"],
   ["src/file-01.ts","01"],[".","1;rm -rf /"],[".","999999999"],
   [".","0.5"],[".","0"],["index.html","0;echo"]
  ]){
   const parsed=parseAgentResponsesBatch(model(path,offset),hash);
   if(path==="."&&offset==="0")expect(parsed?.calls.length).toBe(1);
   else expect(parsed).toBeNull();
  }
  const valid=parseAgentResponsesBatch(model(".","0"),hash)!;
  const proof=await provenProjectInspection(project,valid.calls[0]);
  const result=makeAgentToolOutputs(valid.calls,[proof]);
  expect(result[0].output).toContain("DIRECTORY");
  await expect(provenProjectInspection(project,{...call(hash,".","0"),
   project_hash:"sha256:"+"f".repeat(64)}))
   .rejects.toThrow("AGENT_INSPECT_PROJECT_UNVERIFIED");
 });
 it("binds inspection to immutable revised project hashes",async()=>{
  const project=await snapshot(),target=project.files.find(x=>x.path==="src/file-03.ts")!;
  const revised=await applyProjectEdits(project,project.project_hash,[{
   operation:"replace",path:target.path,previous_hash:target.hash,
   content:"export const fixed=true;"
  }]);
  expect((await provenProjectInspection(revised,
   call(revised.project_hash,target.path,"0"))).detail).toContain("fixed");
  await expect(provenProjectInspection(revised,call(project.project_hash,
   target.path,"0"))).rejects.toThrow("AGENT_INSPECT_PROJECT_UNVERIFIED");
 });
});
