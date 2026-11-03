/** Paid USER_EDIT is a NEW phase, never a REPAIR of original frozen QA.
 * One immutable model journal key per edit; no duplicate paid POST.
 * A candidate is NEVER an accepted or published version.
 */
import {recoverAgentJob,advanceDurableAgentJob}
 from "../platform/agent/durable-agent-service.js";
import {readAgentProjectSnapshot} from "../platform/agent/postgres-project-snapshots.js";
import {applyProjectEdits,type ProjectSnapshot}
 from "../platform/agent/project-workspace.js";
import {getModelCall,reserveModelCall,getModelBackgroundId}
 from "../platform/agent/postgres-model-calls.js";
import {dispatchAiRunner} from "./free-ai-dispatch.js";
import {parseAiProjectFiles,aiProjectSchema} from "./free-ai-project-files.js";
import {parsedOutput} from "./free-ci-ai-code.js";
import {assertEditOwner,readAccepted,readUserEdit}
 from "./agent-user-edit.js";
import {sha256CodeBytes} from "../platform/blueprint/code-artifact-v2.js";
import type {AgentJobExecutor} from "../platform/agent/postgres-agent-jobs.js";

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const HASH=/^sha256:[a-f0-9]{64}$/u;
export const USER_EDIT_MAX_CHARGE_CENTS=20;
export type UserEditGenerateInput={readonly anonymous_id:string;
 readonly edit_id:string;readonly expected_accepted_hash:string;
 readonly expected_revision:number;readonly expected_generation:number;
 readonly explicit_ai_consent:true;readonly explicit_free_ci_consent:true};
export function validUserEditGenerate(x:unknown):x is UserEditGenerateInput{
 if(!x||typeof x!=="object"||Array.isArray(x))return false;
 const v=x as Record<string,unknown>;
 return Object.keys(v).sort().join(",")===
  "anonymous_id,edit_id,expected_accepted_hash,expected_generation,expected_revision,explicit_ai_consent,explicit_free_ci_consent"&&
  typeof v.anonymous_id==="string"&&UUID.test(v.anonymous_id)&&
  typeof v.edit_id==="string"&&UUID.test(v.edit_id)&&
  typeof v.expected_accepted_hash==="string"&&HASH.test(v.expected_accepted_hash)&&
  Number.isSafeInteger(v.expected_revision)&&Number(v.expected_revision)>=2&&
  Number.isSafeInteger(v.expected_generation)&&Number(v.expected_generation)>=0&&
  v.explicit_ai_consent===true&&v.explicit_free_ci_consent===true;
}
type Ctx={readonly db:AgentJobExecutor;readonly jobId:string;
 readonly ownerThumb:string;readonly modelKey:string;readonly githubToken:string;
 readonly ticketSecret:string;readonly nowMs:number};
