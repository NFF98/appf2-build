-- Browser Run paid dispatch uses a durable one-shot fence per immutable App.
-- No Browser Run or Cloudflare payment is initiated by this migration.
CREATE TABLE public.appf2_agent_browser_qa_attempt(
 job_id uuid NOT NULL,
 owner_anonymous_id uuid NOT NULL,
 project_hash text NOT NULL CHECK(project_hash ~ '^sha256:[a-f0-9]{64}$'),
 job_revision integer NOT NULL CHECK(job_revision>=1),
 build_call_id text NOT NULL CHECK(build_call_id ~ '^call_[A-Za-z0-9_-]{4,74}$'),
 test_call_id text NOT NULL CHECK(test_call_id ~ '^call_[A-Za-z0-9_-]{4,74}$'),
 status text NOT NULL DEFAULT 'IN_FLIGHT'
  CHECK(status IN ('IN_FLIGHT','SUCCEEDED','BLOCKED_UNCERTAIN')),
 receipt_json jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(job_id,project_hash),
 FOREIGN KEY(job_id,owner_anonymous_id)
  REFERENCES public.appf2_agent_job(job_id,owner_anonymous_id)
  ON UPDATE RESTRICT ON DELETE RESTRICT,
 CHECK((status='SUCCEEDED' AND jsonb_typeof(receipt_json)='object')
  OR (status<>'SUCCEEDED' AND receipt_json IS NULL)),
 CHECK(receipt_json IS NULL OR octet_length(receipt_json::text)<=65536)
);
ALTER TABLE public.appf2_agent_browser_qa_attempt ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.appf2_agent_browser_qa_attempt FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.appf2_agent_browser_qa_attempt TO appf2_worker;
CREATE POLICY appf2_browser_qa_select ON public.appf2_agent_browser_qa_attempt
 FOR SELECT TO appf2_worker
 USING(owner_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid);
CREATE POLICY appf2_browser_qa_insert ON public.appf2_agent_browser_qa_attempt
 FOR INSERT TO appf2_worker
 WITH CHECK(owner_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid);
CREATE POLICY appf2_browser_qa_update ON public.appf2_agent_browser_qa_attempt
 FOR UPDATE TO appf2_worker
 USING(owner_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid)
 WITH CHECK(owner_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid);
CREATE FUNCTION appf2_internal.browser_qa_attempt_transition_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF ROW(NEW.job_id,NEW.owner_anonymous_id,NEW.project_hash,
  NEW.job_revision,NEW.build_call_id,NEW.test_call_id,NEW.created_at)
  IS DISTINCT FROM ROW(OLD.job_id,OLD.owner_anonymous_id,OLD.project_hash,
  OLD.job_revision,OLD.build_call_id,OLD.test_call_id,OLD.created_at)
 OR OLD.status<>'IN_FLIGHT' OR
  NEW.status NOT IN ('SUCCEEDED','BLOCKED_UNCERTAIN')
 THEN RAISE EXCEPTION 'APPF2_BROWSER_QA_TRANSITION_FORBIDDEN'; END IF;
 NEW.updated_at=now();RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION appf2_internal.browser_qa_attempt_transition_guard()
 FROM PUBLIC,anon,authenticated;
CREATE TRIGGER appf2_agent_browser_qa_attempt_guard
 BEFORE UPDATE ON public.appf2_agent_browser_qa_attempt
 FOR EACH ROW EXECUTE FUNCTION appf2_internal.browser_qa_attempt_transition_guard();
