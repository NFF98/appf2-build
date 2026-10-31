/** Dedicated encrypted GPT-6 Runner ticket; cannot be redeemed as a
 * free-Docker source ticket because the key derivation domain differs.
 * GitHub workflow inputs NEVER contain plaintext model prompts or code.
 */
import {sealFreeCiTicket,openFreeCiTicket}
 from "./free-ci-ticket.js";
import {sha256CodeBytes} from "../blueprint/code-artifact-v2.js";
const SHA=/^sha256:[a-f0-9]{64}$/u;
const KEY=/^sp35_free_ai_(?:qa|code|repair)_v1$/u;
export type AiTicket={readonly job_id:string;readonly owner:string;
 readonly project_hash:string;readonly call_key:string;readonly request_hash:string};
function secretKey(secret:string){return secret+"\u0000APPF2_SP35_PAID_AI_GITHUB_RUNNER_TICKET_V1";}
export async function aiTicketScopeHash(input:Pick<AiTicket,
 "call_key"|"request_hash"|"project_hash">):Promise<string>{
 return sha256CodeBytes(new TextEncoder().encode(JSON.stringify([
  "APPF2_SP35_AI_RUNNER_SCOPE_V1",input.project_hash,
  input.call_key,input.request_hash])));
}
export async function sealAiRunnerTicket(input:AiTicket,secret:string,
 nowMs:number):Promise<string>{
 if(!KEY.test(input.call_key)||!SHA.test(input.request_hash))
  throw Error("SP35_AI_RUNNER_TICKET_INVALID_SCOPE");
 // Bind the encrypted scope to a single exact request/phase/project hash.
 const bound=await aiTicketScopeHash(input);
 const outer=await sealFreeCiTicket({job_id:input.job_id,
  owner:input.owner,project_hash:bound},secretKey(secret),nowMs);
 // The Worker recomputes the scope from the immutable journal at redemption.
 return outer;
}
export async function openAiRunnerTicket(value:string,secret:string,nowMs:number){
 return openFreeCiTicket(value,secretKey(secret),nowMs);
}
