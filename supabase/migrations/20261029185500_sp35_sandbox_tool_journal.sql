-- Sprint 3.5 private Sandbox call journal: identical signed calls are not re-executed
-- after a crash or uncertain network result. NO container is launched by this DDL.
CREATE TABLE public.appf2_agent_sandbox_call (
 job_id uuid NOT NULL,
 owner_anonymous_id uuid NOT NULL,
 call_id text NOT NULL CHECK(call_id ~ '^call_[A-Za-z0-9_-]{4,128}$'),
 model_call_key text NOT NULL CHECK(model_call_key ~ '^[A-Za-z0-9_-]{8,80}$'),
 job_revision integer NOT NULL CHECK(job_revision>=0),
 checkpoint_hash text NOT NULL CHECK(checkpoint_hash ~ '^sha256:[a-f0-9]{64}$'),
 project_hash text NOT NULL CHECK(project_hash ~ '^sha256:[a-f0-9]{64}$'),
 call_hash text NOT NULL CHECK(call_hash ~ '^sha256:[a-f0-9]{64}$'),
 max_charge_cents integer NOT NULL CHECK(max_charge_cents BETWEEN 1 AND 100),
 status text NOT NULL DEFAULT 'RESERVED'
  CHECK(status IN ('RESERVED','IN_FLIGHT','SUCCEEDED','BLOCKED_UNCERTAIN')),
 receipt_json jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(job_id,call_id),
 FOREIGN KEY(job_id,owner_anonymous_id)
  REFERENCES public.appf2_agent_job(job_id,owner_anonymous_id)
  ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY(job_id,model_call_key)
  REFERENCES public.appf2_agent_model_call(job_id,call_key)
  ON UPDATE RESTRICT ON DELETE RESTRICT,
 CHECK ((status='SUCCEEDED' AND jsonb_typeof(receipt_json)='object')
  OR (status<>'SUCCEEDED' AND receipt_json IS NULL)),
 CHECK (receipt_json IS NULL OR octet_length(receipt_json::text)<=16384)
);
CREATE UNIQUE INDEX appf2_sandbox_call_one_active
 ON public.appf2_agent_sandbox_call(job_id)
 WHERE status IN ('RESERVED','IN_FLIGHT','BLOCKED_UNCERTAIN');
ALTER TABLE public.appf2_agent_sandbox_call ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.appf2_agent_sandbox_call FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.appf2_agent_sandbox_call TO appf2_worker;
CREATE POLICY appf2_sandbox_call_select ON public.appf2_agent_sandbox_call
 FOR SELECT TO appf2_worker
 USING (owner_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid);
CREATE POLICY appf2_sandbox_call_insert ON public.appf2_agent_sandbox_call
 FOR INSERT TO appf2_worker
 WITH CHECK(owner_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid);
CREATE POLICY appf2_sandbox_call_update ON public.appf2_agent_sandbox_call
 FOR UPDATE TO appf2_worker
 USING(owner_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid)
 WITH CHECK(owner_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid);

CREATE FUNCTION appf2_internal.sandbox_call_transition_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF ROW(NEW.job_id,NEW.owner_anonymous_id,NEW.call_id,NEW.model_call_key,
   NEW.job_revision,NEW.checkpoint_hash,NEW.project_hash,NEW.call_hash,
   NEW.max_charge_cents,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.job_id,OLD.owner_anonymous_id,OLD.call_id,OLD.model_call_key,
   OLD.job_revision,OLD.checkpoint_hash,OLD.project_hash,OLD.call_hash,
   OLD.max_charge_cents,OLD.created_at)
  OR NOT ((OLD.status='RESERVED' AND NEW.status='IN_FLIGHT')
   OR (OLD.status='IN_FLIGHT' AND NEW.status IN ('SUCCEEDED','BLOCKED_UNCERTAIN')))
 THEN RAISE EXCEPTION 'APPF2_SANDBOX_CALL_ILLEGAL_TRANSITION'; END IF;
 NEW.updated_at=now();
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION appf2_internal.sandbox_call_transition_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER appf2_sandbox_call_guard
 BEFORE UPDATE ON public.appf2_agent_sandbox_call
 FOR EACH ROW EXECUTE FUNCTION appf2_internal.sandbox_call_transition_guard();

