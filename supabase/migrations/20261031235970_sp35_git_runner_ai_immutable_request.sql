-- Sprint 3.5: private origin-bound input for GitHub OIDC model runner.
-- Runner workflow inputs contain ONLY an AES-GCM scope ticket; never the
-- original prompt, provider key, model response, source, or anonymous owner.
-- This table is NOT exposed to anon/authenticated; its first OIDC claim is
-- immutable and no concurrent or restarted run can take the same paid work.
CREATE TABLE public.appf2_agent_model_runner_request (
 job_id uuid NOT NULL,
 owner_anonymous_id uuid NOT NULL,
 call_key text NOT NULL CHECK(call_key ~ '^sp35_free_ai_(qa|code|repair)_v1$'),
 request_hash text NOT NULL CHECK(request_hash ~ '^sha256:[a-f0-9]{64}$'),
 model text NOT NULL DEFAULT 'gpt-6.1-sol' CHECK(model='gpt-6.1-sol'),
 request_json jsonb NOT NULL CHECK(jsonb_typeof(request_json)='object'
  AND octet_length(request_json::text)<=45000),
 runner_run_id text CHECK(runner_run_id ~ '^[0-9]{6,20}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(job_id,call_key),
 FOREIGN KEY(job_id,owner_anonymous_id)
  REFERENCES public.appf2_agent_job(job_id,owner_anonymous_id)
  ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY(job_id,call_key)
  REFERENCES public.appf2_agent_model_call(job_id,call_key)
  ON UPDATE RESTRICT ON DELETE RESTRICT
);
ALTER TABLE public.appf2_agent_model_runner_request ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.appf2_agent_model_runner_request FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.appf2_agent_model_runner_request TO appf2_worker;
CREATE POLICY sp35_ai_runner_request_owner_read
 ON public.appf2_agent_model_runner_request FOR SELECT TO appf2_worker
 USING(owner_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid);
CREATE POLICY sp35_ai_runner_request_owner_insert
 ON public.appf2_agent_model_runner_request FOR INSERT TO appf2_worker
 WITH CHECK(owner_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid
  AND EXISTS (SELECT 1 FROM public.appf2_agent_model_call m
   WHERE m.job_id=appf2_agent_model_runner_request.job_id
    AND m.owner_anonymous_id=appf2_agent_model_runner_request.owner_anonymous_id
    AND m.call_key=appf2_agent_model_runner_request.call_key
    AND m.status='RESERVED'
    AND m.request_hash=appf2_agent_model_runner_request.request_hash
    AND m.model=appf2_agent_model_runner_request.model));
CREATE POLICY sp35_ai_runner_request_owner_claim
 ON public.appf2_agent_model_runner_request FOR UPDATE TO appf2_worker
 USING(owner_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid)
 WITH CHECK(owner_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid);
CREATE FUNCTION appf2_internal.sp35_ai_runner_request_guard()
 RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $body$
BEGIN
 IF NEW.job_id<>OLD.job_id OR NEW.owner_anonymous_id<>OLD.owner_anonymous_id
  OR NEW.call_key<>OLD.call_key OR NEW.request_hash<>OLD.request_hash
  OR NEW.model<>OLD.model OR NEW.request_json<>OLD.request_json
  OR NEW.created_at<>OLD.created_at OR OLD.runner_run_id IS NOT NULL
  OR NEW.runner_run_id !~ '^[0-9]{6,20}$' THEN
  RAISE EXCEPTION 'APPF2_RUNNER_REQUEST_IMMUTABLE';
 END IF;
 RETURN NEW;
END $body$;
REVOKE ALL ON FUNCTION appf2_internal.sp35_ai_runner_request_guard()
 FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sp35_ai_runner_request_guard BEFORE UPDATE
 ON public.appf2_agent_model_runner_request
 FOR EACH ROW EXECUTE FUNCTION appf2_internal.sp35_ai_runner_request_guard();
