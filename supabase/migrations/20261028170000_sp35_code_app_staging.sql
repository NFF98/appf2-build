-- Sprint 3.5 staged, bounded Code Builder; NOT general production R2 / F02v2.
CREATE TABLE public.appf2_code_app (
  share_id uuid PRIMARY KEY,
  creator_anonymous_id uuid NOT NULL,
  creator_key_thumbprint text NOT NULL CHECK(char_length(creator_key_thumbprint)=43),
  idempotency_key text NOT NULL CHECK(char_length(idempotency_key) BETWEEN 8 AND 128),
  title text NOT NULL DEFAULT '新 App' CHECK(char_length(title) BETWEEN 1 AND 120),
  prompt text NOT NULL CHECK(char_length(prompt) BETWEEN 5 AND 800),
  blueprint_hash text,
  artifact jsonb,
  status text NOT NULL DEFAULT 'BUILDING' CHECK(status IN ('BUILDING','ACTIVE','FAILED')),
  public_opt_in boolean NOT NULL CHECK(public_opt_in=true),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appf2_code_unique_owner_key UNIQUE (creator_key_thumbprint,idempotency_key),
  CHECK ((status='ACTIVE') = (artifact IS NOT NULL AND blueprint_hash IS NOT NULL)),
  CHECK (blueprint_hash IS NULL OR blueprint_hash ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (artifact IS NULL OR octet_length(artifact::text) <= 130000)
);
CREATE INDEX appf2_code_app_active_idx ON public.appf2_code_app (created_at DESC) WHERE status='ACTIVE';
ALTER TABLE public.appf2_code_app ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.appf2_code_app FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.appf2_code_app TO appf2_worker;
CREATE POLICY appf2_code_read ON public.appf2_code_app FOR SELECT TO appf2_worker
  USING(status='ACTIVE' OR creator_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid);
CREATE POLICY appf2_code_insert ON public.appf2_code_app FOR INSERT TO appf2_worker
  WITH CHECK(creator_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid
    AND status='BUILDING' AND artifact IS NULL AND blueprint_hash IS NULL AND public_opt_in=true);
CREATE POLICY appf2_code_finish ON public.appf2_code_app FOR UPDATE TO appf2_worker
  USING(status='BUILDING' AND creator_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid)
  WITH CHECK(creator_anonymous_id=nullif(current_setting('app.anonymous_id',true),'')::uuid
    AND status IN ('ACTIVE','FAILED'));
-- Fail closed on unsafe direct changes: only BUILDING -> ACTIVE/FAILED.
CREATE FUNCTION appf2_internal.code_app_immutable_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF OLD.status<>'BUILDING'
    OR NEW.share_id<>OLD.share_id OR NEW.creator_anonymous_id<>OLD.creator_anonymous_id
    OR NEW.creator_key_thumbprint<>OLD.creator_key_thumbprint
    OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.prompt<>OLD.prompt
    OR NEW.public_opt_in<>OLD.public_opt_in
 THEN RAISE EXCEPTION 'APPF2_CODE_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION appf2_internal.code_app_immutable_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER appf2_code_guard BEFORE UPDATE ON public.appf2_code_app
FOR EACH ROW EXECUTE FUNCTION appf2_internal.code_app_immutable_guard();
CREATE TABLE public.appf2_code_daily_budget(
  utc_day date NOT NULL, network_digest text NOT NULL,
  used integer NOT NULL DEFAULT 1 CHECK(used BETWEEN 1 AND 2),
  PRIMARY KEY(utc_day,network_digest)
);
ALTER TABLE public.appf2_code_daily_budget ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.appf2_code_daily_budget FROM PUBLIC,anon,authenticated,appf2_worker;
-- Worker may only consume a bounded slot; cannot list user network pseudonyms.
CREATE FUNCTION appf2_internal.consume_code_daily_budget(p_network_digest text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE slot integer;
BEGIN
 IF char_length(p_network_digest)<>64 OR p_network_digest !~ '^[a-f0-9]{64}$'
   THEN RETURN false; END IF;
 INSERT INTO public.appf2_code_daily_budget(utc_day,network_digest,used)
 VALUES ((now() AT TIME ZONE 'UTC')::date,p_network_digest,1)
 ON CONFLICT(utc_day,network_digest) DO UPDATE
   SET used=public.appf2_code_daily_budget.used+1
 WHERE public.appf2_code_daily_budget.used<2
 RETURNING used INTO slot;
 RETURN slot IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION appf2_internal.consume_code_daily_budget(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION appf2_internal.consume_code_daily_budget(text) TO appf2_worker;
