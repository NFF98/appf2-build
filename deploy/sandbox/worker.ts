/**
 * Sprint 3.5 PRIVATE candidate container broker (NOT connected to public creation).
 * Uses Cloudflare Sandbox SDK 1.x Files and Durable Object container API.
 * Never passes APPf2 DB/model/Cloudflare secrets to the container.
 */
import {DurableObject,WorkflowEntrypoint} from "cloudflare:workers";
import {sandboxJobAllowed} from "../../src/platform/agent/private-sandbox-authorization.js";
import {validBuiltAssetRequest,builtAssetContentType,MAX_BUILT_ASSET_BYTES,
 viteCompiledAssetPaths,splitBuiltAsset,assembleBuiltAsset,MAX_BUILT_CACHE_FILES,
 type BuiltAssetRequest} from "../../src/platform/agent/private-built-artifact.js";
import type {WorkflowStep,WorkflowEvent} from "cloudflare:workers";
import {Files} from "@cloudflare/sandbox";
import {verifyProjectSnapshot,type ProjectSnapshot}
 from "../../src/platform/agent/project-workspace.js";
import {parseAgentToolCall,type AgentToolCall}
 from "../../src/platform/agent/agent-contract.js";
import {sha256CodeBytes} from "../../src/platform/blueprint/code-artifact-v2.js";
import {sandboxCommand,sandboxNeedsPinnedDeps,sandboxWorkspaceRoot,sandboxBuildResetArgv,PINNED_MODULES}
 from "../../src/platform/agent/sandbox-commands.js";
const JOB=/^[A-Za-z0-9_-]{8,80}$/u;
const MAX_BODY=4*1024*1024+128*1024;
const MAX_RUNTIME_MS=30000;
// Absolute emergency abuse fuse, NOT an 8-attempt product completion limit.
// Paid dispatch remains separately owner-approved and budget-fenced in Postgres.
const MAX_JOB_CALLS=512;
const MAX_WORKFLOW_BODY=64*1024;
const PAID_APPROVAL="OWNER_APPROVED_ONE_SHOT";
const BUILT_CACHE_MANIFEST="verified_compiled_assets_v1";
const builtCacheKey=(path:string,i:number)=>"compiled_v1:"+path+":"+i;
type BuiltCacheManifest={
 readonly project_hash:string;readonly build_call_id:string;
 readonly segments:Readonly<Record<string,number>>;
};
type Env={APPF2_SANDBOX_TOKEN:string;APPF2_SANDBOX_ALLOWED_JOB_ID:string;
 APPF2_PAID_CONTAINER_CONSENT?:string;APPF2_SP35_WORKFLOW_ENABLED?:string;
 APPF2_CONTAINER:DurableObjectNamespace<SandboxJob>;
 APPF2_WORKFLOW:Workflow<Task>};
type Task={job_id:string;project:ProjectSnapshot;call:AgentToolCall};
type Receipt={call_id:string;project_hash:string;exit_code:number|null;
 timed_out:boolean;detail:string;output_digest:string;runner_attestation:string};
