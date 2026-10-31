-- Sprint 3.5 GPT-6 long reasoning recovery, STAGING migration.
-- Save ONLY a provider response id bound to the exact pre-journaled Job+phase.
-- The id allows GET recovery of one background Responses call, never a second
-- billable POST. No source, prompt, credential or model output is stored here.
CREATE TABLE public.appf2_agent_model_background_ref (
 job_id uuid NOT NULL,
 owner_anonymous_id uuid NOT NULL,
 call_key text NOT NULL,
 response_id text NOT NULL CHECK(response_id ~ '^resp_[A-Za-z0-9_-]{6,160}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(job_id,call_key),
 FOREIGN KEY(job_id,owner_anonymous_id)
  REFERENCES public.appf2_agent_job(job_id,owner_anonymous_id)
  ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY(job_id,call_key)
  REFERENCES public.appf2_agent_model_call(job_id,call_key)
  ON UPDATE RESTRICT ON DELETE RESTRICT
);
ALTER TABLE public.appf2_agent_model_background_ref ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.appf2_agent_model_background_ref FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.appf2_agent_model_background_ref TO appf2_worker;
CREATE POLICY appf2_agent_model_background_ref_read
 ON public.appf2_agent_model_background_ref FOR SELECT TO appf2_worker
 USING(owner_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid);
CREATE POLICY appf2_agent_model_background_ref_insert
 ON public.appf2_agent_model_background_ref FOR INSERT TO appf2_worker
 WITH CHECK(
  owner_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid
  AND EXISTS(
   SELECT 1 FROM public.appf2_agent_model_call c
   WHERE c.job_id=appf2_agent_model_background_ref.job_id
    AND c.owner_anonymous_id=appf2_agent_model_background_ref.owner_anonymous_id
    AND c.call_key=appf2_agent_model_background_ref.call_key
    AND c.status='IN_FLIGHT'
  )
 );
