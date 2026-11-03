-- Extend only the journal reservation allowlist to the already successful
-- tested gpt-4.1-mini; retain all original CAS, spend and no-retry guards.
DO $$
DECLARE existing_sql text; modified_sql text;
BEGIN
 SELECT pg_get_functiondef(
 'appf2_internal.reserve_agent_model_call(uuid,text,integer,text,text,text,integer)'::regprocedure)
 INTO existing_sql;
 IF position('IF p_model<>''gpt-6.1-sol'' OR' in existing_sql)=0
 THEN RAISE EXCEPTION 'SP35_MODEL_JOURNAL_UNEXPECTED_FUNCTION'; END IF;
 modified_sql=replace(existing_sql,
 'IF p_model<>''gpt-6.1-sol'' OR',
 'IF p_model NOT IN (''gpt-6.1-sol'',''gpt-4.1-mini'') OR');
 EXECUTE modified_sql;
END $$;
