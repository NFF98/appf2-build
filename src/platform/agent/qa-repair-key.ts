/** Stable idempotency key for one independently observed failed QA project.
 * New repair model calls are allowed only after project hash actually changes.
 */
const SHA=/^sha256:[0-9a-f]{64}$/u;
export function qaRepairCallKey(projectHash:string):string|null{
 return SHA.test(projectHash)?"qa_repair_"+projectHash.slice(7):null;
}
