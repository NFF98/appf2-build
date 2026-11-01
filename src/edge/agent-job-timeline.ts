/** Sprint 3.5 G0: creator-signed, NO CHARGE real server-side milestones.
 * Uses existing PostgreSQL timestamps; does not mutate Job, model journal,
 * frozen QA, Runner receipts, private previews or identity.
 */
import type {AgentJobExecutor} from "../platform/agent/postgres-agent-jobs.js";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const THUMB=/^[a-f0-9]{64}$/u;
type TimestampRow={
 readonly job_id:string;readonly revision:number;readonly job_state:string;
 readonly job_saved_ms:unknown;readonly qa_frozen_ms:unknown;
 readonly first_model_reserved_ms:unknown;readonly first_model_completed_ms:unknown;
 readonly first_code_source_saved_ms:unknown;readonly current_source_saved_ms:unknown;
 readonly first_qa_receipt_ms:unknown;readonly last_qa_receipt_ms:unknown;
 readonly first_verified_preview_ms:unknown;readonly current_private_preview_ms:unknown;
 readonly model_calls_count:unknown;readonly qa_receipts_count:unknown;
};
/** Project ancestry is anchored to the current exact source hash, preventing
 * contamination from other Jobs belonging to the same owner.
 * Only preview+receipt with every originally frozen QA criterion passing
 * count as a verified private preview. Does not prove an end-user opened it.
 */
export const TIMELINE_SQL=`
WITH RECURSIVE allowed AS (
 SELECT j.job_id,j.owner_anonymous_id,j.project_hash,j.revision,
 j.job_state,j.created_at,j.updated_at
 FROM public.appf2_agent_job j WHERE j.job_id=$1::uuid
 AND j.owner_anonymous_id=$2::uuid AND j.owner_key_thumbprint=$3::text
 LIMIT 1
), ancestors AS (
 SELECT s.owner_anonymous_id,s.project_hash,s.parent_hash,
 s.project_revision,s.created_at,1 AS depth
 FROM public.appf2_agent_project_snapshot s JOIN allowed j
 ON s.owner_anonymous_id=j.owner_anonymous_id AND s.project_hash=j.project_hash
 UNION ALL
 SELECT p.owner_anonymous_id,p.project_hash,p.parent_hash,
 p.project_revision,p.created_at,a.depth+1
 FROM ancestors a JOIN public.appf2_agent_project_snapshot p
 ON p.owner_anonymous_id=a.owner_anonymous_id AND p.project_hash=a.parent_hash
 WHERE a.depth<16 AND p.project_revision<a.project_revision
)
SELECT j.job_id::text,j.revision,j.job_state,
 (extract(epoch FROM j.created_at)*1000)::double precision AS job_saved_ms,
 (SELECT (extract(epoch FROM MIN(q.created_at))*1000)::double precision
 FROM public.appf2_agent_qa_plan q WHERE q.job_id=j.job_id
 AND q.owner_anonymous_id=j.owner_anonymous_id) AS qa_frozen_ms,
 (SELECT (extract(epoch FROM MIN(m.created_at))*1000)::double precision
 FROM public.appf2_agent_model_call m WHERE m.job_id=j.job_id
 AND m.owner_anonymous_id=j.owner_anonymous_id) AS first_model_reserved_ms,
 (SELECT (extract(epoch FROM MIN(m.updated_at))*1000)::double precision
 FROM public.appf2_agent_model_call m WHERE m.job_id=j.job_id
 AND m.owner_anonymous_id=j.owner_anonymous_id AND m.status='SUCCEEDED')
 AS first_model_completed_ms,
 (SELECT (extract(epoch FROM MIN(a.created_at))*1000)::double precision
 FROM ancestors a WHERE a.project_revision>=2 AND a.created_at>=j.created_at)
 AS first_code_source_saved_ms,
 (SELECT (extract(epoch FROM s.created_at)*1000)::double precision
 FROM public.appf2_agent_project_snapshot s WHERE
 s.owner_anonymous_id=j.owner_anonymous_id AND s.project_hash=j.project_hash)
 AS current_source_saved_ms,
 (SELECT (extract(epoch FROM MIN(r.created_at))*1000)::double precision
 FROM public.appf2_agent_free_ci_receipt r WHERE r.job_id=j.job_id
 AND r.owner_anonymous_id=j.owner_anonymous_id) AS first_qa_receipt_ms,
 (SELECT (extract(epoch FROM MAX(r.created_at))*1000)::double precision
 FROM public.appf2_agent_free_ci_receipt r WHERE r.job_id=j.job_id
 AND r.owner_anonymous_id=j.owner_anonymous_id) AS last_qa_receipt_ms,
 (SELECT (extract(epoch FROM MIN(GREATEST(r.created_at,p.created_at)))*1000)::double precision
 FROM public.appf2_agent_free_ci_receipt r
 JOIN public.appf2_agent_free_ci_preview p
 ON p.job_id=r.job_id AND p.owner_anonymous_id=r.owner_anonymous_id
 AND p.project_hash=r.project_hash
 JOIN public.appf2_agent_qa_plan q ON q.job_id=r.job_id
 AND q.owner_anonymous_id=r.owner_anonymous_id
 WHERE r.job_id=j.job_id AND r.owner_anonymous_id=j.owner_anonymous_id
 AND r.receipt_json->>'version'='APPF2_FREE_CI_SMOKE_V1'
 AND r.receipt_json->'checks' @> '{"locked_build":true,"chromium_render":true}'::jsonb
 AND r.receipt_json->>'project_hash'=r.project_hash
 AND r.receipt_json->>'artifact_hash'=r.built_artifact_hash
 AND p.run_id=r.run_id AND p.artifact_hash=r.built_artifact_hash
 AND jsonb_typeof(r.receipt_json->'qa_checks')='array'
 AND jsonb_typeof(q.original_plan->'criteria')='array'
 AND jsonb_array_length(r.receipt_json->'qa_checks')>0
 AND jsonb_array_length(r.receipt_json->'qa_checks')=
     jsonb_array_length(q.original_plan->'criteria')
 AND NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements(r.receipt_json->'qa_checks') c
  WHERE c->>'verdict'<>'PASS' OR c->>'verdict' IS NULL
 )
 AND NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements(q.original_plan->'criteria') required
  WHERE (SELECT COUNT(*) FROM jsonb_array_elements(r.receipt_json->'qa_checks') observed
         WHERE observed->>'criterion_id'=required->>'id'
           AND observed->>'verdict'='PASS') <> 1
 )) AS first_verified_preview_ms,
 (SELECT (extract(epoch FROM MAX(p.created_at))*1000)::double precision
 FROM public.appf2_agent_free_ci_preview p WHERE p.job_id=j.job_id
 AND p.owner_anonymous_id=j.owner_anonymous_id
 AND p.project_hash=j.project_hash) AS current_private_preview_ms,
 (SELECT COUNT(*)::integer FROM public.appf2_agent_model_call m
 WHERE m.job_id=j.job_id AND m.owner_anonymous_id=j.owner_anonymous_id)
 AS model_calls_count,
 (SELECT COUNT(*)::integer FROM public.appf2_agent_free_ci_receipt r
 WHERE r.job_id=j.job_id AND r.owner_anonymous_id=j.owner_anonymous_id)
 AS qa_receipts_count FROM allowed j`;
