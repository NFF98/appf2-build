-- One immutable original acceptance plan BEFORE the first AI coding turn.
-- Never trust a plan supplied after generated source exists.
CREATE TABLE public.appf2_agent_qa_plan(
 job_id uuid PRIMARY KEY,
 owner_anonymous_id uuid NOT NULL,
 original_prompt_hash text NOT NULL
  CHECK(original_prompt_hash ~ '^sha256:[a-f0-9]{64}$'),
 original_plan jsonb NOT NULL CHECK(jsonb_typeof(original_plan)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(job_id,owner_anonymous_id)
  REFERENCES public.appf2_agent_job(job_id,owner_anonymous_id)
  ON UPDATE RESTRICT ON DELETE RESTRICT,
 CHECK(octet_length(original_plan::text)<=24000)
);
ALTER TABLE public.appf2_agent_qa_plan ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.appf2_agent_qa_plan FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.appf2_agent_qa_plan TO appf2_worker;
CREATE POLICY appf2_agent_qa_plan_select ON public.appf2_agent_qa_plan
 FOR SELECT TO appf2_worker
 USING(owner_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid);
CREATE POLICY appf2_agent_qa_plan_insert ON public.appf2_agent_qa_plan
 FOR INSERT TO appf2_worker
 WITH CHECK(owner_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid);
