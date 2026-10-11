-- PG-001: least-privilege Worker / F02 / retention roles + identity-scoped RLS.
-- Request identity contract: the Worker sets transaction-local `app.*` context (set_config(..., true)) and
-- `SET LOCAL ROLE` at the start of every transaction. RLS cannot verify those values; binding them to a verified
-- request (PoP proof / scoped continuity cookie) is the Worker's job.

CREATE ROLE appf2_worker NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
CREATE ROLE appf2_retention NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
-- F02 admission boundary = Worker request privileges + content-addressed admission of one server-computed hash.
CREATE ROLE appf2_f02_admission NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION;
GRANT appf2_worker TO appf2_f02_admission;
-- DATA-MODEL §6.5: only the trusted F02 transition boundary may CAS trust_status VALIDATED -> REVOKED | INCOMPATIBLE.
CREATE ROLE appf2_f02_trust NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;

-- Supabase grants ALL (incl. TRUNCATE / TRIGGER / REFERENCES / MAINTAIN, which RLS does not govern) to anon / authenticated.
REVOKE ALL ON TABLE
  public.anonymous_identity, public.blueprint_content, public.compiler_run,
  public.evidence_client_quality_report, public.evidence_daily_aggregate,
  public.evidence_intake_observation, public.idempotency_operation,
  public.intent_record, public.product_event, public.validation_run
FROM PUBLIC, anon, authenticated;

GRANT USAGE ON SCHEMA public TO appf2_worker, appf2_retention, appf2_f02_admission, appf2_f02_trust;

-- Worker request path: no DELETE, no TRUNCATE, no TRIGGER / REFERENCES / MAINTAIN anywhere.
GRANT SELECT, INSERT ON public.anonymous_identity TO appf2_worker;
GRANT UPDATE (last_seen_at) ON public.anonymous_identity TO appf2_worker;
GRANT SELECT, INSERT ON public.product_event TO appf2_worker;
GRANT SELECT, INSERT, UPDATE ON public.intent_record TO appf2_worker;
GRANT SELECT, INSERT, UPDATE ON public.idempotency_operation TO appf2_worker;
GRANT SELECT, INSERT, UPDATE ON public.compiler_run TO appf2_worker;
GRANT SELECT, INSERT ON public.validation_run TO appf2_worker;
GRANT SELECT ON public.blueprint_content TO appf2_worker;
GRANT INSERT ON public.evidence_intake_observation TO appf2_worker;
GRANT SELECT (observation_id) ON public.evidence_intake_observation TO appf2_worker;
GRANT INSERT ON public.evidence_client_quality_report TO appf2_worker;
GRANT SELECT (report_id) ON public.evidence_client_quality_report TO appf2_worker;

-- UPDATE (trust_status) is required only because the repository admission upsert is
-- `ON CONFLICT DO UPDATE SET trust_status = trust_status`; policy below pins it to a no-op.
GRANT INSERT ON public.blueprint_content TO appf2_f02_admission;
GRANT UPDATE (trust_status) ON public.blueprint_content TO appf2_f02_admission;

GRANT SELECT (content_hash, trust_status, schema_version, registry_version) ON public.blueprint_content TO appf2_f02_trust;
GRANT UPDATE (trust_status) ON public.blueprint_content TO appf2_f02_trust;

-- Retention maintenance path only.
GRANT SELECT, DELETE ON public.product_event TO appf2_retention;
GRANT SELECT, DELETE ON public.evidence_intake_observation TO appf2_retention;
GRANT SELECT, DELETE ON public.evidence_client_quality_report TO appf2_retention;
GRANT SELECT, INSERT, UPDATE ON public.evidence_daily_aggregate TO appf2_retention;

-- Identity-scoped tables.
CREATE POLICY worker_select_own ON public.anonymous_identity FOR SELECT TO appf2_worker
  USING (anonymous_id = NULLIF(current_setting('app.anonymous_id', true), '')::uuid);
CREATE POLICY worker_insert_own ON public.anonymous_identity FOR INSERT TO appf2_worker
  WITH CHECK (anonymous_id = NULLIF(current_setting('app.anonymous_id', true), '')::uuid);
