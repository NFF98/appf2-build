/**
 * Safe explicit expansion from ONE pinned Sandbox job to many owner-scoped jobs.
 * A shared broker token is NEVER browser-visible. Only the Worker, after P-256
 * creator proof, saved-model evidence and paid Postgres reserve, calls broker.
 * Sentinels are opt-in deployment config: no default paid cloud capability.
 */
export const OWNER_SCOPED_SANDBOX_JOBS="OWNER_SCOPED_JOBS";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export function sandboxJobAllowed(configured:string,jobId:string):boolean{
 return UUID.test(jobId)&&
  (configured===jobId||configured===OWNER_SCOPED_SANDBOX_JOBS);
}
