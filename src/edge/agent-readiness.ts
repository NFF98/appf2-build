/** Read-only, no-cost candidate service configuration probe.
 * Does not call an AI model, a container, Browser Run or the database.
 * A configured binding is not proof of a live remote service or E2E PASS.
 */
import type {Appf2WorkerEnv} from "./worker-composition.js";

export const AGENT_READINESS_ROUTE="/api/v1/agent-readiness";
const HEADERS={"Content-Type":"application/json; charset=utf-8",
 "Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
const has=(value:string|undefined,min=1)=>typeof value==="string"&&value.length>=min;
export function agentReadiness(env:Appf2WorkerEnv){
 const candidate=env.APPF2_AGENT_CANDIDATE_ENABLED==="1";
 const model=candidate&&env.APPF2_AGENT_MODEL_EXECUTION_ENABLED==="1"&&
  has(env.APPF2_OPENAI_AGENT_API_KEY,16);
 const scope=env.APPF2_SANDBOX_ALLOWED_JOB_ID??"";
 const sandbox=candidate&&env.APPF2_AGENT_SANDBOX_EXECUTION_ENABLED==="1"&&
  Boolean(env.APPF2_SANDBOX_BROKER_SERVICE)&&
  has(env.APPF2_SANDBOX_BROKER_TOKEN,32)&&
  (scope==="OWNER_SCOPED_JOBS"||/^[0-9a-f-]{36}$/iu.test(scope));
 const browserQa=candidate&&env.APPF2_AGENT_QA_BROWSER_ENABLED==="1"&&
  env.APPF2_AGENT_QA_REVIEW_ENABLED==="1"&&
  Boolean(env.APPF2_QA_BROWSER_SERVICE)&&
  has(env.APPF2_QA_PRIVATE_TOKEN,32)&&
  has(env.APPF2_AGENT_QA_VERIFIER_SECRET,32);
 const missing=[
  ...(!candidate?["AGENT"]:[]),...(!model?["MODEL"]:[]),
  ...(!sandbox?["SANDBOX"]:[]),...(!browserQa?["BROWSER_QA"]:[])
 ];
 return {status:missing.length===0?"CONFIGURED_NOT_VERIFIED":"BLOCKED",
  can_start_paid_generation:missing.length===0,missing};
}
export function routeAgentReadiness(request:Request,url:URL,env:Appf2WorkerEnv):
 Response|undefined{
 if(url.pathname!==AGENT_READINESS_ROUTE)return undefined;
 if(request.method!=="GET"||url.search)
  return new Response(JSON.stringify({error:"AGENT_READINESS_METHOD"}),{
   status:405,headers:HEADERS});
 return new Response(JSON.stringify({data:agentReadiness(env)}),{
  status:200,headers:HEADERS});
}
