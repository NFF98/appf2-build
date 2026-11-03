/** Owner-signed, NO-AI colour change on an already independently tested VITE_WEB App.
 * Source lineage is immutable. This only creates an unapproved candidate;
 * a new complete frozen-plan CI + explicit owner share must precede release.
 */
import {recoverAgentJob,advanceDurableAgentJob}
 from "../platform/agent/durable-agent-service.js";
import {applyProjectEdits} from "../platform/agent/project-workspace.js";
import {readFreeCiSmoke,frozenFreeCiPlanHash}
 from "./free-ci-result.js";
import type {QaPlan} from "../platform/qa/requirement-contract.js";
import type {AgentJobExecutor} from "../platform/agent/postgres-agent-jobs.js";

export type SafeStyleEditInput={readonly anonymous_id:string;
 readonly expected_revision:number;readonly expected_project_hash:string;
 readonly theme:"blue"|"green"|"sand"};
const HASH=/^sha256:[a-f0-9]{64}$/u;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const COLOURS={blue:"#e8f1ff",green:"#e7f7ed",sand:"#fff3e5"} as const;
const START="/* APPF2_SAFE_STYLE_V1_BEGIN */";
const END="/* APPF2_SAFE_STYLE_V1_END */";
const BLOCK=/\/\* APPF2_SAFE_STYLE_V1_BEGIN \*\/[\s\S]*?\/\* APPF2_SAFE_STYLE_V1_END \*\//gu;

export function validSafeStyleEditInput(raw:unknown):raw is SafeStyleEditInput{
 if(!raw||typeof raw!=="object"||Array.isArray(raw))return false;
 const x=raw as Record<string,unknown>;
 return Object.keys(x).sort().join(",")===
  "anonymous_id,expected_project_hash,expected_revision,theme"&&
  typeof x.anonymous_id==="string"&&UUID.test(x.anonymous_id)&&
  typeof x.expected_project_hash==="string"&&HASH.test(x.expected_project_hash)&&
  Number.isSafeInteger(x.expected_revision)&&
  Number(x.expected_revision)>=2&&Number(x.expected_revision)<=511&&
  (x.theme==="blue"||x.theme==="green"||x.theme==="sand");
}
/** Bounded colour-only CSS patch; no arbitrary CSS, selector, JS or URL enters. */
export function safeStyleCss(original:string,theme:SafeStyleEditInput["theme"]):string{
 if(typeof original!=="string"||original.length>128000||
  original.includes("\u0000")||!(theme in COLOURS))
  throw Error("SP35_STYLE_SOURCE_INVALID");
 const opens=original.split(START).length-1;
 const closes=original.split(END).length-1;
 if(opens!==closes||opens>1)throw Error("SP35_STYLE_MARKER_CORRUPTED");
 const colour=COLOURS[theme];
 const block=START+"\nbody { background-color: "+colour+
  " !important; }\n"+END;
 const trimmed=opens===1?original.replace(BLOCK,"").trimEnd():original.trimEnd();
 const result=trimmed+"\n"+block+"\n";
 if(result===original||result.length>192000)throw Error("SP35_STYLE_NO_CHANGE_OR_OVERSIZE");
 return result;
}
/** Durable old-approved asset never changes. A new head requires fresh CI QA. */
// eslint-disable-next-line complexity -- Independent author, QA, CAS, budget and source guards.
export async function saveSafeStyleCandidate(input:SafeStyleEditInput,ctx:{
 readonly db:AgentJobExecutor;readonly jobId:string;readonly ownerThumb:string;
}):Promise<{status:"STYLE_CANDIDATE_SAVED_QA_REQUIRED";
 readonly project_hash:string;readonly previous_project_hash:string;
 readonly revision:number;readonly app_published:false;readonly paid_ai_calls:0}>{
 if(!validSafeStyleEditInput(input))throw Error("SP35_STYLE_INPUT_INVALID");
 const owner=(await ctx.db.query<{job_id:string}>(
  "SELECT job_id::text FROM public.appf2_agent_job "+
  "WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid "+
  "AND owner_key_thumbprint=$3::text LIMIT 1",
  [ctx.jobId,input.anonymous_id,ctx.ownerThumb])).rows[0];
 if(owner?.job_id!==ctx.jobId)throw Error("SP35_STYLE_NOT_CREATOR");
 const current=await recoverAgentJob(ctx.db,ctx.jobId,input.anonymous_id);
 if(!current||current.job.revision!==input.expected_revision||
  current.project.project_hash!==input.expected_project_hash||
  current.project.profile!=="VITE_WEB"||current.project.revision<2||
  current.job.job_state!=="CODING"||
  current.job.checkpoint.step>=current.job.checkpoint.budget.max_steps)
  throw Error("SP35_STYLE_STALE_OR_NOT_ELIGIBLE");
 const receipt=await readFreeCiSmoke(ctx.db,ctx.jobId,input.anonymous_id,
  input.expected_project_hash);
 const row=(await ctx.db.query<{original_plan:QaPlan}>(
  "SELECT original_plan FROM public.appf2_agent_qa_plan "+
  "WHERE job_id=$1::uuid AND owner_anonymous_id=$2::uuid LIMIT 1",
  [ctx.jobId,input.anonymous_id])).rows[0];
 const criteria=row?.original_plan?.criteria;
 if(!receipt||receipt.status!=="BUILD_BROWSER_SMOKE"||
  !receipt.preview_ready||!receipt.qa_plan_hash||
  !Array.isArray(criteria)||criteria.length<1||criteria.length>20||
  receipt.qa_checks?.length!==criteria.length||
  !criteria.every((c,i)=>c.automatable&&
   receipt.qa_checks?.[i]?.criterion_id===c.id&&
   receipt.qa_checks?.[i]?.verdict==="PASS")||
  receipt.qa_plan_hash!==await frozenFreeCiPlanHash(row.original_plan))
  throw Error("SP35_STYLE_BASELINE_QA_NOT_PASS");
 const style=current.project.files.find(f=>f.path==="src/style.css");
 if(!style)throw Error("SP35_STYLE_SOURCE_MISSING");
 const updated=safeStyleCss(style.content,input.theme);
 const nextProject=await applyProjectEdits(current.project,input.expected_project_hash,[{
  operation:"replace",path:"src/style.css",
  previous_hash:style.hash,content:updated
 }]);
 const checkpoint={...current.job.checkpoint,
  step:current.job.checkpoint.step+1,
  project_hash:nextProject.project_hash,
  previous_checkpoint_id:current.job.checkpoint_hash};
 const saved=await advanceDurableAgentJob(ctx.db,current.job,input.anonymous_id,
  checkpoint,nextProject);
 return {status:"STYLE_CANDIDATE_SAVED_QA_REQUIRED",
  previous_project_hash:input.expected_project_hash,
  project_hash:saved.project.project_hash,revision:saved.job.revision,
  app_published:false,paid_ai_calls:0};
}
