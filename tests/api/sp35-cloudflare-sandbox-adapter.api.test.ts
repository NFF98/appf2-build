import {describe,it,expect} from "vitest";
import {createProjectSnapshot} from "../../src/platform/agent/project-workspace.js";
import {CloudflareIsolatedSandboxAdapter,type IsolatedContainer,
 type IsolatedProcess,type IsolatedContainerFactory}
 from "../../src/platform/agent/cloudflare-sandbox-adapter.js";
import type {SandboxLimits} from "../../src/platform/agent/sandbox-adapter.js";
import type {AgentToolName,AgentToolCall} from "../../src/platform/agent/agent-contract.js";
import {PINNED_VITE_BIN,PINNED_MODULES,PINNED_WEB_SMOKE,sandboxCommand}
 from "../../src/platform/agent/sandbox-commands.js";
const job="job_12345678";
const limits:SandboxLimits={wall_time_ms:2000,cpu_millis:1000,
 memory_mb:128,disk_mb:256,network_policy:"DENY_ALL",allowed_hosts:[]};
class Stub implements IsolatedContainer{
 commands:readonly (readonly string[])[]=[];
 synced=false;
 removed:string[]=[];
 killed=false;
 timedOut=false;
 async syncFiles(root:string,files:readonly {path:string;content:string}[]){
  expect(root).toBe("/workspace/appf2_"+job);
  expect(files.length).toBe(3);
  this.synced=true;
 }
 async exec(argv:readonly string[],options:{cwd:string;timeout:number}):Promise<IsolatedProcess>{
  expect(options).toEqual({cwd:"/workspace/appf2_"+job,timeout:2000});
  this.commands=[...this.commands,argv];
  return {output:async()=>{
   if(this.timedOut)throw Error("timeout");
   return {stdout:"BUILD PASSED",stderr:"",exitCode:0};
  },kill:async()=>{this.killed=true;}};
 }
 async readFile(){return "content";}
 async writeFile(path:string,content:string){expect(path).toContain("/src/main.ts");expect(content).toBe("new");}
 async removeFile(path:string){this.removed.push(path);}
 async destroy(){this.synced=false;}
}
const project=()=>createProjectSnapshot("VITE_WEB","index.html",[
 {path:"index.html",content:"<main></main>"},
 {path:"package.json",content:'{"scripts":{"build":"vite build"}}'},
 {path:"src/main.ts",content:"console.log(1)"}]);
const call=(name:AgentToolName,hash:string,args:Record<string,string>):AgentToolCall=>({
 call_id:"call_12345678",name,project_hash:hash,args
});
describe("Cloudflare Sandbox 1.x command adapter (offline fake, no cloud claim)",()=>{
 it("executes bounded argv inside per-job container without shell or egress",async()=>{
  const fake=new Stub();
  const factory:IsolatedContainerFactory={create:async(id,config)=>{
   expect(id).toBe(job);expect(config.network_policy).toBe("DENY_ALL");return fake;
  }};
  const adapter=new CloudflareIsolatedSandboxAdapter(factory);
  const app=await project();
  await expect(adapter.provision(job,{...limits,network_policy:"ALLOWLIST_ONLY",
   allowed_hosts:["example.com"]})).rejects.toThrow("SANDBOX_NETWORK_MUST_BE_DISABLED");
  expect((await adapter.provision(job,limits)).sandbox_id).toBe(job);
  await expect(adapter.provision(job,limits)).rejects.toThrow("SANDBOX_ALREADY_PROVISIONED");
  const receipt=await adapter.execute(job,app,call("run_build",app.project_hash,{target:"project"}));
  expect(receipt.exit_code).toBe(0);
  expect(receipt.detail).toContain("BUILD PASSED");
  expect(receipt.output_digest).toMatch(/^sha256:/u);
  expect(fake.commands).toEqual([
   ["ln","-sfn",PINNED_MODULES,"/workspace/appf2_"+job+"/node_modules"],
   ["node",PINNED_VITE_BIN,"build",".","--outDir","dist","--emptyOutDir"]
  ]);
  expect(sandboxCommand(app,"run_test")).toEqual(["node",PINNED_WEB_SMOKE]);
  await adapter.destroy(job);
  await expect(adapter.execute(job,app,call("run_build",app.project_hash,{target:"project"})))
   .rejects.toThrow("SANDBOX_NOT_OWNED");
 });
 it("refuses forged commands, stale project bytes and unsafe paths",async()=>{
  const fake=new Stub();
  const adapter=new CloudflareIsolatedSandboxAdapter({create:async()=>fake});
  const app=await project();
  await adapter.provision(job,limits);
  await expect(adapter.execute(job,app,call("run_build",app.project_hash,{target:";rm -rf /"})))
   .rejects.toThrow("SANDBOX_INVALID_PROJECT_OR_CALL");
  await expect(adapter.execute(job,app,call("exec" as AgentToolName,app.project_hash,{command:"curl metadata"})))
   .rejects.toThrow("SANDBOX_INVALID_PROJECT_OR_CALL");
  await expect(adapter.execute(job,{...app,files:[...app.files,{
   path:"../secrets",content:"x",bytes:1,hash:app.project_hash}]},
   call("run_build",app.project_hash,{target:"project"})))
   .rejects.toThrow("SANDBOX_INVALID_PROJECT_OR_CALL");
  await expect(adapter.execute(job,app,call("write_file",app.project_hash,{
   path:"src/main.ts",content:"new",previous_hash:"sha256:"+"0".repeat(64)})))
   .rejects.toThrow("SANDBOX_STALE_FILE");
  expect(fake.commands).toHaveLength(0);
 });
 it("supports staged file edits with optimistic hash, without automatic publication",async()=>{
  const fake=new Stub();
  const adapter=new CloudflareIsolatedSandboxAdapter({create:async()=>fake});
  const app=await project();
  await adapter.provision(job,limits);
  const old=app.files.find(f=>f.path==="src/main.ts")!;
  const write=await adapter.execute(job,app,call("write_file",app.project_hash,{
   path:"src/main.ts",content:"new",previous_hash:old.hash}));
  expect(write.detail).toContain("STAGED_NOT_PUBLISHED");
  const del=await adapter.execute(job,app,call("delete_file",app.project_hash,{
   path:"src/main.ts"}));
  expect(del.detail).toContain("STAGED_NOT_PUBLISHED");
  expect(fake.removed).toHaveLength(1);
 });
 it("rejects unsupported Python profile rather than pretending to run tests",async()=>{
  const app=await createProjectSnapshot("PYTHON","main.py",[
   {path:"main.py",content:"print('hi')"}
  ]);
  expect(()=>sandboxCommand(app,"run_build")).toThrow("SANDBOX_PROFILE_NOT_READY");
  expect(()=>sandboxCommand(app,"run_test")).toThrow("SANDBOX_PROFILE_NOT_READY");
 });
 it("kills timed-out processes, returns failure evidence not PASS",async()=>{
  const fake=new Stub();fake.timedOut=true;
  const adapter=new CloudflareIsolatedSandboxAdapter({create:async()=>fake});
  const app=await project();
  await adapter.provision(job,limits);
  const r=await adapter.execute(job,app,call("run_test",app.project_hash,{target:"project"}));
  expect(r.timed_out).toBe(true);
  expect(r.exit_code).toBeNull();
  expect(fake.killed).toBe(true);
 });
});
