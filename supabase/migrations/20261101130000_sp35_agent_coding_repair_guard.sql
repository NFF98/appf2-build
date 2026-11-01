-- Sprint 3.5 C4: align PostgreSQL trigger with already approved coding-agent FSM.
-- The original guard rejected CODING -> REPAIRING even though the TypeScript
-- checkpoint contract permits it; the creator-signed paid repair ended HTTP503.
-- Keep every existing identity, revision, terminal-state and spend guard.
CREATE OR REPLACE FUNCTION appf2_internal.agent_job_guard()
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
   (OLD.job_state='CODING' AND NEW.job_state IN ('CODING','BUILDING','REPAIRING','AWAITING_CONSENT','FAILED')) OR
   (OLD.job_state='BUILDING' AND NEW.job_state IN ('TESTING','REPAIRING','FAILED')) OR
   (OLD.job_state='TESTING' AND NEW.job_state IN ('READY','REPAIRING','FAILED')) OR
   (OLD.job_state='REPAIRING' AND NEW.job_state IN ('CODING','BUILDING','AWAITING_CONSENT','FAILED')) OR
   (OLD.job_state='AWAITING_CONSENT' AND NEW.job_state IN ('PLANNING','CODING','REPAIRING','FAILED'))
 ) THEN RAISE EXCEPTION 'APPF2_AGENT_ILLEGAL_STATE'; END IF;
 NEW.updated_at=now();
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION appf2_internal.agent_job_guard() FROM PUBLIC,anon,authenticated;
