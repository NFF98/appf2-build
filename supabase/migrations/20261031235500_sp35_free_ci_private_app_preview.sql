-- Private, immutable, bounded built Vite preview from a verified FREE runner.
-- This is NOT F02 admission, public Blueprint/share or personal runtime data.
CREATE TABLE public.appf2_agent_free_ci_preview(
 job_id uuid NOT NULL,
 owner_anonymous_id uuid NOT NULL,
 project_hash text NOT NULL CHECK(project_hash~'^sha256:[a-f0-9]{64}$'),
 run_id text NOT NULL CHECK(run_id~'^[0-9]{6,20}$'),
 artifact_hash text NOT NULL CHECK(artifact_hash~'^sha256:[a-f0-9]{64}$'),
 preview_json jsonb NOT NULL CHECK(jsonb_typeof(preview_json)='object'
  AND octet_length(preview_json::text)<=430000),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(job_id,project_hash),
 FOREIGN KEY(job_id,project_hash) REFERENCES
  public.appf2_agent_free_ci_receipt(job_id,project_hash)
  ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY(job_id,owner_anonymous_id) REFERENCES
  public.appf2_agent_job(job_id,owner_anonymous_id)
  ON UPDATE RESTRICT ON DELETE RESTRICT
);
ALTER TABLE public.appf2_agent_free_ci_preview ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.appf2_agent_free_ci_preview FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.appf2_agent_free_ci_preview TO appf2_worker;
CREATE POLICY appf2_agent_free_ci_preview_read ON public.appf2_agent_free_ci_preview
 FOR SELECT TO appf2_worker
 USING(owner_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid);
CREATE POLICY appf2_agent_free_ci_preview_insert ON public.appf2_agent_free_ci_preview
 FOR INSERT TO appf2_worker
 WITH CHECK(owner_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid);