function record(v:unknown):v is Record<string,unknown>{
 return typeof v==="object"&&v!==null&&!Array.isArray(v);
}
function bodyValid(x:unknown):x is Task{
 if(!record(x)||Object.keys(x).sort().join(",")!=="call,job_id,project"||
  typeof x.job_id!=="string"||!JOB.test(x.job_id)||!record(x.call)||
  !record(x.project))return false;
 return x.call.name==="run_build"||x.call.name==="run_test";
}
async function receipt(task:Task,code:number|null,timed_out:boolean,detail:string):Promise<Receipt>{
 const bounded=detail.slice(0,4096);
 return {call_id:task.call.call_id,project_hash:task.project.project_hash,
  exit_code:code,timed_out,detail:bounded,
  output_digest:await sha256CodeBytes(new TextEncoder().encode(bounded)),
  runner_attestation:"APPF2_ISOLATED_CLOUDFLARE_CONTAINER_V1"};
}
async function authorized(request:Request,secret:string):Promise<boolean>{
 const token=request.headers.get("Authorization")??"";
 if(secret.length<32||token.length!==secret.length+7||!token.startsWith("Bearer "))
  return false;
 const [a,b]=await Promise.all([secret,token.slice(7)].map(v=>
  crypto.subtle.digest("SHA-256",new TextEncoder().encode(v))));
 const x=new Uint8Array(a),y=new Uint8Array(b);
 let changed=0;
 for(let i=0;i<x.length;i++)changed|=x[i]^y[i];
 return changed===0;
}
export class SandboxJob extends DurableObject<Env>{
 private readonly files:Files;
 constructor(ctx:DurableObjectState,env:Env){
  super(ctx,env);
  if(!ctx.container)throw Error("SANDBOX_CONTAINER_BINDING_MISSING");
  this.files=new Files(ctx.container);
 }
 private async ready():Promise<void>{
  const c=this.ctx.container;
  if(!c)throw Error("SANDBOX_UNAVAILABLE");
  if(!c.running){
   c.start({image:c.images.workspace,enableInternet:false});
   await c.setInactivityTimeout(120000);
  }
 }
 /** Store only Vite-compiled public assets, never source or secrets.
  * One atomic storage.put commits chunks with the matching build identity.
  */
 private async saveCompiledAssets(task:Task,dir:string):Promise<void>{
  const index=new Uint8Array(await (await this.files.readFile(
   dir+"/dist/index.html")).arrayBuffer());
  const paths=viteCompiledAssetPaths(new TextDecoder("utf-8",{fatal:true}).decode(index));
  const entries:Record<string,Uint8Array|BuiltCacheManifest|string>={};
  const segments:Record<string,number>={};
  for(const path of paths){
   const bytes=path==="index.html"?index:
    new Uint8Array(await (await this.files.readFile(dir+"/dist/"+path)).arrayBuffer());
   const pieces=splitBuiltAsset(bytes);
   segments[path]=pieces.length;
   for(let i=0;i<pieces.length;i++)entries[builtCacheKey(path,i)]=pieces[i]!;
  }
  entries[BUILT_CACHE_MANIFEST]={
   project_hash:task.project.project_hash,build_call_id:task.call.call_id,segments
  };
  entries.verified_build_project_hash=task.project.project_hash;
  entries.verified_build_call_id=task.call.call_id;
  await this.ctx.storage.put(entries);
 }
 /** Read-only: never wakes a paid container, even after idle eviction.
  * Only exact verified latest build assets are returned.
  */
 // eslint-disable-next-line complexity -- Proven build, bounded SQLite chunks and legacy fallback are separate security gates.
 async readBuiltAsset(query:BuiltAssetRequest):Promise<Response>{
  if(!validBuiltAssetRequest(query))
   return new Response("Not Found",{status:404});
  const [project,callId,manifest]=await Promise.all([
   this.ctx.storage.get<string>("verified_build_project_hash"),
   this.ctx.storage.get<string>("verified_build_call_id"),
   this.ctx.storage.get<BuiltCacheManifest>(BUILT_CACHE_MANIFEST)]);
  if(project!==query.project_hash||callId!==query.build_call_id)
   return new Response("Not Found",{status:404});
  let bytes:Uint8Array;
  if(manifest?.project_hash===project&&manifest.build_call_id===callId){
   const count=manifest.segments?.[query.path];
   if(typeof count!=="number"||!Number.isSafeInteger(count)||count<1||count>32)
    return new Response("Not Found",{status:404});
   const chunks=await Promise.all(Array.from({length:count},(_,i)=>
    this.ctx.storage.get<Uint8Array>(builtCacheKey(query.path,i))));
   if(chunks.some(c=>!(c instanceof Uint8Array)))
    return new Response("Not Found",{status:404});
   try{bytes=assembleBuiltAsset(chunks as Uint8Array[]);}
   catch{return new Response("Not Found",{status:404});}
  }else{
   // Legacy pre-cache builds can be inspected only while their container runs.
   if(!this.ctx.container?.running)return new Response("Not Found",{status:404});
   const dir=sandboxWorkspaceRoot(query.job_id,{
    project_hash:query.project_hash
   } as ProjectSnapshot);
   const file=await this.files.readFile(dir+"/dist/"+query.path);
   bytes=new Uint8Array(await file.arrayBuffer());
  }
  if(bytes.byteLength===0||bytes.byteLength>MAX_BUILT_ASSET_BYTES)
   return new Response("Too Large",{status:413});
  return new Response(bytes,{
   headers:{"Content-Type":builtAssetContentType(query.path),
    "Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}
  });
 }
 /** A saved run_build may precede run_test by hours/days. A restarted
  * container has no dist directory: restore the exact hashed compiled bytes
  * from SQLite, never rebuild or trust model-supplied test fixtures.
  */
 private async restoreCompiledAssets(task:Task,dir:string,
  containerWasRunning:boolean):Promise<void>{
  const manifest=await this.ctx.storage.get<BuiltCacheManifest>(BUILT_CACHE_MANIFEST);
  if(!manifest||manifest.project_hash!==task.project.project_hash){
   if(containerWasRunning)return; // Pre-cache legacy build, still in memory.
   throw Error("SANDBOX_SAVED_BUILD_NOT_AVAILABLE");
  }
  const paths=Object.keys(manifest.segments);
  if(paths.length<2||paths.length>MAX_BUILT_CACHE_FILES||
   !paths.includes("index.html"))throw Error("SANDBOX_SAVED_BUILD_INVALID");
  await this.files.mkdir(dir+"/dist",{recursive:true});
  for(const path of paths){
   const response=await this.readBuiltAsset({
    job_id:task.job_id,project_hash:task.project.project_hash,
    build_call_id:manifest.build_call_id,path
   });
   if(response.status!==200)throw Error("SANDBOX_SAVED_BUILD_ASSET_MISSING");
   if(path.startsWith("assets/"))
    await this.files.mkdir(dir+"/dist/assets",{recursive:true});
   await this.files.writeFile(dir+"/dist/"+path,
    new Uint8Array(await response.arrayBuffer()));
  }
 }
 // eslint-disable-next-line complexity -- Strict checkpoint + immutable file checks before execution.
 async runTask(task:Task):Promise<Receipt>{
  if(!(await verifyProjectSnapshot(task.project))||
   !parseAgentToolCall(task.call)||
   task.call.project_hash!==task.project.project_hash)
   throw Error("SANDBOX_UNTRUSTED_INPUT");
  const key="call:"+task.call.call_id;
  const prior=await this.ctx.storage.get<{hash:string;status:string;receipt?:Receipt}>(key);
  const hash=await sha256CodeBytes(new TextEncoder().encode(
   JSON.stringify({project_hash:task.project.project_hash,call:task.call})));
  if(prior){
   if(prior.hash!==hash)throw Error("SANDBOX_REPLAY_MISMATCH");
   if(prior.status==="DONE"&&prior.receipt)return prior.receipt;
   throw Error("SANDBOX_RETRY_REQUIRES_RECONCILIATION");
  }
  const count=await this.ctx.storage.get<number>("job_call_count")??0;
  if(count>=MAX_JOB_CALLS)throw Error("SANDBOX_JOB_CALL_LIMIT");
  const command=sandboxCommand(task.project,task.call.name as "run_build"|"run_test");
  if(task.call.name==="run_test"){
   const priorBuild=await this.ctx.storage.get<string>("verified_build_project_hash");
   if(priorBuild!==task.project.project_hash)
    throw Error("SANDBOX_TEST_REQUIRES_MATCHING_SUCCESSFUL_BUILD");
  }
  await this.ctx.storage.put({[key]:{hash,status:"RUNNING"},job_call_count:count+1});
  if(task.call.name==="run_build"){
   await this.ctx.storage.delete("verified_build_project_hash");
   await this.ctx.storage.delete("verified_build_call_id");
  }
  const containerWasRunning=Boolean(this.ctx.container?.running);
  await this.ready();
  const dir=sandboxWorkspaceRoot(task.job_id,task.project);
  if(task.call.name==="run_build"){
   // Even identical source hashes can be built twice. A previous failed build,
   // test, or generated output must not make a fresh run falsely succeed.
   // Keep run_test on the SAME verified build tree (dist/ must remain available).
   const runner=this.ctx.container;
   if(!runner)throw Error("SANDBOX_CONTAINER_LOST");
   const reset=await runner.exec(sandboxBuildResetArgv(task.job_id,task.project),
    {cwd:"/workspace",timeout:5000});
   const cleared=await reset.output({encoding:"utf8",maxBytes:512,timeout:5000});
   if(cleared.exitCode!==0||cleared.timedOut)
    throw Error("SANDBOX_WORKSPACE_RESET_FAILED");
  }
  await this.files.mkdir(dir,{recursive:true});
  for(const f of task.project.files){
   const parts=f.path.split("/");
   if(parts.length>1)await this.files.mkdir(dir+"/"+parts.slice(0,-1).join("/"),
    {recursive:true});
   await this.files.writeFile(dir+"/"+f.path,f.content);
  }
  const container=this.ctx.container;
  if(!container)throw Error("SANDBOX_CONTAINER_LOST");
  if(sandboxNeedsPinnedDeps(task.project)){
   // The only dependency link is to the immutable image layer. No npm install,
   // user-supplied package scripts or external network are invoked.
   const linked=await container.exec(["ln","-sfn",PINNED_MODULES,dir+"/node_modules"],
    {cwd:dir,timeout:5000});
   const linking=await linked.output({encoding:"utf8",maxBytes:512,timeout:5000});
   if(linking.exitCode!==0||linking.timedOut)
    throw Error("SANDBOX_PINNED_DEPENDENCIES_MISSING");
  }
  if(task.call.name==="run_test"&&task.project.profile==="VITE_WEB")
   await this.restoreCompiledAssets(task,dir,containerWasRunning);
  const proc=await container.exec(command,{cwd:dir,timeout:MAX_RUNTIME_MS});
  let result:Receipt;
  try{
   const out=await proc.output({encoding:"utf8",maxBytes:2048,timeout:MAX_RUNTIME_MS});
   if(out.timedOut)await proc.kill(9);
   result=await receipt(task,out.exitCode,Boolean(out.timedOut),
    String(out.stdout??"")+"\n"+String(out.stderr??""));
  }catch{
   await proc.kill(9).catch(()=>undefined);
   result=await receipt(task,null,true,"SANDBOX_TIMEOUT_OR_CRASH");
  }
  if(task.call.name==="run_build"&&result.exit_code===0&&!result.timed_out){
   if(task.project.profile==="VITE_WEB"){
    try{await this.saveCompiledAssets(task,dir);}
    catch{
     // No durable compiled output means no reusable App or Browser QA PASS.
     result=await receipt(task,1,false,"BUILT_ASSET_PERSIST_FAILED");
    }
   }else await this.ctx.storage.put({
    verified_build_project_hash:task.project.project_hash,
    verified_build_call_id:task.call.call_id
   });
  }
  await this.ctx.storage.put(key,{hash,status:"DONE",receipt:result});
  return result;
 }
}
/**
 * Durable step runtime. Workflows persist successful steps; disabling automatic
 * retries ensures ambiguous paid execution never silently starts again.
 * Durable Object also fences identical call IDs and limits per-job launches.
 */
export class CandidateAgentWorkflow extends WorkflowEntrypoint<Env,Task>{
 async run(event:WorkflowEvent<Task>,step:WorkflowStep):Promise<Receipt>{
  const task=event.payload;
  const accepted=await step.do("verify-private-candidate",async()=>{
   if(this.env.APPF2_PAID_CONTAINER_CONSENT!==PAID_APPROVAL||
    !bodyValid(task)||
    !sandboxJobAllowed(this.env.APPF2_SANDBOX_ALLOWED_JOB_ID,task.job_id)||
    !parseAgentToolCall(task.call)||!(await verifyProjectSnapshot(task.project))||
    task.call.project_hash!==task.project.project_hash)
    throw Error("WORKFLOW_CANDIDATE_REJECTED");
   return {job_id:task.job_id,call_id:task.call.call_id};
  });
  const receipt=await step.do("bounded-isolated-execution",
   {retries:{limit:0}},async()=>{
    const stub=this.env.APPF2_CONTAINER.getByName(accepted.job_id);
    return stub.runTask(task);
   });
  return receipt;
 }
}
/** Owner-scoped read-only status: never starts a Workflow or container. */
async function workflowStatus(request:Request,env:Env,url:URL):Promise<Response>{
 if(!(await authorized(request,env.APPF2_SANDBOX_TOKEN))||
   !env.APPF2_SANDBOX_ALLOWED_JOB_ID||url.search)
  return new Response("Not Found",{status:404});
 const id=url.pathname.slice("/internal/workflow/status/".length);
 const match=/^([0-9a-f-]{36})-(call_[A-Za-z0-9_-]{4,128})$/iu.exec(id);
 if(!match||!sandboxJobAllowed(env.APPF2_SANDBOX_ALLOWED_JOB_ID,match[1]))
  return new Response("Not Found",{status:404});
 try{
  const instance=await env.APPF2_WORKFLOW.get(id);
  const state=await instance.status();
  // Never expose raw Workflow output, user source or sandbox diagnostics here.
  return Response.json({id,status:String(state.status).slice(0,40)},
   {headers:{"Cache-Control":"no-store"}});
 }catch{return new Response("Not Found",{status:404});}
}
export default {
 // eslint-disable-next-line complexity -- All private paid-execution and replay gates remain fail-closed.
 async fetch(request:Request,env:Env):Promise<Response>{
  const url=new URL(request.url);
  if(request.method==="GET"&&url.pathname.startsWith("/internal/workflow/status/"))
   return workflowStatus(request,env,url);
  if(request.method==="POST"&&url.pathname==="/internal/build-asset"&&!url.search){
   if(!(await authorized(request,env.APPF2_SANDBOX_TOKEN)))
    return new Response("Not Found",{status:404});
   if(Number(request.headers.get("Content-Length")??0)>1024)
    return new Response("Too Large",{status:413});
   const body=await request.text();
   if(body.length>1024)return new Response("Too Large",{status:413});
   let query:unknown;
   try{query=JSON.parse(body);}catch{return new Response("Bad Request",{status:400});}
   if(!validBuiltAssetRequest(query)||
    !sandboxJobAllowed(env.APPF2_SANDBOX_ALLOWED_JOB_ID,query.job_id))
    return new Response("Not Found",{status:404});
   try{
    return await env.APPF2_CONTAINER.getByName(query.job_id).readBuiltAsset(query);
   }catch{return new Response("Not Found",{status:404});}
  }
  if(request.method!=="POST"||
   !["/internal/execute","/internal/workflow/start"].includes(url.pathname)||url.search)
   return new Response("Not Found",{status:404});
  if(env.APPF2_PAID_CONTAINER_CONSENT!==PAID_APPROVAL)return new Response("Not Found",{status:404});
  if(!(await authorized(request,env.APPF2_SANDBOX_TOKEN)))
   return new Response("Not Found",{status:404});
  const maxBody=url.pathname==="/internal/workflow/start"?MAX_WORKFLOW_BODY:MAX_BODY;
  if(Number(request.headers.get("Content-Length")??0)>maxBody)
   return new Response("Too Large",{status:413});
  const raw=await request.text();
  if(new TextEncoder().encode(raw).length>maxBody)return new Response("Too Large",{status:413});
  let parsed:unknown;
  try{parsed=JSON.parse(raw);}catch{return new Response("Bad Request",{status:400});}
  if(!bodyValid(parsed))return new Response("Bad Request",{status:400});
  if(!sandboxJobAllowed(env.APPF2_SANDBOX_ALLOWED_JOB_ID,parsed.job_id))
   return new Response("Not Found",{status:404});
  if(url.pathname==="/internal/workflow/start"){
   if(env.APPF2_SP35_WORKFLOW_ENABLED!=="OWNER_APPROVED_WORKFLOW")
    return new Response("Not Found",{status:404});
   const id=parsed.job_id+"-"+parsed.call.call_id;
   try{
    const instance=await env.APPF2_WORKFLOW.create({id,params:parsed});
    return Response.json({id:instance.id,status:"SUBMITTED"},
     {status:202,headers:{"Cache-Control":"no-store"}});
   }catch{
    // Do not automatically create a second (potentially billable) execution.
    return Response.json({error:"WORKFLOW_ALREADY_EXISTS_OR_UNAVAILABLE"},
     {status:409,headers:{"Cache-Control":"no-store"}});
   }
  }
  try{
   const stub=env.APPF2_CONTAINER.getByName(parsed.job_id);
   const result=await stub.runTask(parsed);
   return Response.json({data:result},{headers:{"Cache-Control":"no-store"}});
  }catch{return Response.json({error:"SANDBOX_FAILED_CLOSED"},{status:409});}
 }
} satisfies ExportedHandler<Env>;
