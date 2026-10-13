-- PG-001 / EXECUTION-ADMISSION §8.1 + F02-AC-021: a content hash reused by a second lawful Intent needs two checks.
--   (A) the requester's OWN PASSED F01 -> F02 lineage: read through the unchanged Worker RLS (own compiler_run only);
--   (B) integrity of the FIRST admitting validation_run, which that RLS correctly hides from the second owner.
-- (B) is a verdict plus the pinned registry_digest only: it never returns the foreign run id, report, trace or
-- candidate digest. It answers only for a caller whose verified context (app.intent_id AND app.anonymous_id) owns a
-- PASSED run for exactly this hash; any other context gets zero rows. validation_run RLS is not relaxed.
CREATE FUNCTION public.appf2_original_admission_integrity(p_content_hash text)
RETURNS TABLE (verdict text, registry_digest text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH judged AS (
    SELECT
      CASE
        WHEN run.validation_run_id IS NULL THEN 'ADMITTING_RUN_MISSING'
        WHEN run.status IS DISTINCT FROM 'PASSED' OR run.error_codes IS DISTINCT FROM '[]'::jsonb
          THEN 'ADMITTING_RUN_NOT_PASSED'
        WHEN run.blueprint_hash IS DISTINCT FROM content.content_hash THEN 'ADMITTING_RUN_HASH_MISMATCH'
        WHEN run.report IS NULL
          OR run.report->>'validation_run_id' IS DISTINCT FROM run.validation_run_id::text
          OR run.report->>'status' IS DISTINCT FROM 'PASSED'
          OR run.report->>'content_hash' IS DISTINCT FROM content.content_hash
          OR run.report->>'candidate_digest' IS DISTINCT FROM run.candidate_digest
          OR run.report->>'trace_id' IS DISTINCT FROM run.trace_id
          OR run.report->>'schema_version' IS DISTINCT FROM run.schema_version
          OR run.report->>'registry_version' IS DISTINCT FROM run.registry_version
          OR jsonb_typeof(run.report->'registry_digest') IS DISTINCT FROM 'string'
          OR run.report->'issues' IS DISTINCT FROM '[]'::jsonb
          THEN 'ADMITTING_REPORT_MISMATCH'
        WHEN run.schema_version IS DISTINCT FROM content.schema_version
          OR run.registry_version IS DISTINCT FROM content.registry_version
          THEN 'VERSION_MISMATCH'
        ELSE 'VERIFIED'
      END AS verdict,
      run.report->>'registry_digest' AS reported_digest
    FROM public.blueprint_content AS content
    LEFT JOIN public.validation_run AS run ON run.validation_run_id = content.admitted_by_validation_run_id
    WHERE content.content_hash = p_content_hash
      AND EXISTS (
        SELECT 1
        FROM public.validation_run AS own
        JOIN public.compiler_run AS c ON c.compiler_run_id = own.compiler_run_id
        JOIN public.intent_record AS i ON i.intent_id = c.intent_id
        WHERE own.status = 'PASSED'
          AND own.blueprint_hash = p_content_hash
          AND i.intent_id = NULLIF(current_setting('app.intent_id', true), '')::uuid
          AND i.anonymous_id = NULLIF(current_setting('app.anonymous_id', true), '')::uuid
      )
  )
  SELECT verdict, CASE WHEN verdict = 'VERIFIED' THEN reported_digest END FROM judged
$$;
REVOKE ALL ON FUNCTION public.appf2_original_admission_integrity(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.appf2_original_admission_integrity(text) TO appf2_worker;
