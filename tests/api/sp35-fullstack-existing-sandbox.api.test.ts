import {describe,it,expect} from "vitest";
import {createProjectSnapshot} from "../../src/platform/agent/project-workspace.js";
import {CloudflareIsolatedSandboxAdapter,type IsolatedContainer,
 type IsolatedProcess} from "../../src/platform/agent/cloudflare-sandbox-adapter.js";
import {PINNED_VITE_BIN,PINNED_MODULES,PINNED_WEB_SMOKE,sandboxCommands,
 sandboxWorkspaceRoot} from "../../src/platform/agent/sandbox-commands.js";
import type {AgentToolCall} from "../../src/platform/agent/agent-contract.js";
import type {SandboxLimits} from "../../src/platform/agent/sandbox-adapter.js";
const job="job_12345678";
const limits:SandboxLimits={wall_time_ms:2000,cpu_millis:1000,memory_mb:128,disk_mb:256,
 network_policy:"DENY_ALL",allowed_hosts:[]};
const files=[
 {path:"index.html",content:"<main></main><script type='module' src='/src/main.ts'></script>"},
 {path:"src/main.ts",content:"document.body.textContent='APP';"},
 {path:"server/index.mjs",content:"export const calculate=(n)=>n*3;"},
 {path:"server/test.mjs",content:"import {test} from 'node:test'; import {calculate} from './index.mjs'; test('business',()=>{if(calculate(7)!==21)throw Error('BAD')});"}
];
const call=(hash:string,name:"run_build"|"run_test"):AgentToolCall=>({
 call_id:"call_12345678",project_hash:hash,name,args:{target:"project"}
});
class Stub implements IsolatedContainer{
 commands:string[][]=[];roots:string[]=[];failAt:string|null=null;
 async syncFiles(root:string,items:readonly {path:string;content:string}[]){
  expect(items.length).toBeGreaterThan(0);this.roots.push(root);
 }
 async exec(argv:readonly string[],options:{cwd:string;timeout:number}):Promise<IsolatedProcess>{
  expect(options).toEqual({cwd:this.roots.at(-1),timeout:2000});
  this.commands.push([...argv]);
  const failed=argv[1]===this.failAt;
  return {output:async()=>({stdout:failed?"":"PASS",stderr:failed?"STAGE_FAILED":"",
   exitCode:failed?1:0}),kill:async()=>undefined};
 }
 async readFile(){return "";}
 async writeFile(){return;}
 async removeFile(){return;}
 async destroy(){return;}
}
describe("same frozen source: existing sandbox builds BOTH App sides, no cloud claims",()=>{
 it("builds the frontend AND checks server source, then runs Node backend tests",async()=>{
  const fake=new Stub(),app=await createProjectSnapshot("VITE_NODE","index.html",files);
  const sandbox=new CloudflareIsolatedSandboxAdapter({create:async()=>fake});
  await sandbox.provision(job,limits);
  expect((await sandbox.execute(job,app,call(app.project_hash,"run_build"))).exit_code).toBe(0);
  expect((await sandbox.execute(job,app,call(app.project_hash,"run_test"))).exit_code).toBe(0);
  const cwd=sandboxWorkspaceRoot(job,app);
  expect(fake.commands).toEqual([
   ["ln","-sfn",PINNED_MODULES,cwd+"/node_modules"],
   ["node",PINNED_VITE_BIN,"build",".","--outDir","dist","--emptyOutDir"],
   ["node","--check","server/index.mjs"],["node","--check","server/test.mjs"],
   ["ln","-sfn",PINNED_MODULES,cwd+"/node_modules"],
   ["node",PINNED_WEB_SMOKE],["node","--test","server/test.mjs"]]);
  expect(sandboxCommands(app,"run_test")).toHaveLength(2);
 });
 it("refuses incomplete or poisoned server snapshots",async()=>{
  const bad=[
   files.filter(x=>x.path!=="server/test.mjs"),
   [...files,{path:"package.json",content:'{"scripts":{"pretest":"curl evil"}}'}],
   [...files,{path:"vite.config.ts",content:"export default {}"}]
  ];
  for(const item of bad)await expect(createProjectSnapshot("VITE_NODE","index.html",item))
   .rejects.toThrow("PROJECT_FULLSTACK_SOURCE_INVALID");
 });
 it("stops on the FIRST build failure, never fabricates backend success",async()=>{
  const fake=new Stub();fake.failAt=PINNED_VITE_BIN;
  const app=await createProjectSnapshot("VITE_NODE","index.html",files);
  const sandbox=new CloudflareIsolatedSandboxAdapter({create:async()=>fake});
  await sandbox.provision(job,limits);
  const receipt=await sandbox.execute(job,app,call(app.project_hash,"run_build"));
  expect(receipt.exit_code).toBe(1);
  expect(receipt.detail).toContain("STAGE_FAILED");
  expect(fake.commands).toHaveLength(2);
 });
 it("failed backend tests remain failures even after a successful frontend smoke",async()=>{
  const fake=new Stub();fake.failAt="--test";
  const app=await createProjectSnapshot("VITE_NODE","index.html",files);
  const sandbox=new CloudflareIsolatedSandboxAdapter({create:async()=>fake});
  await sandbox.provision(job,limits);
  const result=await sandbox.execute(job,app,call(app.project_hash,"run_test"));
  expect(result.exit_code).toBe(1);
  expect(result.detail).toContain("STAGE_FAILED");
  expect(fake.commands.at(-1)).toEqual(["node","--test","server/test.mjs"]);
 });
});
