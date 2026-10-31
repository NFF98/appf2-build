/** Sprint 3.5: private, once-claimed GPT-6 runner request/result transport.
 * Only a GitHub-hosted workflow with signed RS256 OIDC + a phase-bound
 * AES-GCM ticket can receive the original provider request.
 * No source/prompt, owner UUID or API key enters workflow_dispatch inputs.
 */
import {verifiedLiveFreeCiOidcRunId} from "./free-ci-oidc.js";
import {openAiRunnerTicket,aiTicketScopeHash}
 from "../platform/agent/free-ai-runner-ticket.js";
import {WorkerPostgresExecutor} from "../platform/blueprint/worker-postgres-executor.js";
import {getModelCall,saveModelBackgroundId,completeModelCall}
 from "../platform/agent/postgres-model-calls.js";
import type {Appf2WorkerEnv} from "./worker-composition.js";
export const AI_RUNNER_SOURCE="/api/v1/internal/free-ai-runner/source";
export const AI_RUNNER_RESULT="/api/v1/internal/free-ai-runner/result";
export const AI_RUNNER_AUDIENCE="appf2-sp35-gpt6-model-runner-v1";
const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{
 status,headers:{"Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"private, no-store"}});
const denied=()=>json(404,{error:"FREE_AI_RUNNER_NOT_AUTHORIZED"});
const MODEL_ID=/^resp_[A-Za-z0-9_-]{6,160}$/u;
type RunnerRow={job_id:string;owner_anonymous_id:string;call_key:string;
 request_hash:string;model:string;request_json:unknown;
 runner_run_id:string|null;project_hash:string};
type Session={row:RunnerRow;db:WorkerPostgresExecutor;
 runId:string;ticket:string};
function exact(x:unknown,keys:readonly string[]):x is Record<string,unknown>{
 return typeof x==="object"&&x!==null&&!Array.isArray(x)&&
  Object.keys(x).sort().join(",")===keys.slice().sort().join(",");
}
// eslint-disable-next-line complexity -- OIDC, AES scope, immutable phase and owner checks all fail closed.
async function session(request:Request,url:URL,env:Appf2WorkerEnv,
 nowMs:number,raw:string):Promise<Session|null>{
 if(env.APPF2_AGENT_FREE_ONLY!=="1"||
  env.APPF2_FREE_AI_GENERATION_ENABLED!=="1"||
  request.method!=="POST"||Boolean(url.search)||
  request.headers.get("Content-Type")?.split(";")[0]!=="application/json")
  return null;
 const bearer=request.headers.get("Authorization")??"";
 if(!bearer.startsWith("Bearer ")||bearer.length>12020)return null;
 const token=await verifiedLiveFreeCiOidcRunId(
  bearer.slice(7),nowMs,AI_RUNNER_AUDIENCE);
 if(!token)return null;
 let body:unknown;
 try{body=JSON.parse(raw);}catch{return null;}
 if(typeof body!=="object"||body===null||Array.isArray(body)||
  typeof (body as {ticket?:unknown}).ticket!=="string")return null;
 const ticket=(body as {ticket:string}).ticket;
 const scope=await openAiRunnerTicket(ticket,
  env.APPF2_IDENTITY_COOKIE_SECRET,nowMs);
 if(!scope)return null;
 const db=new WorkerPostgresExecutor(env.HYPERDRIVE_FRESH,
  {anonymousId:scope.owner,intentId:null});
 try{
  const q=await db.query<RunnerRow>(`SELECT r.job_id::text,
   r.owner_anonymous_id::text,r.call_key,r.request_hash,r.model,
   r.request_json,r.runner_run_id,j.project_hash
   FROM public.appf2_agent_model_runner_request r
   JOIN public.appf2_agent_job j ON j.job_id=r.job_id
   WHERE r.job_id=$1::uuid AND r.owner_anonymous_id=$2::uuid
   AND r.runner_run_id IS NULL
   AND EXISTS(SELECT 1 FROM public.appf2_agent_model_call m
    WHERE m.job_id=r.job_id AND m.call_key=r.call_key
     AND m.status='IN_FLIGHT') LIMIT 2`,
   [scope.job_id,scope.owner]);
  if(q.rows.length!==1){await db.close();return null;}
  const row=q.rows[0];
  if(row.job_id!==scope.job_id||row.owner_anonymous_id!==scope.owner||
   row.model!=="gpt-6.1-sol"||row.runner_run_id!==null||
   scope.project_hash!==await aiTicketScopeHash({
    project_hash:row.project_hash,call_key:row.call_key,
    request_hash:row.request_hash})){
   await db.close();return null;
  }
  return {db,row,runId:token,ticket};
 }catch{await db.close();return null;}
}
export async function routeFreeAiRunnerSource(request:Request,url:URL,
 env:Appf2WorkerEnv,nowMs:number):Promise<Response|undefined>{
 if(url.pathname!==AI_RUNNER_SOURCE)return undefined;
 if(Number(request.headers.get("Content-Length")??0)>3000)return denied();
 const raw=await request.text();
 if(raw.length>3000)return denied();
 const scope=await session(request,url,env,nowMs,raw);
 if(!scope)return denied();
 try{
  if(!exact(JSON.parse(raw),["ticket"]))return denied();
  const owned=await scope.db.query<{call_key:string}>(`UPDATE
   public.appf2_agent_model_runner_request SET runner_run_id=$4::text
   WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid
   AND call_key=$3::text AND runner_run_id IS NULL
   RETURNING call_key`,[scope.row.job_id,scope.row.owner_anonymous_id,
    scope.row.call_key,scope.runId]);
  if(owned.rows[0]?.call_key!==scope.row.call_key)return denied();
  return json(200,{data:{model:"gpt-6.1-sol",
   request:scope.row.request_json,call_key:scope.row.call_key}});
 }catch{return denied();}
 finally{await scope.db.close();}
}
// eslint-disable-next-line complexity -- No individual trust check can be omitted.
export async function routeFreeAiRunnerResult(request:Request,url:URL,
 env:Appf2WorkerEnv,nowMs:number):Promise<Response|undefined>{
 if(url.pathname!==AI_RUNNER_RESULT)return undefined;
 if(Number(request.headers.get("Content-Length")??0)>460000)return denied();
 const raw=await request.text();
 if(raw.length>460000)return denied();
 let parsed:unknown;
 try{parsed=JSON.parse(raw);}catch{return denied();}
 if(!exact(parsed,["ticket","kind","response_id","response"])||
  (parsed.kind!=="ACK"&&parsed.kind!=="FINISHED")||
  typeof parsed.response_id!=="string"||!MODEL_ID.test(parsed.response_id))
  return denied();
 const scope=await sessionResult(request,url,env,nowMs,parsed.ticket);
 if(!scope)return denied();
 try{
  const row=scope.row;
  const model=await getModelCall(scope.db,row.job_id,
   row.owner_anonymous_id,row.call_key);
  if(!model||model.status!=="IN_FLIGHT")return denied();
  if(parsed.kind==="ACK"){
   if(parsed.response!==null)return denied();
   await saveModelBackgroundId(scope.db,model,parsed.response_id);
   return json(200,{data:{status:"ACK_SAVED"}});
  }
  const payload=parsed.response as {id?:unknown;status?:unknown;
   usage?:{input_tokens?:unknown;output_tokens?:unknown}}|null;
  if(payload?.id!==parsed.response_id||payload.status!=="completed"||
   !Number.isSafeInteger(payload.usage?.input_tokens)||
   !Number.isSafeInteger(payload.usage?.output_tokens))return denied();
  const saved=(await scope.db.query<{response_id:string}>(`SELECT response_id
   FROM public.appf2_agent_model_background_ref WHERE job_id=$1::uuid
   AND owner_anonymous_id=$2::uuid AND call_key=$3::text LIMIT 1`,
   [row.job_id,row.owner_anonymous_id,row.call_key])).rows[0];
  if(saved?.response_id!==parsed.response_id)return denied();
  await completeModelCall(scope.db,model,payload,parsed.response_id,
   Number(payload.usage?.input_tokens),Number(payload.usage?.output_tokens));
  return json(200,{data:{status:"RESULT_SAVED"}});
 }catch{return denied();}
 finally{await scope.db.close();}
}
async function sessionResult(request:Request,url:URL,env:Appf2WorkerEnv,
 nowMs:number,ticket:unknown):Promise<Session|null>{
 if(typeof ticket!=="string")return null;
 const scope=await openAiRunnerTicket(ticket,
  env.APPF2_IDENTITY_COOKIE_SECRET,nowMs);
 if(!scope)return null;
 const bearer=request.headers.get("Authorization")??"";
 if(!bearer.startsWith("Bearer "))return null;
 const runId=await verifiedLiveFreeCiOidcRunId(
  bearer.slice(7),nowMs,AI_RUNNER_AUDIENCE);
 if(!runId||request.method!=="POST"||url.search||
  env.APPF2_AGENT_FREE_ONLY!=="1")return null;
 const db=new WorkerPostgresExecutor(env.HYPERDRIVE_FRESH,
  {anonymousId:scope.owner,intentId:null});
 try{
  const found=(await db.query<RunnerRow>(`SELECT r.job_id::text,
   r.owner_anonymous_id::text,r.call_key,r.request_hash,r.model,
   r.request_json,r.runner_run_id,j.project_hash
   FROM public.appf2_agent_model_runner_request r
   JOIN public.appf2_agent_job j ON j.job_id=r.job_id
   WHERE r.job_id=$1::uuid AND r.owner_anonymous_id=$2::uuid
   AND r.runner_run_id=$3::text LIMIT 2`,
   [scope.job_id,scope.owner,runId])).rows;
  if(found.length!==1||found[0].model!=="gpt-6.1-sol"||
   scope.project_hash!==await aiTicketScopeHash({
    project_hash:found[0].project_hash,call_key:found[0].call_key,
    request_hash:found[0].request_hash})){
   await db.close();return null;
  }
  return {db,row:found[0],runId,ticket};
 }catch{await db.close();return null;}
}
