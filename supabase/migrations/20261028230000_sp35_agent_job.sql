-- Sprint 3.5: private candidate Agent job journal, never an ACTIVE App/F02 grant.
-- No public API path is enabled by this migration.
CREATE TABLE public.appf2_agent_job (
 job_id uuid PRIMARY KEY,
 owner_anonymous_id uuid NOT NULL,
 owner_key_thumbprint text NOT NULL CHECK(owner_key_thumbprint ~ '^[a-f0-9]{64}$'),
 idempotency_key text NOT NULL CHECK(idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
 request_hash text NOT NULL CHECK(request_hash ~ '^sha256:[a-f0-9]{64}$'),
 revision integer NOT NULL DEFAULT 0 CHECK(revision >= 0),
 checkpoint_hash text NOT NULL CHECK(checkpoint_hash ~ '^sha256:[a-f0-9]{64}$'),
 project_hash text NOT NULL CHECK(project_hash ~ '^sha256:[a-f0-9]{64}$'),
 job_state text NOT NULL DEFAULT 'CREATED' CHECK(job_state IN
  ('CREATED','PLANNING','CODING','BUILDING','TESTING','REPAIRING','READY','FAILED','AWAITING_CONSENT')),
 checkpoint jsonb NOT NULL CHECK(jsonb_typeof(checkpoint) = 'object' AND
  octet_length(checkpoint::text) <= 32768),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT appf2_agent_idempotent UNIQUE(owner_key_thumbprint,idempotency_key),
 CONSTRAINT appf2_agent_checkpoint_link CHECK (
  checkpoint->>'job_id' = job_id::text AND
  checkpoint->>'project_hash' = project_hash AND
  checkpoint->>'state' = job_state AND
  (checkpoint->>'step')::integer >= 0)
);
CREATE INDEX appf2_agent_owner_jobs_idx
 ON public.appf2_agent_job(owner_anonymous_id,updated_at DESC);
ALTER TABLE public.appf2_agent_job ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.appf2_agent_job FROM PUBLIC,anon,authenticated,appf2_worker;
GRANT SELECT,INSERT,UPDATE ON public.appf2_agent_job TO appf2_worker;
CREATE POLICY appf2_agent_job_read ON public.appf2_agent_job FOR SELECT TO appf2_worker
 USING(owner_anonymous_id = nullif(current_setting('app.anonymous_id',true),'')::uuid);
CREATE POLICY appf2_agent_job_start ON public.appf2_agent_job FOR INSERT TO appf2_worker
 WITH CHECK(owner_anonymous_id = nullif(current_setting('app.anonymous_id',true),'')::uuid
   AND revision=0 AND job_state='CREATED' AND checkpoint->>'version'='APPF2_AGENT_CHECKPOINT_V1');
CREATE POLICY appf2_agent_job_advance ON public.appf2_agent_job FOR UPDATE TO appf2_worker
 USING(owner_anonymous_id = nullif(current_setting('app.anonymous_id',true),'')::uuid
   AND job_state NOT IN ('READY','FAILED'))
 WITH CHECK(owner_anonymous_id = nullif(current_setting('app.anonymous_id',true),'')::uuid);
-- Fail-closed immutable authority, CAS revision, monotonic spend and valid state transitions.
CREATE FUNCTION appf2_internal.agent_job_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.job_id<>OLD.job_id OR NEW.owner_anonymous_id<>OLD.owner_anonymous_id OR
   NEW.owner_key_thumbprint<>OLD.owner_key_thumbprint OR
   NEW.idempotency_key<>OLD.idempotency_key OR NEW.request_hash<>OLD.request_hash OR
   NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1 OR
   OLD.job_state IN ('READY','FAILED') OR
   (NEW.checkpoint->>'cost_cents')::integer < (OLD.checkpoint->>'cost_cents')::integer OR
   (NEW.checkpoint->>'tokens_used')::integer < (OLD.checkpoint->>'tokens_used')::integer OR
   (NEW.checkpoint->>'step')::integer < (OLD.checkpoint->>'step')::integer
 THEN RAISE EXCEPTION 'APPF2_AGENT_IMMUTABILITY_OR_REVISION'; END IF;
 IF NOT (
   (OLD.job_state='CREATED' AND NEW.job_state IN ('PLANNING','FAILED')) OR
   (OLD.job_state='PLANNING' AND NEW.job_state IN ('CODING','AWAITING_CONSENT','FAILED')) OR
   (OLD.job_state='CODING' AND NEW.job_state IN ('CODING','BUILDING','AWAITING_CONSENT','FAILED')) OR
   (OLD.job_state='BUILDING' AND NEW.job_state IN ('TESTING','REPAIRING','FAILED')) OR
   (OLD.job_state='TESTING' AND NEW.job_state IN ('READY','REPAIRING','FAILED')) OR
   (OLD.job_state='REPAIRING' AND NEW.job_state IN ('CODING','BUILDING','AWAITING_CONSENT','FAILED')) OR
   (OLD.job_state='AWAITING_CONSENT' AND NEW.job_state IN ('PLANNING','CODING','REPAIRING','FAILED'))
 ) THEN RAISE EXCEPTION 'APPF2_AGENT_ILLEGAL_STATE'; END IF;
 NEW.updated_at=now();
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION appf2_internal.agent_job_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER appf2_agent_job_guard BEFORE UPDATE ON public.appf2_agent_job
 FOR EACH ROW EXECUTE FUNCTION appf2_internal.agent_job_guard();
