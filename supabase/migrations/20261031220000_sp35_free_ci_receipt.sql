-- Persist immutable GitHub OIDC-authorized locked build/Chromium smoke, NOT QA/pass.
CREATE TABLE public.appf2_agent_free_ci_receipt (
 job_id uuid NOT NULL,
 owner_anonymous_id uuid NOT NULL,
 project_hash text NOT NULL CHECK(project_hash ~ '^sha256:[a-f0-9]{64}$'),
 run_id text NOT NULL CHECK(run_id ~ '^[0-9]{6,20}$'),
 built_artifact_hash text NOT NULL CHECK(built_artifact_hash ~ '^sha256:[a-f0-9]{64}$'),
 receipt_json jsonb NOT NULL CHECK(jsonb_typeof(receipt_json)='object'
  AND octet_length(receipt_json::text)<=2048
  AND receipt_json->>'original_requirements_qa'='false'
  AND receipt_json->>'app_published'='false'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(job_id,project_hash),
 FOREIGN KEY(job_id,owner_anonymous_id)
  REFERENCES public.appf2_agent_job(job_id,owner_anonymous_id)
  ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY(owner_anonymous_id,project_hash)
  REFERENCES public.appf2_agent_project_snapshot(owner_anonymous_id,project_hash)
  ON UPDATE RESTRICT ON DELETE RESTRICT
);
ALTER TABLE public.appf2_agent_free_ci_receipt ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.appf2_agent_free_ci_receipt FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.appf2_agent_free_ci_receipt TO appf2_worker;
CREATE POLICY appf2_agent_free_ci_read ON public.appf2_agent_free_ci_receipt
 FOR SELECT TO appf2_worker
 USING(owner_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid);
CREATE POLICY appf2_agent_free_ci_insert ON public.appf2_agent_free_ci_receipt
 FOR INSERT TO appf2_worker
 WITH CHECK(owner_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid);
