/** PRIVATE Worker-to-GitHub OIDC project transfer: no anonymous public read.
 * A signed encrypted creator ticket and specific trusted workflow RS256 OIDC
 * must both authenticate before a scope-limited PostgreSQL read.
 * This route never launches a model/paid container, nor publishes the source.
 */
import {WorkerPostgresExecutor} from "../platform/blueprint/worker-postgres-executor.js";
import {recoverAgentJob} from "../platform/agent/durable-agent-service.js";
import {openFreeCiTicket} from "../platform/agent/free-ci-ticket.js";
import {canonicalArtifactJson,sha256CodeBytes}
 from "../platform/blueprint/code-artifact-v2.js";
import {verifyLiveFreeCiOidc} from "./free-ci-oidc.js";
import type {Appf2WorkerEnv} from "./worker-composition.js";
export const FREE_CI_SOURCE_ROUTE="/api/v1/internal/free-ci/source";
const HEADERS={"Content-Type":"application/json; charset=utf-8",
 "Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
const reject=()=>new Response(JSON.stringify({error:"FREE_CI_NOT_AUTHORIZED"}),
 {status:404,headers:HEADERS});
// eslint-disable-next-line complexity -- Private source is denied on every identity, JWT, hash and scope failure.
export async function routeFreeCiSource(request:Request,url:URL,
 env:Appf2WorkerEnv,nowMs:number):Promise<Response|undefined>{
 if(url.pathname!==FREE_CI_SOURCE_ROUTE)return undefined;
 if(env.APPF2_AGENT_FREE_ONLY!=="1"||request.method!=="POST"||
  url.search||request.headers.get("Content-Type")?.split(";")[0]!=="application/json"||
  Number(request.headers.get("Content-Length")??0)>3000)return reject();
 const authorization=request.headers.get("Authorization")??"";
 if(!authorization.startsWith("Bearer ")||authorization.length>12020)
  return reject();
 const raw=await request.text();
 if(raw.length>3000)return reject();
 let body:unknown;
 try{body=JSON.parse(raw);}catch{return reject();}
 if(typeof body!=="object"||body===null||Array.isArray(body)||
  Object.keys(body).join(",")!=="ticket"||
  typeof (body as {ticket?:unknown}).ticket!=="string")return reject();
 const secret=env.APPF2_IDENTITY_COOKIE_SECRET;
 const ticket=await openFreeCiTicket((body as {ticket:string}).ticket,secret,nowMs);
 if(!ticket)return reject();
 if(!await verifyLiveFreeCiOidc(authorization.slice(7),nowMs))return reject();
 const db=new WorkerPostgresExecutor(env.HYPERDRIVE_FRESH,
  {anonymousId:ticket.owner,intentId:null});
 try{
  const saved=await recoverAgentJob(db,ticket.job_id,ticket.owner);
  if(!saved||saved.project.project_hash!==ticket.project_hash||
   saved.job.job_state==="CREATED"||saved.project.revision<2)
   return reject();
  if(saved.project.files.length>64||saved.project.files.reduce(
   (sum,f)=>sum+f.bytes,0)>1024*1024)return reject();
  const original=(await db.query<{original_plan:unknown}>(
   "SELECT original_plan FROM public.appf2_agent_qa_plan "+
   "WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid LIMIT 1",
   [ticket.job_id,ticket.owner])).rows[0]?.original_plan??null;
  const canonical=original===null?null:canonicalArtifactJson(original);
  if(canonical!==null&&(canonical.length>24000||
   !Array.isArray((original as {criteria?:unknown}).criteria)||
   (original as {criteria:unknown[]}).criteria.length>20))return reject();
  const qa_plan_hash=canonical===null?null:await sha256CodeBytes(
   new TextEncoder().encode("APPF2_FREE_CI_FROZEN_PLAN_V1\u0000"+canonical));
  return new Response(JSON.stringify({data:{job_id:ticket.job_id,
   project:saved.project,original_plan:original,qa_plan_hash}}),
   {status:200,headers:HEADERS});
 }finally{await db.close();}
}
