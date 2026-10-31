/** One-shot GitHub Actions dispatch: ONLY a short encrypted source ticket is
 * sent to the public repo. Actual source is fetched privately by verified OIDC.
 * No paid AI, Containers, Browser Run, package installation or DB mutation here.
 */
import {recoverAgentJob} from "../platform/agent/durable-agent-service.js";
import {sealFreeCiTicket} from "../platform/agent/free-ci-ticket.js";
import type {AgentJobExecutor} from "../platform/agent/postgres-agent-jobs.js";
const OWNER=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export type FreeCiDispatchInput={readonly anonymous_id:string;
 readonly explicit_free_ci_consent:true};
export function validFreeCiDispatchInput(x:unknown):x is FreeCiDispatchInput{
 if(!x||typeof x!=="object"||Array.isArray(x))return false;
 const o=x as Record<string,unknown>;
 return Object.keys(o).sort().join(",")==="anonymous_id,explicit_free_ci_consent"&&
  typeof o.anonymous_id==="string"&&OWNER.test(o.anonymous_id)&&
  o.explicit_free_ci_consent===true;
}
export async function dispatchFreeCiJob(input:FreeCiDispatchInput,ctx:{
 db:AgentJobExecutor;jobId:string;ownerThumb:string;nowMs:number;
 token:string;ticketSecret:string;
 send?:(url:string,init:RequestInit)=>Promise<Response>;
}):Promise<{status:"FREE_CI_QUEUED";app_published:false}>{
 if(ctx.token.length<24||!ctx.token.startsWith("github_pat_")&&
  !ctx.token.startsWith("ghp_"))throw Error("FREE_CI_GITHUB_TOKEN_NOT_CONFIGURED");
 const owner=(await ctx.db.query<{job_id:string}>(
  "SELECT job_id::text FROM public.appf2_agent_job "+
  "WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid "+
  "AND owner_key_thumbprint=$3::text LIMIT 1",
  [ctx.jobId,input.anonymous_id,ctx.ownerThumb])).rows[0];
 if(owner?.job_id!==ctx.jobId)throw Error("FREE_CI_NOT_OWNER");
 const project=await recoverAgentJob(ctx.db,ctx.jobId,input.anonymous_id);
 if(!project||project.project.revision<2||
   project.job.job_state==="CREATED"||
   project.project.files.length>64||
   project.project.files.reduce((sum,f)=>sum+f.bytes,0)>1024*1024)
  throw Error("FREE_CI_NO_GENERATED_PROJECT");
 const ticket=await sealFreeCiTicket({job_id:ctx.jobId,owner:input.anonymous_id,
  project_hash:project.project.project_hash},ctx.ticketSecret,ctx.nowMs);
 const url="https://api.github.com/repos/NFF98/appf2-build/actions/workflows/"+
  "sp35-staging-only.yml/dispatches";
 const send=ctx.send??fetch;
 const response=await send(url,{method:"POST",headers:{
  Authorization:"Bearer "+ctx.token,Accept:"application/vnd.github+json",
  "X-GitHub-Api-Version":"2022-11-28",
  "Content-Type":"application/json"},
  body:JSON.stringify({ref:"product/sprint-3.5-complex-intent-recovery-20261026",
   inputs:{ticket}}),signal:globalThis.AbortSignal.timeout(12000)});
 if(response.status!==204)throw Error("FREE_CI_DISPATCH_HTTP_"+response.status);
 return {status:"FREE_CI_QUEUED",app_published:false};
}