function millis(v:unknown):number|null{
 if(typeof v!=="number"&&typeof v!=="string")return null;
 if(v==="")return null;
 const n=Number(v);
 return Number.isFinite(n)&&n>0&&n<4102444800000?Math.round(n):null;
}
function count(v:unknown):number{
 const n=Number(v);
 return Number.isSafeInteger(n)&&n>=0?n:0;
}
function duration(first:number|null,last:number|null):number|null{
 return first!==null&&last!==null&&last>=first?last-first:null;
}
/** No prompt, owner fingerprint, source, token, raw QA or model result leaves
 * this API. Time fields missing in the actual DB stay null (NOT_MEASURED).
 */
export async function readOwnerJobTimeline(db:AgentJobExecutor,
 input:{jobId:string;owner:string;ownerThumb:string}){
 if(!UUID.test(input.jobId)||!UUID.test(input.owner)||
  !THUMB.test(input.ownerThumb))return null;
 const row=(await db.query<TimestampRow>(TIMELINE_SQL,
  [input.jobId,input.owner,input.ownerThumb])).rows[0];
 if(!row||row.job_id!==input.jobId)return null;
 const job=millis(row.job_saved_ms);
 const source=millis(row.first_code_source_saved_ms);
 const verified=millis(row.first_verified_preview_ms);
 return {
  status:"SP35_REAL_TIMELINE_READ_ONLY" as const,
  job_revision:row.revision,job_state:row.job_state,
  job_saved_at_ms:job,
  qa_frozen_at_ms:millis(row.qa_frozen_ms),
  first_model_reserved_at_ms:millis(row.first_model_reserved_ms),
  first_model_completed_at_ms:millis(row.first_model_completed_ms),
  first_code_source_saved_at_ms:source,
  current_source_saved_at_ms:millis(row.current_source_saved_ms),
  first_qa_receipt_at_ms:millis(row.first_qa_receipt_ms),
  last_qa_receipt_at_ms:millis(row.last_qa_receipt_ms),
  first_verified_preview_at_ms:verified,
  current_private_preview_at_ms:millis(row.current_private_preview_ms),
  time_to_first_source_ms:duration(job,source),
  time_to_first_qa_pass_preview_ms:duration(job,verified),
  model_calls_recorded:count(row.model_calls_count),
  qa_receipts_recorded:count(row.qa_receipts_count),
  new_paid_model_calls_by_inspection:0 as const,
  // A verified saved preview is NOT proof of actual user time-to-interaction.
  real_user_first_interaction_ms:null,
  app_published_by_inspection:false as const
 };
}
