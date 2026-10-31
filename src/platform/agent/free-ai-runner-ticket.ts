/** Dedicated encrypted GPT-6 Runner ticket; cannot be redeemed as a
 * free-Docker source ticket because the key derivation domain differs.
 * GitHub workflow inputs NEVER contain plaintext model prompts or code.
 */
import {sealFreeCiTicket,openFreeCiTicket}
 from "./free-ci-ticket.js";
const SHA=/^sha256:[a-f0-9]{64}$/u;
const KEY=/^sp35_free_ai_(?:qa|code|repair)_v1$/u;
export type AiTicket={readonly job_id:string;readonly owner:string;
 readonly project_hash:string;readonly call_key:string;readonly request_hash:string};
function secretKey(secret:string){return secret+"\u0000APPF2_SP35_PAID_AI_GITHUB_RUNNER_TICKET_V1";}
export async function sealAiRunnerTicket(input:AiTicket,secret:string,
 nowMs:number):Promise<string>{
 if(!KEY.test(input.call_key)||!SHA.test(input.request_hash))
  throw Error("SP35_AI_RUNNER_TICKET_INVALID_SCOPE");
 // Reuse the audited v1 AES-GCM primitive, never its Docker decryption key.
 const outer=await sealFreeCiTicket({job_id:input.job_id,
  owner:input.owner,project_hash:input.project_hash},secretKey(secret),nowMs);
 // Scope call_key/request_hash is NOT exposed in workflow inputs. The Worker
 // verifies the unique current journal entry when the ticket is redeemed.
 return outer;
}
export async function openAiRunnerTicket(value:string,secret:string,nowMs:number){
 return openFreeCiTicket(value,secretKey(secret),nowMs);
}
