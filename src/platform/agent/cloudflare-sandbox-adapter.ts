/**
 * Sprint 3.5 isolated Container broker adapter, for Cloudflare Sandbox 1.x argv API.
 * The host Worker may only call this with a verified ProjectSnapshot. The injected
 * runtime MUST be a per-job container with enableInternet=false and no platform keys.
 * Never run untrusted source on a GitHub Runner or inside the APPf2 Worker.
 */
import {parseAgentToolCall,type AgentToolCall} from "./agent-contract.js";
import {validateSandboxLimits,type CloudSandboxAdapter,type SandboxLimits,
 type SandboxEvidence} from "./sandbox-adapter.js";
import {verifyProjectSnapshot,type ProjectSnapshot} from "./project-workspace.js";
import {sha256CodeBytes} from "../blueprint/code-artifact-v2.js";
import {sandboxCommand,sandboxNeedsPinnedDeps,sandboxWorkspaceRoot,PINNED_MODULES} from "./sandbox-commands.js";
export interface IsolatedProcess{
 output(options:{encoding:"utf8";maxBytes:number;timeout:number}):Promise<{
  stdout:string;stderr:string;exitCode:number|null;timedOut?:boolean;truncated?:boolean
 }>;
 kill(signal?:number):Promise<void>;
}
export interface IsolatedContainer{
 /** Implementation must write into one instance's private filesystem. */
 syncFiles(root:string,files:readonly {path:string;content:string}[]):Promise<void>;
 exec(argv:readonly string[],options:{cwd:string;timeout:number}):Promise<IsolatedProcess>;
 readFile(path:string):Promise<string>;
 writeFile(path:string,content:string):Promise<void>;
 removeFile(path:string):Promise<void>;
 destroy():Promise<void>;
}
export interface IsolatedContainerFactory{
 /** Mandatory verified isolation: separate container identity for every job. */
 create(job_id:string,limits:SandboxLimits):Promise<IsolatedContainer>;
}
const JOB=/^[A-Za-z0-9_-]{8,80}$/u;
const RUNNER_ATTESTATION="APPF2_CLOUDFLARE_SANDBOX_V1";
async function evidence(call:AgentToolCall,code:number|null,timedOut:boolean,
 detail:string):Promise<SandboxEvidence>{
 const clipped=detail.slice(0,4096);
 return {call_id:call.call_id,project_hash:call.project_hash,exit_code:code,
  timed_out:timedOut,detail:clipped,
  output_digest:await sha256CodeBytes(new TextEncoder().encode(clipped)),
  runner_attestation:RUNNER_ATTESTATION};
}
/** No arbitrary model shell strings, dynamic argv or network-enabled profiles. */
export class CloudflareIsolatedSandboxAdapter implements CloudSandboxAdapter{
 private readonly containers=new Map<string,IsolatedContainer>();
 private readonly limits=new Map<string,SandboxLimits>();
 constructor(private readonly factory:IsolatedContainerFactory){}
 async provision(job_id:string,limits:SandboxLimits):Promise<{sandbox_id:string}>{
  if(!JOB.test(job_id))throw Error("SANDBOX_JOB_ID_INVALID");
  validateSandboxLimits(limits);
  if(limits.network_policy!=="DENY_ALL"||limits.allowed_hosts.length!==0)
   throw Error("SANDBOX_NETWORK_MUST_BE_DISABLED");
  if(this.containers.has(job_id))throw Error("SANDBOX_ALREADY_PROVISIONED");
  const runtime=await this.factory.create(job_id,limits);
  this.containers.set(job_id,runtime);
  this.limits.set(job_id,limits);
  return {sandbox_id:job_id};
 }
 // eslint-disable-next-line complexity -- Every tool operation gets an independently bounded path.
 async execute(sandbox_id:string,project:ProjectSnapshot,call:AgentToolCall):Promise<SandboxEvidence>{
  const runtime=this.containers.get(sandbox_id);
  const limits=this.limits.get(sandbox_id);
  if(!runtime||!limits)throw Error("SANDBOX_NOT_OWNED");
  if(!(await verifyProjectSnapshot(project))||call.project_hash!==project.project_hash||
    !parseAgentToolCall(call))throw Error("SANDBOX_INVALID_PROJECT_OR_CALL");
  const root=sandboxWorkspaceRoot(sandbox_id,project);
  const fileName=call.args.path;
  const file=project.files.find(f=>f.path===fileName);
  if(call.name==="read_file"){
   if(!file)throw Error("SANDBOX_FILE_MISSING");
   return evidence(call,0,false,file.content);
  }
  if(call.name==="write_file"){
   if(!file&&call.args.previous_hash!=="")throw Error("SANDBOX_STALE_FILE");
   if(file&&call.args.previous_hash!==file.hash)throw Error("SANDBOX_STALE_FILE");
   await runtime.syncFiles(root,project.files);
   await runtime.writeFile(root+"/"+fileName,call.args.content);
   return evidence(call,0,false,"WRITE_STAGED_NOT_PUBLISHED");
  }
  if(call.name==="delete_file"){
   if(!file)throw Error("SANDBOX_FILE_MISSING");
   await runtime.syncFiles(root,project.files);
   await runtime.removeFile(root+"/"+fileName);
   return evidence(call,0,false,"DELETE_STAGED_NOT_PUBLISHED");
  }
  if(call.name==="read_diagnostics")return evidence(call,0,false,"NO_DIAGNOSTICS");
  if(call.name!=="run_build"&&call.name!=="run_test")throw Error("SANDBOX_TOOL_UNSUPPORTED");
  await runtime.syncFiles(root,project.files);
  if(sandboxNeedsPinnedDeps(project)){
   // Link preinstalled read-only image dependencies; no npm install or user scripts.
   const link=await runtime.exec(["ln","-sfn",PINNED_MODULES,root+"/node_modules"],
    {cwd:root,timeout:Math.min(5000,limits.wall_time_ms)});
   const result=await link.output({encoding:"utf8",maxBytes:512,timeout:Math.min(5000,limits.wall_time_ms)});
   if(result.exitCode!==0||result.timedOut)
    throw Error("SANDBOX_PINNED_DEPENDENCIES_MISSING");
  }
  const proc=await runtime.exec(sandboxCommand(project,call.name),{
   cwd:root,timeout:limits.wall_time_ms
  });
  try{
   const out=await proc.output({encoding:"utf8",maxBytes:2048,timeout:limits.wall_time_ms});
   if(out.timedOut)await proc.kill(9);
   return evidence(call,out.exitCode,Boolean(out.timedOut),
    (out.stdout+"\n"+out.stderr).slice(0,4096));
  }catch{
   await proc.kill(9).catch(()=>undefined);
   return evidence(call,null,true,"SANDBOX_PROCESS_TIMEOUT_OR_CRASH");
  }
 }
 async destroy(sandbox_id:string):Promise<void>{
  const runtime=this.containers.get(sandbox_id);
  this.containers.delete(sandbox_id);
  this.limits.delete(sandbox_id);
  if(runtime)await runtime.destroy();
 }
}