CREATE FUNCTION appf2_internal.reserve_agent_sandbox_call(
 p_job_id uuid,p_model_call_key text,p_call_id text,p_revision integer,
 p_checkpoint_hash text,p_project_hash text,p_call_hash text,p_max_charge_cents integer)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE j record; prior record; previous_call record; reserved bigint;
BEGIN
 SELECT * INTO j FROM public.appf2_agent_job
 WHERE job_id=p_job_id
  AND owner_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'APPF2_SANDBOX_JOB_NOT_FOUND'; END IF;
 IF j.revision<>p_revision OR j.checkpoint_hash<>p_checkpoint_hash OR
  j.project_hash<>p_project_hash OR
  j.job_state NOT IN ('CODING','BUILDING','REPAIRING') THEN
  RAISE EXCEPTION 'APPF2_SANDBOX_JOB_STALE_OR_DISALLOWED';
 END IF;
 SELECT * INTO prior FROM public.appf2_agent_sandbox_call
 WHERE job_id=p_job_id AND call_id=p_call_id;
 IF FOUND THEN
  IF prior.model_call_key<>p_model_call_key OR prior.job_revision<>p_revision
   OR prior.checkpoint_hash<>p_checkpoint_hash OR
   prior.project_hash<>p_project_hash OR prior.call_hash<>p_call_hash
   OR prior.max_charge_cents<>p_max_charge_cents THEN
   RAISE EXCEPTION 'APPF2_SANDBOX_REPLAY_MISMATCH';
  END IF;
  RETURN prior.status;
 END IF;
 IF p_call_id !~ '^call_[A-Za-z0-9_-]{4,128}$' OR
  p_call_hash !~ '^sha256:[a-f0-9]{64}$' OR
  p_max_charge_cents<1 OR p_max_charge_cents>100 THEN
  RAISE EXCEPTION 'APPF2_SANDBOX_INVALID_RESERVATION';
 END IF;
 SELECT * INTO previous_call FROM public.appf2_agent_model_call
 WHERE job_id=p_job_id AND call_key=p_model_call_key AND status='SUCCEEDED'
  AND job_revision=p_revision AND checkpoint_hash=p_checkpoint_hash;
 IF NOT FOUND THEN RAISE EXCEPTION 'APPF2_SANDBOX_MODEL_RESPONSE_NOT_SAVED'; END IF;
 IF EXISTS(SELECT 1 FROM public.appf2_agent_sandbox_call
  WHERE job_id=p_job_id AND status IN ('RESERVED','IN_FLIGHT','BLOCKED_UNCERTAIN')) THEN
  RAISE EXCEPTION 'APPF2_SANDBOX_ACTIVE_OR_UNCERTAIN';
 END IF;
 SELECT
  (SELECT coalesce(sum(max_charge_cents),0)
    FROM public.appf2_agent_model_call
    WHERE job_id=p_job_id AND status<>'REJECTED_PRE_SEND')
  + (SELECT coalesce(sum(max_charge_cents),0)
    FROM public.appf2_agent_sandbox_call WHERE job_id=p_job_id)
 INTO reserved;
 IF reserved+p_max_charge_cents>
  coalesce((j.checkpoint->'budget'->>'max_cost_cents')::integer,0) THEN
  RAISE EXCEPTION 'APPF2_SANDBOX_BUDGET_EXCEEDED';
 END IF;
 INSERT INTO public.appf2_agent_sandbox_call(job_id,owner_anonymous_id,
  call_id,model_call_key,job_revision,checkpoint_hash,project_hash,call_hash,
  max_charge_cents)
 VALUES(p_job_id,j.owner_anonymous_id,p_call_id,p_model_call_key,p_revision,
  p_checkpoint_hash,p_project_hash,p_call_hash,p_max_charge_cents);
 RETURN 'RESERVED';