function userEditRequest(files:ProjectSnapshot["files"],profile:"VITE_WEB"|"VITE_NODE",
 original:string,combinedPlan:unknown,userRequest:string){
 const lines=[
  "APPf2 USER_EDIT: modify the EXISTING accepted App, do not recreate it.",
  "Reply ONLY JSON of COMPLETE source files matching the supplied schema.",
  "Every accepted feature and all its behaviour must remain functional.",
  "Implement ONLY this newly accepted user change: "+JSON.stringify(userRequest),
  "Return a complete tree with src/main.ts and src/style.css, <=12 files,",
  "plus server/index.mjs and server/test.mjs for the existing VITE_NODE profile.",
  "Never create package/lockfile/config/deployment/credentials/SQL files.",
  "Use only relative imports and existing trusted appf2Records bridge for CRUD.",
  "Never fetch external URLs; the independent QA decides PASS/FAIL, not the model.",
  "All OLD and NEW acceptance checks must pass: "+JSON.stringify(combinedPlan),
  "ALL previously confirmed user requirements: "+JSON.stringify(original),
  "COMPLETE existing accepted source; preserve working code: "+JSON.stringify(
   files.map(f=>({path:f.path,content:f.content}))),
  "Existing profile: "+profile
 ];
 return {model:"gpt-6.1-sol",reasoning:{effort:"medium" as const},
  input:lines.join("\n"),max_output_tokens:12000,background:true,store:true,
  text:{format:{type:"json_schema",name:"appf2_sp35_user_edit_source",
   strict:true,schema:aiProjectSchema}}};
}
async function candidateFromPaidResponse(base:ProjectSnapshot,response:unknown){
 const profile=base.profile==="VITE_NODE"?"VITE_NODE":"VITE_WEB";
 const files=parseAiProjectFiles(parsedOutput(response),profile);
 if(!files)throw Error("SP35_USER_EDIT_PAID_SOURCE_INVALID_NO_RECHARGE");
 const before=new Map(base.files.map(f=>[f.path,f]));
 const listed=new Set(files.map(f=>f.path));
 const retired=base.files.filter(f=>(
  f.path.startsWith("src/")||profile==="VITE_NODE"&&f.path.startsWith("server/"))&&
  !listed.has(f.path)).map(f=>({
   operation:"delete" as const,path:f.path,previous_hash:f.hash}));
 const edits=[...files.map(f=>{
  const old=before.get(f.path);
  return old?{operation:"replace" as const,path:f.path,
   previous_hash:old.hash,content:f.content}:
   {operation:"add" as const,path:f.path,content:f.content};
 }),...retired];
 return applyProjectEdits(base,base.project_hash,edits);
}
async function persistEditCandidate(ctx:Ctx,owner:string,editId:string,
 acceptedHash:string,project:ProjectSnapshot){
 const updated=(await ctx.db.query<{edit_id:string}>(
  "UPDATE public.appf2_agent_user_edit SET state='QA_REQUIRED',"+
  "candidate_project_hash=$4::text,candidate_project_revision=$5::integer,updated_at=now() "+
  "WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid AND edit_id=$3::uuid "+
  "AND base_project_hash=$6::text AND state IN ('DRAFT','MODEL_PENDING') "+
  "AND candidate_project_hash IS NULL RETURNING edit_id::text",
  [ctx.jobId,owner,editId,project.project_hash,project.revision,acceptedHash])).rows[0];
 if(updated?.edit_id!==editId)throw Error("SP35_USER_EDIT_CANDIDATE_RECOVERY_UNCERTAIN");
 return {status:"USER_EDIT_CANDIDATE_SAVED_QA_REQUIRED" as const,
  project_hash:project.project_hash,revision:project.revision,
  app_published:false as const};
}
/** One-shot generation + crash reconciliation. Never substitutes Job head for Accepted. */
// eslint-disable-next-line complexity, max-lines-per-function -- Durable owner, cost, source and CAS checks all required.
export async function generateUserEdit(input:UserEditGenerateInput,ctx:Ctx){
 if(!validUserEditGenerate(input)||ctx.modelKey.length<16||
  ctx.githubToken.length<20||ctx.ticketSecret.length<32)
  throw Error("SP35_USER_EDIT_MODEL_DISABLED");
 await assertEditOwner(input.anonymous_id,ctx);
 const edit=await readUserEdit(ctx.db,ctx.jobId,input.anonymous_id,input.edit_id);
 const accepted=await readAccepted(ctx.db,ctx.jobId,input.anonymous_id);
 const current=await recoverAgentJob(ctx.db,ctx.jobId,input.anonymous_id);
 if(!edit||!accepted||!current||
  accepted.project_hash!==input.expected_accepted_hash||
  accepted.generation!==input.expected_generation||
  edit.base_project_hash!==accepted.project_hash||
  edit.base_generation!==accepted.generation)
  throw Error("SP35_USER_EDIT_ACCEPTED_BASE_STALE");
 if(edit.state==="QA_REQUIRED"&&edit.candidate_project_hash)
  return {status:"USER_EDIT_CANDIDATE_SAVED_QA_REQUIRED" as const,
   project_hash:edit.candidate_project_hash,revision:edit.candidate_project_revision,
   app_published:false as const};
 if(!["DRAFT","MODEL_PENDING"].includes(edit.state))
  throw Error("SP35_USER_EDIT_NOT_GENERATABLE");
 const callKey="sp35_user_edit_"+input.edit_id.replace(/-/gu,"");
 const prior=await getModelCall(ctx.db,ctx.jobId,input.anonymous_id,callKey);
 const base=await readAgentProjectSnapshot(ctx.db,input.anonymous_id,accepted.project_hash);
 if(!base)throw Error("SP35_USER_EDIT_ACCEPTED_SOURCE_MISSING");
 // The model response may already have committed its source CAS before the
 // browser lost the reply. Recompute its exact project hash from PAID SAVED data.
 if(current.project.parent_hash===accepted.project_hash&&
  current.project.project_hash!==accepted.project_hash&&
  prior?.status==="SUCCEEDED"&&prior.response_json!==null){
  const computed=await candidateFromPaidResponse(base,prior.response_json);
  if(computed.project_hash!==current.project.project_hash)
   throw Error("SP35_USER_EDIT_SOURCE_RECONCILIATION_MISMATCH");
  return persistEditCandidate(ctx,input.anonymous_id,input.edit_id,
   accepted.project_hash,current.project);
 }
 if(current.project.project_hash!==accepted.project_hash||
  current.job.revision!==input.expected_revision||
  current.job.job_state!=="CODING"||
  current.job.checkpoint.step>=current.job.checkpoint.budget.max_steps)
  throw Error("SP35_USER_EDIT_WORKING_HEAD_STALE");
 const profile=base.profile==="VITE_NODE"?"VITE_NODE":"VITE_WEB";
 const req=userEditRequest(base.files,profile,accepted.requirements_text,
  edit.combined_qa_plan,edit.user_request);
 const requestJson=JSON.stringify(req);
 if(requestJson.length>40000)
  throw Error("SP35_USER_EDIT_CONTEXT_TOO_LARGE_NO_CHARGE");
 const requestHash=await sha256CodeBytes(new TextEncoder().encode(
  "APPF2_SP35_FREE_AI_REQUEST_V1\u0000"+requestJson));
 let response=prior?.response_json;
 let inputTokens=prior?.input_tokens??0,outputTokens=prior?.output_tokens??0;
 if(prior){
  if(prior.request_hash!==requestHash||prior.job_revision!==current.job.revision||
   prior.checkpoint_hash!==current.job.checkpoint_hash||
   prior.max_charge_cents!==USER_EDIT_MAX_CHARGE_CENTS)
   throw Error("SP35_USER_EDIT_MODEL_JOURNAL_MISMATCH_NO_RECHARGE");
  if(prior.status!=="SUCCEEDED"||response===null)
   throw Error("SP35_BACKGROUND_MODEL_PENDING_NO_POST");
 }else{
  // Postgres reservation checks FULL cumulative approved job cost,
  // and fences every uncertain or concurrently active model call.
  const saved=await reserveModelCall(ctx.db,current.job,input.anonymous_id,{
   call_key:callKey,request_hash:requestHash,model:"gpt-6.1-sol",
   max_charge_cents:USER_EDIT_MAX_CHARGE_CENTS});
  await ctx.db.query(
   "UPDATE public.appf2_agent_user_edit SET state='MODEL_PENDING',updated_at=now() "+
   "WHERE edit_id=$1::uuid AND job_id=$2::uuid AND owner_anonymous_id=$3::uuid "+
   "AND state='DRAFT'",[input.edit_id,ctx.jobId,input.anonymous_id]);
  await dispatchAiRunner(ctx.db,saved,current.project.project_hash,req,
   ctx.githubToken,ctx.ticketSecret,ctx.nowMs);
  throw Error("SP35_BACKGROUND_MODEL_PENDING_NO_POST");
 }
 if(response===null)throw Error("SP35_USER_EDIT_MODEL_RESPONSE_NOT_SAVED");
 const candidate=await candidateFromPaidResponse(base,response);
 if(candidate.project_hash===base.project_hash)
  throw Error("SP35_USER_EDIT_MODEL_NO_CHANGE_NO_RECHARGE");
 const next={...current.job.checkpoint,
  state:"CODING" as const,step:current.job.checkpoint.step+1,
  project_hash:candidate.project_hash,
  tokens_used:Math.min(current.job.checkpoint.budget.max_tokens,
   current.job.checkpoint.tokens_used+inputTokens+outputTokens),
  cost_cents:Math.min(current.job.checkpoint.budget.max_cost_cents,
   current.job.checkpoint.cost_cents+USER_EDIT_MAX_CHARGE_CENTS),
  previous_checkpoint_id:current.job.checkpoint_hash};
 const committed=await advanceDurableAgentJob(ctx.db,current.job,
  input.anonymous_id,next,candidate);
 return persistEditCandidate(ctx,input.anonymous_id,input.edit_id,
  accepted.project_hash,committed.project);
}