CREATE POLICY worker_update_own ON public.anonymous_identity FOR UPDATE TO appf2_worker
  USING (anonymous_id = NULLIF(current_setting('app.anonymous_id', true), '')::uuid)
  WITH CHECK (anonymous_id = NULLIF(current_setting('app.anonymous_id', true), '')::uuid);

CREATE POLICY worker_select_own ON public.product_event FOR SELECT TO appf2_worker
  USING (anonymous_id IS NULL OR anonymous_id = NULLIF(current_setting('app.anonymous_id', true), '')::uuid);
CREATE POLICY worker_insert_own ON public.product_event FOR INSERT TO appf2_worker
  WITH CHECK (anonymous_id IS NULL OR anonymous_id = NULLIF(current_setting('app.anonymous_id', true), '')::uuid);

CREATE POLICY worker_select_own ON public.intent_record FOR SELECT TO appf2_worker
  USING (anonymous_id = NULLIF(current_setting('app.anonymous_id', true), '')::uuid);
CREATE POLICY worker_insert_own ON public.intent_record FOR INSERT TO appf2_worker
  WITH CHECK (anonymous_id = NULLIF(current_setting('app.anonymous_id', true), '')::uuid);
CREATE POLICY worker_update_own ON public.intent_record FOR UPDATE TO appf2_worker
  USING (anonymous_id = NULLIF(current_setting('app.anonymous_id', true), '')::uuid)
  WITH CHECK (anonymous_id = NULLIF(current_setting('app.anonymous_id', true), '')::uuid);

CREATE POLICY worker_select_own ON public.idempotency_operation FOR SELECT TO appf2_worker
  USING (anonymous_id = NULLIF(current_setting('app.anonymous_id', true), '')::uuid);
CREATE POLICY worker_insert_own ON public.idempotency_operation FOR INSERT TO appf2_worker
  WITH CHECK (anonymous_id = NULLIF(current_setting('app.anonymous_id', true), '')::uuid);
CREATE POLICY worker_update_own ON public.idempotency_operation FOR UPDATE TO appf2_worker
  USING (anonymous_id = NULLIF(current_setting('app.anonymous_id', true), '')::uuid)
  WITH CHECK (anonymous_id = NULLIF(current_setting('app.anonymous_id', true), '')::uuid);

-- compiler_run inherits scope from intent_record (whose own RLS applies inside the subquery).
CREATE POLICY worker_select_own ON public.compiler_run FOR SELECT TO appf2_worker
  USING (EXISTS (SELECT 1 FROM public.intent_record i WHERE i.intent_id = compiler_run.intent_id));
CREATE POLICY worker_insert_own ON public.compiler_run FOR INSERT TO appf2_worker
  WITH CHECK (EXISTS (SELECT 1 FROM public.intent_record i WHERE i.intent_id = compiler_run.intent_id));
CREATE POLICY worker_update_own ON public.compiler_run FOR UPDATE TO appf2_worker
  USING (EXISTS (SELECT 1 FROM public.intent_record i WHERE i.intent_id = compiler_run.intent_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.intent_record i WHERE i.intent_id = compiler_run.intent_id));

-- validation_run inherits scope from compiler_run when linked; unlinked (import / restore) rows are shared.
CREATE POLICY worker_select_scoped ON public.validation_run FOR SELECT TO appf2_worker
  USING (compiler_run_id IS NULL OR EXISTS (SELECT 1 FROM public.compiler_run c WHERE c.compiler_run_id = validation_run.compiler_run_id));
CREATE POLICY worker_insert_scoped ON public.validation_run FOR INSERT TO appf2_worker
  WITH CHECK (compiler_run_id IS NULL OR EXISTS (SELECT 1 FROM public.compiler_run c WHERE c.compiler_run_id = validation_run.compiler_run_id));

