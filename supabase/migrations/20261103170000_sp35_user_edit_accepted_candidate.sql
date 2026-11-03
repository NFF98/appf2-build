-- Sprint 3.5: accepted pointer MUST NOT be the mutable Agent Job head.
-- Owner-bound private staging ledger; no public Data API grants.
CREATE TABLE public.appf2_agent_accepted_version (
 job_id uuid PRIMARY KEY REFERENCES public.appf2_agent_job(job_id),
 owner_anonymous_id uuid NOT NULL,
 project_hash text NOT NULL CHECK(project_hash ~ '^sha256:[a-f0-9]{64}$'),
 project_revision integer NOT NULL CHECK(project_revision>=2),
 generation integer NOT NULL DEFAULT 0 CHECK(generation>=0),
 requirements_text text NOT NULL CHECK(octet_length(requirements_text)<=24000),
 qa_plan jsonb NOT NULL CHECK(jsonb_typeof(qa_plan)='object' AND octet_length(qa_plan::text)<=24000),
 qa_plan_hash text NOT NULL CHECK(qa_plan_hash ~ '^sha256:[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(job_id,owner_anonymous_id)
);
CREATE TABLE public.appf2_agent_user_edit (
 edit_id uuid PRIMARY KEY,
 job_id uuid NOT NULL,
 owner_anonymous_id uuid NOT NULL,
 base_project_hash text NOT NULL CHECK(base_project_hash ~ '^sha256:[a-f0-9]{64}$'),
 base_generation integer NOT NULL CHECK(base_generation>=0),
 user_request text NOT NULL CHECK(char_length(user_request) BETWEEN 5 AND 800),
 new_qa_plan jsonb NOT NULL CHECK(jsonb_typeof(new_qa_plan)='object' AND octet_length(new_qa_plan::text)<=16000),
 combined_qa_plan jsonb NOT NULL CHECK(jsonb_typeof(combined_qa_plan)='object' AND octet_length(combined_qa_plan::text)<=24000),
 combined_qa_hash text NOT NULL CHECK(combined_qa_hash ~ '^sha256:[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN ('DRAFT','MODEL_PENDING','QA_REQUIRED','QA_FAILED','ACCEPTED','REJECTED','UNCERTAIN')),
 candidate_project_hash text CHECK(candidate_project_hash IS NULL OR candidate_project_hash ~ '^sha256:[a-f0-9]{64}$'),
 candidate_project_revision integer,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(job_id,owner_anonymous_id) REFERENCES public.appf2_agent_accepted_version(job_id,owner_anonymous_id)
);
CREATE UNIQUE INDEX appf2_agent_only_one_open_edit ON public.appf2_agent_user_edit(job_id)
 WHERE state IN ('DRAFT','MODEL_PENDING','QA_REQUIRED','QA_FAILED','UNCERTAIN');
CREATE INDEX appf2_agent_user_edit_owner_idx ON public.appf2_agent_user_edit(owner_anonymous_id,job_id,created_at DESC);
ALTER TABLE public.appf2_agent_accepted_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appf2_agent_user_edit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.appf2_agent_accepted_version,public.appf2_agent_user_edit FROM PUBLIC,anon,authenticated,appf2_worker;
GRANT SELECT,INSERT,UPDATE ON public.appf2_agent_accepted_version,public.appf2_agent_user_edit TO appf2_worker;
CREATE POLICY appf2_accepted_worker_scope ON public.appf2_agent_accepted_version FOR ALL TO appf2_worker
 USING(owner_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid)
 WITH CHECK(owner_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid);
CREATE POLICY appf2_edit_worker_scope ON public.appf2_agent_user_edit FOR ALL TO appf2_worker
 USING(owner_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid)
 WITH CHECK(owner_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid);
-- Atomic accept: never permit QA bypass or lost-update of the accepted head.
CREATE FUNCTION appf2_internal.accept_user_edit(
 p_job uuid,p_edit uuid,p_owner uuid,p_expected_hash text,p_expected_generation integer)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a record; e record; r record; accepted integer;
BEGIN
 SELECT * INTO a FROM public.appf2_agent_accepted_version
 WHERE job_id=p_job AND owner_anonymous_id=p_owner FOR UPDATE;
 IF NOT FOUND OR a.project_hash<>p_expected_hash OR a.generation<>p_expected_generation THEN
  RAISE EXCEPTION 'SP35_EDIT_ACCEPTED_CAS_CONFLICT';
 END IF;
 SELECT * INTO e FROM public.appf2_agent_user_edit
 WHERE edit_id=p_edit AND job_id=p_job AND owner_anonymous_id=p_owner FOR UPDATE;
 IF NOT FOUND OR e.state<>'QA_REQUIRED' OR e.base_project_hash<>a.project_hash OR
  e.base_generation<>a.generation OR e.candidate_project_hash IS NULL THEN
  RAISE EXCEPTION 'SP35_EDIT_NOT_READY';
 END IF;
 SELECT r.receipt_json,p.preview_json INTO r
 FROM public.appf2_agent_free_ci_receipt r
 JOIN public.appf2_agent_free_ci_preview p
  ON p.job_id=r.job_id AND p.owner_anonymous_id=r.owner_anonymous_id
  AND p.project_hash=r.project_hash AND p.run_id=r.run_id AND p.artifact_hash=r.built_artifact_hash
 WHERE r.job_id=p_job AND r.owner_anonymous_id=p_owner AND r.project_hash=e.candidate_project_hash;
 IF NOT FOUND OR (r.receipt_json->>'version') IS DISTINCT FROM 'APPF2_FREE_CI_SMOKE_V1' OR
  (r.receipt_json->>'qa_plan_hash') IS DISTINCT FROM e.combined_qa_hash OR
  jsonb_typeof(r.receipt_json->'qa_checks') IS DISTINCT FROM 'array' OR
  jsonb_array_length(r.receipt_json->'qa_checks')<>jsonb_array_length(e.combined_qa_plan->'criteria') OR
  EXISTS(SELECT 1 FROM jsonb_array_elements(r.receipt_json->'qa_checks') WITH ORDINALITY AS checks(c,i)
    JOIN LATERAL (SELECT e.combined_qa_plan->'criteria'->(checks.i::int-1) AS criterion) expected ON true
    WHERE (checks.c->>'verdict') IS DISTINCT FROM 'PASS' OR (checks.c->>'criterion_id') IS DISTINCT FROM (expected.criterion->>'id')
    OR coalesce(checks.c->>'evidence_hash','') !~ '^sha256:[a-f0-9]{64}
    OR (expected.criterion->>'automatable') IS DISTINCT FROM 'true')
 THEN RAISE EXCEPTION 'SP35_EDIT_INCOMPLETE_QA';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.appf2_agent_job j WHERE j.job_id=p_job
   AND j.owner_anonymous_id=p_owner AND j.project_hash=e.candidate_project_hash) THEN
  RAISE EXCEPTION 'SP35_EDIT_JOB_HEAD_CHANGED';
 END IF;
 UPDATE public.appf2_agent_accepted_version SET project_hash=e.candidate_project_hash,
  project_revision=e.candidate_project_revision,qa_plan=e.combined_qa_plan,
  qa_plan_hash=e.combined_qa_hash,
  requirements_text=a.requirements_text||E'\n'||e.user_request,
  generation=generation+1,updated_at=now()
 WHERE job_id=p_job AND owner_anonymous_id=p_owner;
 UPDATE public.appf2_agent_user_edit SET state='ACCEPTED',updated_at=now() WHERE edit_id=p_edit;
 accepted:=a.generation+1;
 RETURN accepted;
END $$;
REVOKE ALL ON FUNCTION appf2_internal.accept_user_edit(uuid,uuid,uuid,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION appf2_internal.accept_user_edit(uuid,uuid,uuid,text,integer) TO appf2_worker;
