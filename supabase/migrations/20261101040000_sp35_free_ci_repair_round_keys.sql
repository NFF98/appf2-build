-- C4/C5: allow at most three separately owner-consented GPT-6 repair phases.
-- Preserve QA/CODE v1 and immutable runner request + OIDC RLS guards.
-- This is NOT a new model call, deployment or permission escalation.
ALTER TABLE public.appf2_agent_model_runner_request
 DROP CONSTRAINT appf2_agent_model_runner_request_call_key_check;
ALTER TABLE public.appf2_agent_model_runner_request
 ADD CONSTRAINT appf2_agent_model_runner_request_call_key_check
 CHECK (call_key ~ '^sp35_free_ai_(qa_v1|code_v1|repair_v[123])$');
