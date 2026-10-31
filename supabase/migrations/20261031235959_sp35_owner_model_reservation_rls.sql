-- Sprint 3.5: the existing SECURITY INVOKER model reservation function
-- performs INSERT as SET LOCAL ROLE appf2_worker. The immutable journal has
-- a strict SELECT and UPDATE owner policy but was missing INSERT RLS.
-- Keep all RLS enabled, caller-local creator fencing, cost guards, and
-- the existing model-call trigger. No public/anon/authenticated grants.
CREATE POLICY appf2_agent_model_call_owner_reserve
 ON public.appf2_agent_model_call FOR INSERT TO appf2_worker
 WITH CHECK (
  owner_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid
  AND EXISTS(
   SELECT 1 FROM public.appf2_agent_job j
   WHERE j.job_id=appf2_agent_model_call.job_id
    AND j.owner_anonymous_id=appf2_agent_model_call.owner_anonymous_id
  )
 );
