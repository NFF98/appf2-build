-- F07 §42: operational quality metrics bucket by the canonical source's first durable received_at UTC day.
CREATE FUNCTION public.evidence_received_bucket_date(received_at timestamptz)
RETURNS date
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT (received_at AT TIME ZONE 'UTC')::date
$$;

-- DATA-MODEL §6.11A: one bounded, non-identifying row per /api/v1/events/batch request attempt.
-- No batch_id, event/user/session/intent/share/trace identity, properties or raw request body.
CREATE TABLE public.evidence_intake_observation (
  observation_id uuid PRIMARY KEY,
  received_at timestamptz NOT NULL,
  batch_accepted boolean NOT NULL,
  event_received_count bigint NOT NULL
    CHECK (event_received_count >= 0),
  accepted_count bigint NOT NULL
    CHECK (accepted_count >= 0),
  duplicate_count bigint NOT NULL
    CHECK (duplicate_count >= 0),
  rejected_count bigint NOT NULL
    CHECK (rejected_count >= 0),
  unknown_event_type_count bigint NOT NULL
    CHECK (unknown_event_type_count >= 0),
  route_rejection_code text NULL
    CHECK (
      route_rejection_code IS NULL
      OR route_rejection_code IN ('API-REQUEST-TOO-LARGE', 'F07-ERR-003', 'F07-ERR-007')
    ),
  CHECK (event_received_count = accepted_count + duplicate_count + rejected_count),
  CHECK (unknown_event_type_count <= rejected_count),
  CHECK (
    route_rejection_code IS NULL
    OR (NOT batch_accepted AND event_received_count = 0)
  )
);

-- DATA-MODEL §6.11B: bounded browser queue-quality delta; report_id is retry idempotency identity only.
CREATE TABLE public.evidence_client_quality_report (
  report_id uuid PRIMARY KEY,
  received_at timestamptz NOT NULL,
  local_queue_drop_count bigint NOT NULL
    CHECK (local_queue_drop_count BETWEEN 0 AND 9007199254740991),
  offline_expired_event_count bigint NOT NULL
    CHECK (offline_expired_event_count BETWEEN 0 AND 9007199254740991),
  CHECK (local_queue_drop_count > 0 OR offline_expired_event_count > 0)
);

-- EvidenceRetentionMaintenance access paths: the daily received_at cutoff scan per source class.
CREATE INDEX evidence_intake_observation_received_idx
  ON public.evidence_intake_observation (received_at);
CREATE INDEX evidence_client_quality_report_received_idx
  ON public.evidence_client_quality_report (received_at);

ALTER TABLE public.evidence_intake_observation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_client_quality_report ENABLE ROW LEVEL SECURITY;
