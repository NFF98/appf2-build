-- Sprint 3.5: private, at-most-once paid model-call journal.
-- No paid request is sent by this migration, and public routes are unchanged.
ALTER TABLE public.appf2_agent_job
 ADD CONSTRAINT appf2_agent_job_owner_key UNIQUE(job_id,owner_anonymous_id);

CREATE TABLE public.appf2_agent_model_call (
 job_id uuid NOT NULL,
 owner_anonymous_id uuid NOT NULL,
 call_key text NOT NULL CHECK(call_key ~ '^[A-Za-z0-9_-]{8,80}$'),
 job_revision integer NOT NULL CHECK(job_revision >= 0),
 checkpoint_hash text NOT NULL CHECK(checkpoint_hash ~ '^sha256:[a-f0-9]{64}$'),
 request_hash text NOT NULL CHECK(request_hash ~ '^sha256:[a-f0-9]{64}$'),
 model text NOT NULL CHECK(model ~ '^[A-Za-z0-9_.-]{3,80}$'),
 max_charge_cents integer NOT NULL CHECK(max_charge_cents BETWEEN 1 AND 1000000),
 status text NOT NULL DEFAULT 'RESERVED' CHECK(status IN
   ('RESERVED','IN_FLIGHT','SUCCEEDED','BLOCKED_UNCERTAIN','REJECTED_PRE_SEND')),
 response_json jsonb,
 response_id text,
 input_tokens integer CHECK(input_tokens >= 0),
 output_tokens integer CHECK(output_tokens >= 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(job_id,call_key),
 FOREIGN KEY(job_id,owner_anonymous_id)
  REFERENCES public.appf2_agent_job(job_id,owner_anonymous_id)
  ON UPDATE RESTRICT ON DELETE RESTRICT,
 CHECK (
  (status='SUCCEEDED' AND jsonb_typeof(response_json)='object'
    AND response_id ~ '^resp_[A-Za-z0-9_-]{6,160}$'
    AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL)
  OR (status<>'SUCCEEDED' AND response_json IS NULL AND response_id IS NULL
    AND input_tokens IS NULL AND output_tokens IS NULL)
 ),
 CHECK(response_json IS NULL OR octet_length(response_json::text)<=524288)
);
CREATE UNIQUE INDEX appf2_model_call_one_active
 ON public.appf2_agent_model_call(job_id)
 WHERE status IN ('RESERVED','IN_FLIGHT');
CREATE INDEX appf2_model_call_owner_recent
 ON public.appf2_agent_model_call(owner_anonymous_id,created_at DESC);
ALTER TABLE public.appf2_agent_model_call ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.appf2_agent_model_call FROM PUBLIC,anon,authenticated,appf2_worker;
GRANT SELECT,UPDATE ON public.appf2_agent_model_call TO appf2_worker;
CREATE POLICY appf2_agent_model_call_read ON public.appf2_agent_model_call
 FOR SELECT TO appf2_worker
 USING(owner_anonymous_id = nullif(current_setting('app.anonymous_id',true),'')::uuid);
CREATE POLICY appf2_agent_model_call_update ON public.appf2_agent_model_call
 FOR UPDATE TO appf2_worker
 USING(owner_anonymous_id = nullif(current_setting('app.anonymous_id',true),'')::uuid)
 WITH CHECK(owner_anonymous_id = nullif(current_setting('app.anonymous_id',true),'')::uuid);

-- Only transition flags/evidence are mutable. No reset to RESERVED or IN_FLIGHT.
CREATE FUNCTION appf2_internal.model_call_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.job_id<>OLD.job_id OR NEW.owner_anonymous_id<>OLD.owner_anonymous_id
  OR NEW.call_key<>OLD.call_key OR NEW.job_revision<>OLD.job_revision
  OR NEW.checkpoint_hash<>OLD.checkpoint_hash OR NEW.request_hash<>OLD.request_hash
  OR NEW.model<>OLD.model OR NEW.max_charge_cents<>OLD.max_charge_cents
  OR NEW.created_at<>OLD.created_at
  OR NOT (
   (OLD.status='RESERVED' AND NEW.status IN ('IN_FLIGHT','REJECTED_PRE_SEND'))
   OR (OLD.status='IN_FLIGHT' AND NEW.status IN ('SUCCEEDED','BLOCKED_UNCERTAIN'))
  ) THEN
  RAISE EXCEPTION 'APPF2_MODEL_CALL_INVALID_TRANSITION';
 END IF;
 NEW.updated_at=now();
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION appf2_internal.model_call_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER appf2_model_call_guard BEFORE UPDATE ON public.appf2_agent_model_call
 FOR EACH ROW EXECUTE FUNCTION appf2_internal.model_call_guard();

-- A single INVOKER transaction takes the job row lock BEFORE sum and insert.
-- Repeat requests reuse their original key and never silently re-charge.
CREATE FUNCTION appf2_internal.reserve_agent_model_call(
 p_job_id uuid, p_call_key text, p_job_revision integer, p_checkpoint_hash text,
 p_request_hash text, p_model text, p_max_charge_cents integer)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE
 j record;
 existing record;
 reserved bigint;
BEGIN
 SELECT * INTO j FROM public.appf2_agent_job
  WHERE job_id=p_job_id
    AND owner_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid
  FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'APPF2_MODEL_JOB_NOT_FOUND'; END IF;
 IF j.revision<>p_job_revision OR j.checkpoint_hash<>p_checkpoint_hash
   OR j.job_state IN ('READY','FAILED','AWAITING_CONSENT') THEN
   RAISE EXCEPTION 'APPF2_MODEL_JOB_STALE_OR_PAUSED';
 END IF;
 SELECT * INTO existing FROM public.appf2_agent_model_call
   WHERE job_id=p_job_id AND call_key=p_call_key;
 IF FOUND THEN
   IF existing.request_hash<>p_request_hash OR existing.model<>p_model
    OR existing.job_revision<>p_job_revision OR
    existing.checkpoint_hash<>p_checkpoint_hash
    OR existing.max_charge_cents<>p_max_charge_cents THEN
     RAISE EXCEPTION 'APPF2_MODEL_REQUEST_REPLAY_MISMATCH';
   END IF;
   RETURN existing.status;
 END IF;
 IF p_model<>'gpt-6.1-sol' OR p_max_charge_cents<1 OR
   p_max_charge_cents>1000000 OR
   p_call_key !~ '^[A-Za-z0-9_-]{8,80}$' OR
   p_request_hash !~ '^sha256:[a-f0-9]{64}$' THEN
   RAISE EXCEPTION 'APPF2_MODEL_INVALID_RESERVATION';
 END IF;
 IF EXISTS (SELECT 1 FROM public.appf2_agent_model_call
   WHERE job_id=p_job_id AND status IN ('RESERVED','IN_FLIGHT','BLOCKED_UNCERTAIN')) THEN
   RAISE EXCEPTION 'APPF2_MODEL_ACTIVE_OR_UNCERTAIN_CALL';
 END IF;
 SELECT coalesce(sum(max_charge_cents),0) INTO reserved
  FROM public.appf2_agent_model_call
  WHERE job_id=p_job_id AND status<>'REJECTED_PRE_SEND';
 IF reserved+p_max_charge_cents >
   (j.checkpoint->'budget'->>'max_cost_cents')::integer THEN
   RAISE EXCEPTION 'APPF2_MODEL_SPEND_BUDGET_EXCEEDED';
 END IF;
 INSERT INTO public.appf2_agent_model_call(job_id,owner_anonymous_id,call_key,
   job_revision,checkpoint_hash,request_hash,model,max_charge_cents)
 VALUES(p_job_id,j.owner_anonymous_id,p_call_key,p_job_revision,
   p_checkpoint_hash,p_request_hash,p_model,p_max_charge_cents);
 RETURN 'RESERVED';
END $$;
REVOKE ALL ON FUNCTION appf2_internal.reserve_agent_model_call(
 uuid,text,integer,text,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT INSERT ON public.appf2_agent_model_call TO appf2_worker;
GRANT EXECUTE ON FUNCTION appf2_internal.reserve_agent_model_call(
 uuid,text,integer,text,text,text,integer) TO appf2_worker;
