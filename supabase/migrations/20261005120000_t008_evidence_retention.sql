-- F07-RQ-008 / BF-011: clock_invalid when occurred_at is strictly later than received_at + 10 minutes.
CREATE FUNCTION public.evidence_clock_invalid(occurred_at timestamptz, received_at timestamptz)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT occurred_at - received_at > INTERVAL '10 minutes'
$$;

-- DATA-MODEL §6.11: UTC day bucket of effective_event_at (received_at when clock_invalid, else occurred_at).
CREATE FUNCTION public.evidence_bucket_date(occurred_at timestamptz, received_at timestamptz)
RETURNS date
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT (
    CASE
      WHEN occurred_at - received_at > INTERVAL '10 minutes' THEN received_at
      ELSE occurred_at
    END AT TIME ZONE 'UTC'
  )::date
$$;

CREATE TABLE public.evidence_daily_aggregate (
  aggregate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_date date NOT NULL,
  metric_key text NOT NULL
    CHECK (metric_key IN (
      'event_count',
      'event_batch_accept_rate',
      'event_rejection_rate',
      'duplicate_retry_rate',
      'local_queue_drop_count',
      'offline_expired_event_count',
      'unknown_event_type_count',
      'clock_invalid_rate'
    )),
  function_id text NULL
    CHECK (function_id IS NULL OR function_id ~ '^F[0-9]{2}$'),
  event_type text NULL
    CHECK (event_type IS NULL OR event_type ~ '^F[0-9]{2}-EVT-[0-9]{3}$'),
  collection_class text NULL
    CHECK (
      collection_class IS NULL
      OR collection_class IN ('CORE_OUTCOME', 'RELIABILITY', 'PRODUCT_SAMPLE', 'DEBUG_ONLY')
    ),
  numerator_count bigint NOT NULL
    CHECK (numerator_count >= 0),
  denominator_count bigint NULL
    CHECK (denominator_count IS NULL OR denominator_count >= 0),
  policy_version text NOT NULL
    CHECK (policy_version <> ''),
  materialized_through_received_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    function_id IS NULL
    OR event_type IS NULL
    OR event_type LIKE function_id || '-EVT-%'
  )
);

-- DATA-MODEL §6.11 rule 5: logical unique key with DB-level deterministic NULL normalization.
-- '' never collides with a stored dimension value because every dimension CHECK rejects ''.
CREATE UNIQUE INDEX evidence_daily_aggregate_logical_key_idx
  ON public.evidence_daily_aggregate (
    bucket_date,
    metric_key,
    (COALESCE(function_id, '')),
    (COALESCE(event_type, '')),
    (COALESCE(collection_class, '')),
    policy_version
  );

CREATE INDEX evidence_daily_aggregate_bucket_metric_idx
  ON public.evidence_daily_aggregate (bucket_date, metric_key);
CREATE INDEX evidence_daily_aggregate_function_bucket_idx
  ON public.evidence_daily_aggregate (function_id, bucket_date);
CREATE INDEX evidence_daily_aggregate_type_bucket_idx
  ON public.evidence_daily_aggregate (event_type, bucket_date);

-- EvidenceRetentionMaintenance access paths: the daily received_at cutoff scan, and the
-- per-aggregate-key received_at watermark window.
CREATE INDEX product_event_received_idx
  ON public.product_event (received_at);
CREATE INDEX product_event_type_received_idx
  ON public.product_event (event_type, received_at);

ALTER TABLE public.evidence_daily_aggregate ENABLE ROW LEVEL SECURITY;
