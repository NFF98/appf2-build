import {
  EVIDENCE_RAW_DERIVED_METRIC_KEYS,
  type EvidenceRetentionRepository,
  type EvidenceRetentionWindow
} from "./evidence-retention-maintenance.js";
import type { PostgresExecutor } from "./postgres-evidence-repository.js";

// New aggregate keys count every eligible raw row. An existing key only adds raw rows inside its
// own [materialized_through_received_at, cutoff) window, evaluated against the locked latest row,
// and never moves its watermark backwards, so reruns and overlapping triggers never double count.
export const POSTGRES_MATERIALIZE_EVIDENCE_AGGREGATES_SQL = `
WITH eligible AS (
  SELECT
    public.evidence_bucket_date(occurred_at, received_at) AS bucket_date,
    function_id,
    event_type,
    public.evidence_clock_invalid(occurred_at, received_at) AS clock_invalid
  FROM public.product_event
  WHERE received_at < $1::timestamptz
),
grouped AS (
  SELECT
    bucket_date,
    function_id,
    event_type,
    count(*) AS event_count,
    count(*) FILTER (WHERE clock_invalid) AS clock_invalid_count
  FROM eligible
  GROUP BY bucket_date, function_id, event_type
),
candidate AS (
  SELECT bucket_date, 'event_count'::text AS metric_key, function_id, event_type,
    event_count AS numerator_count, NULL::bigint AS denominator_count
  FROM grouped
  UNION ALL
  SELECT bucket_date, 'clock_invalid_rate'::text, function_id, event_type,
    clock_invalid_count, event_count
  FROM grouped
)
INSERT INTO public.evidence_daily_aggregate AS aggregate (
  bucket_date,
  metric_key,
  function_id,
  event_type,
  collection_class,
  numerator_count,
  denominator_count,
  policy_version,
  materialized_through_received_at,
  updated_at
)
SELECT
  bucket_date,
  metric_key,
  function_id,
  event_type,
  NULL,
  numerator_count,
  denominator_count,
  $2::text,
  $1::timestamptz,
  $3::timestamptz
FROM candidate
ON CONFLICT (
  bucket_date,
  metric_key,
  (COALESCE(function_id, '')),
  (COALESCE(event_type, '')),
  (COALESCE(collection_class, '')),
  policy_version
)
DO UPDATE SET
  (numerator_count, denominator_count) = (
    SELECT
      aggregate.numerator_count + CASE aggregate.metric_key
        WHEN 'clock_invalid_rate'
          THEN count(*) FILTER (WHERE public.evidence_clock_invalid(raw.occurred_at, raw.received_at))
        ELSE count(*)
      END,
      aggregate.denominator_count + count(*)
    FROM public.product_event AS raw
    WHERE raw.received_at >= aggregate.materialized_through_received_at
      AND raw.received_at < EXCLUDED.materialized_through_received_at
      AND raw.function_id = aggregate.function_id
      AND raw.event_type = aggregate.event_type
      AND public.evidence_bucket_date(raw.occurred_at, raw.received_at) = aggregate.bucket_date
  ),
  materialized_through_received_at = EXCLUDED.materialized_through_received_at,
  updated_at = EXCLUDED.updated_at
WHERE aggregate.materialized_through_received_at < EXCLUDED.materialized_through_received_at
`.trim();

const RAW_ROW_COVERED_BY_REQUIRED_METRIC = `
SELECT 1
FROM public.evidence_daily_aggregate AS aggregate
WHERE aggregate.bucket_date = public.evidence_bucket_date(raw.occurred_at, raw.received_at)
  AND aggregate.metric_key = required.metric_key
  AND aggregate.function_id = raw.function_id
  AND aggregate.event_type = raw.event_type
  AND aggregate.collection_class IS NULL
  AND aggregate.policy_version = $2::text
  AND aggregate.materialized_through_received_at >= $1::timestamptz
`.trim();

export const POSTGRES_VERIFY_EVIDENCE_AGGREGATE_WATERMARK_SQL = `
SELECT NOT EXISTS (
  SELECT 1
  FROM public.product_event AS raw
  CROSS JOIN unnest($3::text[]) AS required(metric_key)
  WHERE raw.received_at < $1::timestamptz
    AND NOT EXISTS (
      ${RAW_ROW_COVERED_BY_REQUIRED_METRIC}
    )
) AS covered
`.trim();

export const POSTGRES_DELETE_RETAINED_RAW_EVIDENCE_SQL = `
WITH deleted AS (
  DELETE FROM public.product_event AS raw
  WHERE raw.received_at < $1::timestamptz
    AND NOT EXISTS (
      SELECT 1
      FROM unnest($3::text[]) AS required(metric_key)
      WHERE NOT EXISTS (
        ${RAW_ROW_COVERED_BY_REQUIRED_METRIC}
      )
    )
  RETURNING 1
)
SELECT count(*)::text AS deleted_count
FROM deleted
`.trim();

interface CoveredRow {
  readonly covered: unknown;
}

interface DeletedCountRow {
  readonly deleted_count: unknown;
}

function coverageParameters(window: EvidenceRetentionWindow): readonly unknown[] {
  return [window.cutoffReceivedAt, window.policyVersion, [...EVIDENCE_RAW_DERIVED_METRIC_KEYS]];
}

function nonNegativeCount(value: unknown): number {
  const count = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    throw new Error("PostgreSQL raw evidence deletion returned an invalid count");
  }
  return count;
}

export class PostgresEvidenceRetentionRepository implements EvidenceRetentionRepository {
  public constructor(private readonly executor: PostgresExecutor) {}

  public async materializeEligibleAggregates(window: EvidenceRetentionWindow): Promise<void> {
    await this.executor.query(POSTGRES_MATERIALIZE_EVIDENCE_AGGREGATES_SQL, [
      window.cutoffReceivedAt,
      window.policyVersion,
      window.maintenanceNow
    ]);
  }

  public async verifyAggregateWatermark(window: EvidenceRetentionWindow): Promise<boolean> {
    const result = await this.executor.query<CoveredRow>(
      POSTGRES_VERIFY_EVIDENCE_AGGREGATE_WATERMARK_SQL,
      coverageParameters(window)
    );
    return result.rows[0]?.covered === true;
  }

  public async deleteEligibleRawEvents(window: EvidenceRetentionWindow): Promise<number> {
    const result = await this.executor.query<DeletedCountRow>(
      POSTGRES_DELETE_RETAINED_RAW_EVIDENCE_SQL,
      coverageParameters(window)
    );
    return nonNegativeCount(result.rows[0]?.deleted_count);
  }
}