-- EXECUTION-ADMISSION §8.1 / F01-API-ID-001B: content_hash is never bearer authority. Original-Intent read requires
-- durable F01 -> F02 lineage (PASSED validation_run of a compiler_run of the verified intent) for the exact hash.
-- `app.intent_id` must come only from a verified scoped cookie + PoP or a verified intent_blueprint_access_grant.
-- SECURITY DEFINER avoids RLS recursion between blueprint_content and validation_run policies.
CREATE FUNCTION public.appf2_original_intent_lineage(p_content_hash text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.validation_run v
    JOIN public.compiler_run c ON c.compiler_run_id = v.compiler_run_id
    WHERE v.status = 'PASSED'
      AND v.blueprint_hash = p_content_hash
      AND c.intent_id = NULLIF(current_setting('app.intent_id', true), '')::uuid
  )
$$;
-- Prior trust_status of the one hash being admitted; lets the admission upsert prove its UPDATE is a no-op.
CREATE FUNCTION public.appf2_admitting_prior_trust(p_content_hash text)
RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT b.trust_status
  FROM public.blueprint_content b
  WHERE b.content_hash = p_content_hash
    AND p_content_hash = NULLIF(current_setting('app.admitting_content_hash', true), '')
$$;
REVOKE ALL ON FUNCTION public.appf2_original_intent_lineage(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.appf2_admitting_prior_trust(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.appf2_original_intent_lineage(text) TO appf2_worker;
GRANT EXECUTE ON FUNCTION public.appf2_admitting_prior_trust(text) TO appf2_f02_admission;

-- Share-recipient read (§8.1.1) is NOT expressible: DATA-MODEL §6.7 `share` has no migration. Fails closed.
CREATE POLICY worker_read_original_intent_lineage ON public.blueprint_content FOR SELECT TO appf2_worker
  USING (public.appf2_original_intent_lineage(content_hash));

-- `app.admitting_content_hash` = server-computed hash of the canonical body F02 just validated.
CREATE POLICY admission_read_admitting ON public.blueprint_content FOR SELECT TO appf2_f02_admission
  USING (content_hash = NULLIF(current_setting('app.admitting_content_hash', true), ''));
CREATE POLICY admission_insert_validated ON public.blueprint_content FOR INSERT TO appf2_f02_admission
  WITH CHECK (content_hash = NULLIF(current_setting('app.admitting_content_hash', true), '') AND trust_status = 'VALIDATED');
CREATE POLICY admission_conflict_noop ON public.blueprint_content FOR UPDATE TO appf2_f02_admission
  USING (content_hash = NULLIF(current_setting('app.admitting_content_hash', true), ''))
  WITH CHECK (content_hash = NULLIF(current_setting('app.admitting_content_hash', true), '')
    AND trust_status = public.appf2_admitting_prior_trust(content_hash));

-- `app.trust_transition_content_hash` = the single hash a trusted F02 transition decided on.
CREATE POLICY trust_read_target ON public.blueprint_content FOR SELECT TO appf2_f02_trust
  USING (content_hash = NULLIF(current_setting('app.trust_transition_content_hash', true), ''));
CREATE POLICY trust_cas_terminal ON public.blueprint_content FOR UPDATE TO appf2_f02_trust
  USING (content_hash = NULLIF(current_setting('app.trust_transition_content_hash', true), '') AND trust_status = 'VALIDATED')
  WITH CHECK (content_hash = NULLIF(current_setting('app.trust_transition_content_hash', true), '')
    AND trust_status IN ('REVOKED', 'INCOMPATIBLE'));

-- Non-identifying evidence (DATA-MODEL §6.11A/B): no authorization dimension exists in the row.
-- INSERT: a row already past the 90-day cutoff would sit below the aggregate watermark (never counted, instantly
-- deletable), breaking "materialize before delete" (§6.11A.7 / §6.11B.5).
-- SELECT exists only for the ON CONFLICT arbiter / RETURNING check on the proposed row; `app.evidence_source_row_id`
-- is the server-bound id of the single row this statement writes, so the Worker cannot enumerate other rows.
CREATE POLICY worker_insert_live ON public.evidence_intake_observation FOR INSERT TO appf2_worker
  WITH CHECK (received_at >= now() - interval '90 days');
CREATE POLICY worker_conflict_check_bound_row ON public.evidence_intake_observation FOR SELECT TO appf2_worker
  USING (observation_id = NULLIF(current_setting('app.evidence_source_row_id', true), '')::uuid);
CREATE POLICY worker_insert_live ON public.evidence_client_quality_report FOR INSERT TO appf2_worker
  WITH CHECK (received_at >= now() - interval '90 days');
CREATE POLICY worker_returning_bound_row ON public.evidence_client_quality_report FOR SELECT TO appf2_worker
  USING (report_id = NULLIF(current_setting('app.evidence_source_row_id', true), '')::uuid);

-- DATA-MODEL §6.10 / §6.11A.7 / §6.11B.5: raw sources are eligible only when received_at < maintenance_now - 90 days.
CREATE POLICY retention_read_expired ON public.product_event FOR SELECT TO appf2_retention
  USING (received_at < now() - interval '90 days');
CREATE POLICY retention_delete_expired ON public.product_event FOR DELETE TO appf2_retention
  USING (received_at < now() - interval '90 days');
CREATE POLICY retention_read_expired ON public.evidence_intake_observation FOR SELECT TO appf2_retention
  USING (received_at < now() - interval '90 days');
CREATE POLICY retention_delete_expired ON public.evidence_intake_observation FOR DELETE TO appf2_retention
  USING (received_at < now() - interval '90 days');
CREATE POLICY retention_read_expired ON public.evidence_client_quality_report FOR SELECT TO appf2_retention
  USING (received_at < now() - interval '90 days');
CREATE POLICY retention_delete_expired ON public.evidence_client_quality_report FOR DELETE TO appf2_retention
  USING (received_at < now() - interval '90 days');

-- Aggregate watermark may never pass the retention cutoff, so rows hidden above are never skipped by a window.
-- `app.retention_policy_version` = server constant EVIDENCE_AGGREGATE_POLICY_VERSION; every repository aggregate
-- access is already `policy_version = $2`, so a run can never read or rewrite another policy version's history.
CREATE POLICY retention_aggregate_read ON public.evidence_daily_aggregate FOR SELECT TO appf2_retention
  USING (policy_version = NULLIF(current_setting('app.retention_policy_version', true), ''));
CREATE POLICY retention_aggregate_insert ON public.evidence_daily_aggregate FOR INSERT TO appf2_retention
  WITH CHECK (policy_version = NULLIF(current_setting('app.retention_policy_version', true), '')
    AND materialized_through_received_at <= now() - interval '90 days');
CREATE POLICY retention_aggregate_advance ON public.evidence_daily_aggregate FOR UPDATE TO appf2_retention
  USING (policy_version = NULLIF(current_setting('app.retention_policy_version', true), ''))
  WITH CHECK (policy_version = NULLIF(current_setting('app.retention_policy_version', true), '')
    AND materialized_through_received_at <= now() - interval '90 days');

-- F01-API-ID-001A item 4: one CREATE PoP key (reserved `appf2-create-v1.<thumbprint>` Idempotency-Key namespace) binds
-- exactly one logical CREATE. Same-anonymous_id retries keep using their own row (scope key + CAS / lease unchanged);
-- a second anonymous_id can never reserve the same key, even under concurrency.
CREATE UNIQUE INDEX idempotency_operation_create_key_single_holder
  ON public.idempotency_operation (idempotency_key)
  WHERE idempotency_key LIKE 'appf2-create-v1.%';
-- Pre-write check for a caller-proven key only: true when the key is unused or already held by p_anonymous_id.
CREATE FUNCTION public.appf2_create_key_available(p_idempotency_key text, p_anonymous_id uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT p_idempotency_key LIKE 'appf2-create-v1.%' AND NOT EXISTS (
    SELECT 1 FROM public.idempotency_operation o
    WHERE o.idempotency_key = p_idempotency_key AND o.anonymous_id <> p_anonymous_id
  )
$$;
REVOKE ALL ON FUNCTION public.appf2_create_key_available(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.appf2_create_key_available(text, uuid) TO appf2_worker;
