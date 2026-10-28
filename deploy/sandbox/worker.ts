/**
 * Sprint 3.5 PRIVATE candidate container broker (NOT connected to public creation).
 * Uses Cloudflare Sandbox SDK 1.x Files and Durable Object container API.
 * Never passes APPf2 DB/model/Cloudflare secrets to the container.
 */
import {DurableObject,WorkflowEntrypoint} from "cloudflare:workers";
import type {WorkflowStep,WorkflowEvent} from "cloudflare:workers";
import {Files} from "@cloudflare/sandbox";
import {verifyProjectSnapshot,type ProjectSnapshot}
 from "../../src/platform/agent/project-workspace.js";
import {parseAgentToolCall,type AgentToolCall}
 from "../../src/platform/agent/agent-contract.js";
import {sha256CodeBytes} from "../../src/platform/blueprint/code-artifact-v2.js";
const JOB=/^[A-Za-z0-9_-]{8,80}$/u;
const MAX_BODY=4*1024*1024+128*1024;
const MAX_RUNTIME_MS=30000;
const MAX_JOB_CALLS=8;
const MAX_WORKFLOW_BODY=64*1024;
const PAID_APPROVAL="OWNER_APPROVED_ONE_SHOT";
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
function safeCommand(project:ProjectSnapshot,tool:"run_build"|"run_test"):string[]{
 // First cloud profile: Node ESM only, no npm install, shell or package scripts.
 if(project.profile!=="NODE"||!project.entrypoint.endsWith(".mjs"))
  throw Error("SANDBOX_PROFILE_NOT_READY");
 return tool==="run_build"?["node","--check",project.entrypoint]:
  ["node",project.entrypoint];
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
  const command=safeCommand(task.project,task.call.name as "run_build"|"run_test");
  await this.ctx.storage.put({[key]:{hash,status:"RUNNING"},job_call_count:count+1});
  await this.ready();
  const dir="/workspace/appf2_"+task.job_id;
  await this.files.mkdir(dir,{recursive:true});
  for(const f of task.project.files){
   const parts=f.path.split("/");
   if(parts.length>1)await this.files.mkdir(dir+"/"+parts.slice(0,-1).join("/"),
    {recursive:true});
   await this.files.writeFile(dir+"/"+f.path,f.content);
  }
  const container=this.ctx.container;
  if(!container)throw Error("SANDBOX_CONTAINER_LOST");
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
    !bodyValid(task)||task.job_id!==this.env.APPF2_SANDBOX_ALLOWED_JOB_ID||
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
export default {
 async fetch(request:Request,env:Env):Promise<Response>{
  const url=new URL(request.url);
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
  if(!env.APPF2_SANDBOX_ALLOWED_JOB_ID||parsed.job_id!==env.APPF2_SANDBOX_ALLOWED_JOB_ID)
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
