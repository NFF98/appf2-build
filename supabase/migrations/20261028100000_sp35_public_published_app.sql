-- APPf2 Sprint 3.5: F05 explicit publisher / recipient. No public hash reads.
-- Only verified original-holder share:create grants may reach the INSERT route.
CREATE TABLE public.appf2_published_app (
  share_id uuid PRIMARY KEY,
  source_intent_id uuid NOT NULL REFERENCES public.intent_record(intent_id),
  creator_anonymous_id uuid NOT NULL,
  blueprint_hash text NOT NULL REFERENCES public.blueprint_content(content_hash),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','REVOKED','EXPIRED')),
  listed boolean NOT NULL DEFAULT true,
  idempotency_key text NOT NULL CHECK(char_length(idempotency_key) BETWEEN 8 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  UNIQUE (source_intent_id,idempotency_key),
  CHECK (blueprint_hash ~ '^sha256:[a-f0-9]{64}$')
);
CREATE INDEX appf2_published_app_gallery_idx ON public.appf2_published_app(created_at DESC)
  WHERE status='ACTIVE' AND listed;
ALTER TABLE public.appf2_published_app ENABLE ROW LEVEL SECURITY;
-- Supabase anon/authenticated may not talk to this table through PostgREST.
REVOKE ALL ON public.appf2_published_app FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.appf2_published_app TO appf2_worker;
-- Public references are intentional only for entries the creator explicitly made ACTIVE.
CREATE POLICY appf2_published_active_read ON public.appf2_published_app
  FOR SELECT TO appf2_worker
  USING (status='ACTIVE' AND (expires_at IS NULL OR expires_at>now()));
CREATE POLICY appf2_published_verified_owner_insert ON public.appf2_published_app
  FOR INSERT TO appf2_worker
  WITH CHECK (
    status='ACTIVE' AND listed=true AND expires_at IS NULL AND
    source_intent_id = nullif(current_setting('app.intent_id',true),'')::uuid AND
    creator_anonymous_id = nullif(current_setting('app.anonymous_id',true),'')::uuid
  );

-- Dedicated non-API schema: no generic PUBLIC grants, privilege owner intentionally
-- bypasses content RLS solely after independently checking the exact ACTIVE share.
CREATE SCHEMA IF NOT EXISTS appf2_internal;
REVOKE ALL ON SCHEMA appf2_internal FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA appf2_internal TO appf2_worker;
CREATE FUNCTION appf2_internal.share_content(p_share_id uuid,p_hash text)
RETURNS TABLE (
  content_hash text, canonical_blueprint jsonb, schema_version text,
  registry_version text, trust_status text, admitted_registry_digest text
)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
STABLE
AS $$
  SELECT b.content_hash,b.canonical_blueprint,b.schema_version,b.registry_version,
         b.trust_status,v.report->>'registry_digest'
  FROM public.appf2_published_app s
  JOIN public.blueprint_content b ON b.content_hash=s.blueprint_hash
  JOIN public.validation_run v ON v.validation_run_id=b.admitted_by_validation_run_id
  WHERE s.share_id=p_share_id AND s.blueprint_hash=p_hash
    AND s.status='ACTIVE' AND (s.expires_at IS NULL OR s.expires_at>now())
    AND b.trust_status IN ('VALIDATED','REVOKED','INCOMPATIBLE')
    AND v.status='PASSED' AND v.blueprint_hash=b.content_hash
    AND v.schema_version=b.schema_version AND v.registry_version=b.registry_version
    AND jsonb_typeof(v.report->'registry_digest')='string'
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION appf2_internal.share_content(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION appf2_internal.share_content(uuid,text) TO appf2_worker;
