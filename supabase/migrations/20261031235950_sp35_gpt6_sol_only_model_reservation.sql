-- Sprint 3.5: align paid FREE Docker model admission with the model actually
-- sent to OpenAI Responses. Preserve owner, immutable request hash,
-- replay fencing, single active job/runner and cumulative cents cap.
-- Staging migration only; no model call and no publication on apply.
CREATE OR REPLACE FUNCTION appf2_internal.reserve_agent_model_call(
 p_job_id uuid, p_call_key text, p_job_revision integer, p_checkpoint_hash text,
 p_request_hash text, p_model text, p_max_charge_cents integer)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $function$
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
 -- Sprint 3.5 QA, CODE and REPAIR use GPT-6.1 Sol only.
 -- Existing replay checks occur before the new-request model allowlist.
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
END $function$;