END $$;
REVOKE ALL ON FUNCTION appf2_internal.reserve_agent_sandbox_call(
 uuid,text,text,integer,text,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION appf2_internal.reserve_agent_sandbox_call(
 uuid,text,text,integer,text,text,text,integer) TO appf2_worker;

-- Same per-job budget across model and sandbox reservations; no double-spend.
CREATE OR REPLACE FUNCTION appf2_internal.reserve_agent_model_call(
 p_job_id uuid, p_call_key text, p_job_revision integer, p_checkpoint_hash text,
 p_request_hash text, p_model text, p_max_charge_cents integer)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE j record; prior record; reserved bigint;
BEGIN
 SELECT * INTO j FROM public.appf2_agent_job
 WHERE job_id=p_job_id
  AND owner_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'APPF2_MODEL_JOB_NOT_FOUND'; END IF;
 IF j.revision<>p_job_revision OR j.checkpoint_hash<>p_checkpoint_hash OR
  j.job_state IN ('READY','FAILED','AWAITING_CONSENT') THEN
  RAISE EXCEPTION 'APPF2_MODEL_JOB_STALE_OR_PAUSED';
 END IF;
 SELECT * INTO prior FROM public.appf2_agent_model_call
  WHERE job_id=p_job_id AND call_key=p_call_key;
 IF FOUND THEN
  IF prior.request_hash<>p_request_hash OR prior.model<>p_model OR
   prior.job_revision<>p_job_revision OR
   prior.checkpoint_hash<>p_checkpoint_hash OR
   prior.max_charge_cents<>p_max_charge_cents THEN
   RAISE EXCEPTION 'APPF2_MODEL_REQUEST_REPLAY_MISMATCH';
  END IF;
  RETURN prior.status;
 END IF;
 IF p_model<>'gpt-6.1-sol' OR p_max_charge_cents<1 OR
  p_max_charge_cents>1000000 OR
  p_call_key !~ '^[A-Za-z0-9_-]{8,80}$' OR
  p_request_hash !~ '^sha256:[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'APPF2_MODEL_INVALID_RESERVATION';
 END IF;
 IF EXISTS(SELECT 1 FROM public.appf2_agent_model_call
   WHERE job_id=p_job_id AND status IN ('RESERVED','IN_FLIGHT','BLOCKED_UNCERTAIN'))
  OR EXISTS(SELECT 1 FROM public.appf2_agent_sandbox_call
   WHERE job_id=p_job_id AND status IN ('RESERVED','IN_FLIGHT','BLOCKED_UNCERTAIN'))
 THEN RAISE EXCEPTION 'APPF2_JOB_ACTIVE_OR_UNCERTAIN_CHARGE'; END IF;
 SELECT
  (SELECT coalesce(sum(max_charge_cents),0) FROM public.appf2_agent_model_call
   WHERE job_id=p_job_id AND status<>'REJECTED_PRE_SEND')
  +(SELECT coalesce(sum(max_charge_cents),0) FROM public.appf2_agent_sandbox_call
   WHERE job_id=p_job_id)
 INTO reserved;
 IF reserved+p_max_charge_cents>
  coalesce((j.checkpoint->'budget'->>'max_cost_cents')::integer,0) THEN
  RAISE EXCEPTION 'APPF2_MODEL_SPEND_BUDGET_EXCEEDED';
 END IF;
 INSERT INTO public.appf2_agent_model_call(job_id,owner_anonymous_id,
  call_key,job_revision,checkpoint_hash,request_hash,model,max_charge_cents)
 VALUES(p_job_id,j.owner_anonymous_id,p_call_key,p_job_revision,p_checkpoint_hash,
  p_request_hash,p_model,p_max_charge_cents);
 RETURN 'RESERVED';
END $$;
