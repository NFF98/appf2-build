-- Staging-only first-party operator action: human/product-owner requested
-- reuse of this product's own E2E-generated LifePilot and moving-house Apps.
-- NOT a migration. NOT an anonymous-client, hash-only or original-holder share route.
-- Do not run against production. No AI or Blueprint generation is involved.
-- Exact immutable hash + F02 PASSED lineage + original CI-owned Intent required.
WITH allowlist (hash,intent,anon,title,key,from_utc,to_utc) AS (
  VALUES
  (
    'sha256:45d53fe47ecb52a6864b86bf0bef979e312fc67733ae0a9e20207cc6d505d8f3'::text,
    '1b9d401d-0b74-474d-b3c2-0cb807b7e80c'::uuid,
    '5349c88c-0aa5-4338-815f-4b169d34ccd6'::uuid,
    'LifePilot — 五功能生活管家'::text,
    'sp35-first-party-ci-lifepilot-40603935791'::text,
    '2026-10-27 23:43:00+00'::timestamptz,
    '2026-10-27 23:46:00+00'::timestamptz
  ),
  (
    'sha256:ad73e31a5fc79f9b8ef5ac6ce029ed582d712bb91a9e02c671550dcf5f07a0cc'::text,
    '97b870f1-2ff1-4be7-aa33-0dd0bad138ab'::uuid,
    'f68e521c-c6e2-4ab8-85e5-08622693525e'::uuid,
    '搬家管理 — 任務、採購與預算'::text,
    'sp35-first-party-ci-moving-40594073419'::text,
    '2026-10-27 22:21:00+00'::timestamptz,
    '2026-10-27 22:25:00+00'::timestamptz
  )
), verified AS (
 SELECT a.*,b.content_hash
 FROM allowlist a
 JOIN public.intent_record i ON i.intent_id=a.intent AND i.anonymous_id=a.anon
 JOIN public.compiler_run c ON c.intent_id=i.intent_id
   AND c.finished_at BETWEEN a.from_utc AND a.to_utc
 JOIN public.validation_run v ON v.compiler_run_id=c.compiler_run_id
   AND v.status='PASSED' AND v.blueprint_hash=a.hash
   AND jsonb_typeof(v.report->'registry_digest')='string'
 JOIN public.blueprint_content b ON b.content_hash=a.hash
   AND b.admitted_by_validation_run_id=v.validation_run_id
   AND b.trust_status='VALIDATED'
 WHERE NOT (
  b.canonical_blueprint::text ~*
  '(api.?key|password|secret|bearer |token|email|電話|手機|住址|地址|street address|[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,})'
 )
), created AS (
 INSERT INTO public.appf2_published_app
  (share_id,source_intent_id,creator_anonymous_id,blueprint_hash,title,idempotency_key,status,listed)
 SELECT gen_random_uuid(),intent,anon,content_hash,title,key,'ACTIVE',true
 FROM verified
 WHERE NOT EXISTS (
  SELECT 1 FROM public.appf2_published_app s
  WHERE s.source_intent_id=verified.intent AND s.blueprint_hash=verified.hash
    AND s.status='ACTIVE' AND s.listed=true
 )
 ON CONFLICT(source_intent_id,idempotency_key) DO NOTHING
 RETURNING share_id::text AS share_id,title,blueprint_hash
)
SELECT share_id,title,blueprint_hash FROM created
UNION ALL
SELECT share_id::text,title,blueprint_hash
FROM public.appf2_published_app
WHERE idempotency_key IN
 ('sp35-first-party-ci-lifepilot-40603935791','sp35-first-party-ci-moving-40594073419')
ORDER BY title;
