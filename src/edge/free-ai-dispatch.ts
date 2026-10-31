/** At-most-once GPT-6 GitHub Runner dispatch.
 * Worker reserves cost and the exact request under the original creator's
 * DB context BEFORE dispatch. GitHub sees only encrypted scope ticket.
 * A network timeout or non-204 dispatch is NEVER retried automatically.
 */
import {sealAiRunnerTicket} from "../platform/agent/free-ai-runner-ticket.js";
import {claimModelCall,type ModelCallRow} from
 "../platform/agent/postgres-model-calls.js";
import {validFreeCiGitHubToken,sendFreeCiGithubDispatch}
 from "./free-ci-dispatch.js";
import type {AgentJobExecutor} from "../platform/agent/postgres-agent-jobs.js";
// eslint-disable-next-line max-params -- immutable DB, owner and one-shot Github trust boundaries.
export async function dispatchAiRunner(db:AgentJobExecutor,row:ModelCallRow,
 projectHash:string,request:unknown,token:string,ticketSecret:string,
 nowMs:number):Promise<void>{
 if(row.status!=="RESERVED"||row.model!=="gpt-6.1-sol"||
  !validFreeCiGitHubToken(token)||ticketSecret.length<32)
  throw Error("SP35_AI_RUNNER_NOT_AUTHORIZED");
 const payload=JSON.stringify(request);
 if(!payload||payload.length>44000)
  throw Error("SP35_AI_RUNNER_REQUEST_TOO_LARGE");
 const stored=(await db.query<{call_key:string}>(`INSERT INTO
  public.appf2_agent_model_runner_request
  (job_id,owner_anonymous_id,call_key,request_hash,model,request_json)
  VALUES($1::uuid,$2::uuid,$3::text,$4::text,'gpt-6.1-sol',$5::jsonb)
  ON CONFLICT(job_id,call_key) DO NOTHING RETURNING call_key`,
  [row.job_id,row.owner_anonymous_id,row.call_key,row.request_hash,payload]))
  .rows[0];
 if(stored?.call_key!==row.call_key)
  throw Error("SP35_AI_RUNNER_ALREADY_DISPATCHED_NO_RETRY");
 // Ticket encryption precedes IN_FLIGHT. A local AES error must not consume
 // the one-shot paid dispatch fence before any network request is sent.
 const ticket=await sealAiRunnerTicket({job_id:row.job_id,
  owner:row.owner_anonymous_id,project_hash:projectHash,
  call_key:row.call_key,request_hash:row.request_hash},ticketSecret,nowMs);
 await claimModelCall(db,row);
 // All immutable request writes are COMMITTED before network dispatch.
 // Release the Hyperdrive TCP connection before an independent GitHub fetch:
 // the paid job remains IN_FLIGHT and cannot be dispatched a second time.
 // The original creator route's finally.close() is safely idempotent.
 if("close" in db&&typeof db.close==="function")
  await db.close();
 let classification="NETWORK_ERROR";
 try{
  const response=await sendFreeCiGithubDispatch(
   "https://api.github.com/repos/NFF98/appf2-build/actions/workflows/"+
   "sp35-staging-only.yml/dispatches",{
    method:"POST",headers:{
     Authorization:"Bearer "+token,
     Accept:"application/vnd.github+json",
     "X-GitHub-Api-Version":"2022-11-28",
     "User-Agent":"appf2-sp35-free-ci-dispatch",
     "Content-Type":"application/json"},
    body:JSON.stringify({ref:"product/sprint-3.5-complex-intent-recovery-20261026",
     inputs:{ticket:"ai_runner_v1_"+ticket}}),
    signal:globalThis.AbortSignal.timeout(12000)});
  if(response.status===204)return;
  classification=String([400,401,403,404,409,422,429,500,502,503].includes(
   response.status)?response.status:"OTHER_HTTP");
 }catch(e){
  // Do NOT include message/stack/URL/ticket. A fixed classification is safe
  // even when GitHub's response was lost after accepting the dispatch.
  classification=e instanceof Error&&(
   e.name==="TimeoutError"||e.name==="AbortError")?
   "TIMEOUT":e instanceof TypeError?"FETCH_TYPE_ERROR":"FETCH_OTHER_ERROR";
 }
 throw Error("SP35_AI_RUNNER_DISPATCH_UNCONFIRMED_"+classification);
}
