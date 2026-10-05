import {
  EVIDENCE_SOURCE_OWNED_METRIC_KEYS,
  type EvidenceRetentionSourceClass,
  type EvidenceRetentionSourceRepository,
  type EvidenceRetentionWindow
} from "./evidence-retention-maintenance.js";
import type { PostgresExecutor } from "./postgres-evidence-repository.js";

// Every materialization below follows one rule: a new aggregate key counts every eligible source
// row; an existing key only adds source rows inside its own [materialized_through_received_at,
// cutoff) window, evaluated against the locked latest row, and never moves its watermark
// backwards, so reruns and overlapping triggers never double count.
const AGGREGATE_LOGICAL_KEY_CONFLICT = `
ON CONFLICT (
  bucket_date,
  metric_key,
  (COALESCE(function_id, '')),
  (COALESCE(event_type, '')),
  (COALESCE(collection_class, '')),
  policy_version
)`.trim();

const AGGREGATE_INSERT_COLUMNS = `
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
)`.trim();

const ADVANCE_WATERMARK = `
  materialized_through_received_at = EXCLUDED.materialized_through_received_at,
  updated_at = EXCLUDED.updated_at
WHERE aggregate.materialized_through_received_at < EXCLUDED.materialized_through_received_at`.trim();

// product_event → event_count + clock_invalid_rate, bucketed by F07 effective_event_at.
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
${AGGREGATE_INSERT_COLUMNS}
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
${AGGREGATE_LOGICAL_KEY_CONFLICT}
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
${ADVANCE_WATERMARK}
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

// evidence_intake_observation → event_batch_accept_rate + event_rejection_rate +
// duplicate_retry_rate + unknown_event_type_count, bucketed by source received_at UTC day.
// Operational quality dimensions are NULL in Phase 1.
export const POSTGRES_MATERIALIZE_INTAKE_OBSERVATION_AGGREGATES_SQL = `
WITH grouped AS (
  SELECT
    public.evidence_received_bucket_date(received_at) AS bucket_date,
    count(*) AS request_attempts,
    count(*) FILTER (WHERE batch_accepted) AS accepted_attempts,
    sum(event_received_count)::bigint AS event_received_count,
    sum(rejected_count)::bigint AS rejected_count,
    sum(duplicate_count)::bigint AS duplicate_count,
    sum(unknown_event_type_count)::bigint AS unknown_event_type_count
  FROM public.evidence_intake_observation
  WHERE received_at < $1::timestamptz
  GROUP BY 1
),
candidate AS (
  SELECT bucket_date, 'event_batch_accept_rate'::text AS metric_key,
    accepted_attempts AS numerator_count, request_attempts AS denominator_count
  FROM grouped
  UNION ALL
  SELECT bucket_date, 'event_rejection_rate'::text, rejected_count, event_received_count
  FROM grouped
  UNION ALL
  SELECT bucket_date, 'duplicate_retry_rate'::text, duplicate_count, event_received_count
  FROM grouped
  UNION ALL
  SELECT bucket_date, 'unknown_event_type_count'::text, unknown_event_type_count, NULL::bigint
  FROM grouped
)
${AGGREGATE_INSERT_COLUMNS}
SELECT
  bucket_date,
  metric_key,
  NULL,
  NULL,
  NULL,
  numerator_count,
  denominator_count,
  $2::text,
  $1::timestamptz,
  $3::timestamptz
FROM candidate
${AGGREGATE_LOGICAL_KEY_CONFLICT}
DO UPDATE SET
  (numerator_count, denominator_count) = (
    SELECT
      aggregate.numerator_count + CASE aggregate.metric_key
        WHEN 'event_batch_accept_rate' THEN count(*) FILTER (WHERE source.batch_accepted)
        WHEN 'event_rejection_rate' THEN COALESCE(sum(source.rejected_count), 0)::bigint
        WHEN 'duplicate_retry_rate' THEN COALESCE(sum(source.duplicate_count), 0)::bigint
        ELSE COALESCE(sum(source.unknown_event_type_count), 0)::bigint
      END,
      CASE aggregate.metric_key
        WHEN 'event_batch_accept_rate' THEN aggregate.denominator_count + count(*)
        WHEN 'unknown_event_type_count' THEN NULL::bigint
        ELSE aggregate.denominator_count + COALESCE(sum(source.event_received_count), 0)::bigint
      END
    FROM public.evidence_intake_observation AS source
    WHERE source.received_at >= aggregate.materialized_through_received_at
      AND source.received_at < EXCLUDED.materialized_through_received_at
      AND public.evidence_received_bucket_date(source.received_at) = aggregate.bucket_date
  ),
${ADVANCE_WATERMARK}
`.trim();

// evidence_client_quality_report → local_queue_drop_count + offline_expired_event_count, bucketed
// by first durable report received_at UTC day.
export const POSTGRES_MATERIALIZE_CLIENT_QUALITY_REPORT_AGGREGATES_SQL = `
WITH grouped AS (
  SELECT
    public.evidence_received_bucket_date(received_at) AS bucket_date,
    sum(local_queue_drop_count)::bigint AS local_queue_drop_count,
    sum(offline_expired_event_count)::bigint AS offline_expired_event_count
  FROM public.evidence_client_quality_report
  WHERE received_at < $1::timestamptz
  GROUP BY 1
),
candidate AS (
  SELECT bucket_date, 'local_queue_drop_count'::text AS metric_key,
    local_queue_drop_count AS numerator_count
  FROM grouped
  UNION ALL
  SELECT bucket_date, 'offline_expired_event_count'::text, offline_expired_event_count
  FROM grouped
)
${AGGREGATE_INSERT_COLUMNS}
SELECT
  bucket_date,
  metric_key,
  NULL,
  NULL,
  NULL,
  numerator_count,
  NULL,
  $2::text,
  $1::timestamptz,
  $3::timestamptz
FROM candidate
${AGGREGATE_LOGICAL_KEY_CONFLICT}
DO UPDATE SET
  numerator_count = aggregate.numerator_count + (
    SELECT COALESCE(sum(CASE aggregate.metric_key
      WHEN 'local_queue_drop_count' THEN source.local_queue_drop_count
      ELSE source.offline_expired_event_count
    END), 0)::bigint
    FROM public.evidence_client_quality_report AS source
    WHERE source.received_at >= aggregate.materialized_through_received_at
      AND source.received_at < EXCLUDED.materialized_through_received_at
      AND public.evidence_received_bucket_date(source.received_at) = aggregate.bucket_date
  ),
${ADVANCE_WATERMARK}
`.trim();

type QualitySourceTable = "evidence_intake_observation" | "evidence_client_quality_report";

// A quality source row is covered only by its own class's NULL-dimension aggregates at the row's
// received_at bucket; the required metric keys passed in $3 are exactly that class's owned keys.
const QUALITY_ROW_COVERED_BY_REQUIRED_METRIC = `
SELECT 1
FROM public.evidence_daily_aggregate AS aggregate
WHERE aggregate.bucket_date = public.evidence_received_bucket_date(source.received_at)
  AND aggregate.metric_key = required.metric_key
  AND aggregate.function_id IS NULL
  AND aggregate.event_type IS NULL
  AND aggregate.collection_class IS NULL
  AND aggregate.policy_version = $2::text
  AND aggregate.materialized_through_received_at >= $1::timestamptz
`.trim();

function qualityVerifySql(table: QualitySourceTable): string {
  return `
SELECT NOT EXISTS (
  SELECT 1
  FROM public.${table} AS source
  CROSS JOIN unnest($3::text[]) AS required(metric_key)
  WHERE source.received_at < $1::timestamptz
    AND NOT EXISTS (
      ${QUALITY_ROW_COVERED_BY_REQUIRED_METRIC}
    )
) AS covered
`.trim();
}

function qualityDeleteSql(table: QualitySourceTable): string {
  return `
WITH deleted AS (
  DELETE FROM public.${table} AS source
  WHERE source.received_at < $1::timestamptz
    AND NOT EXISTS (
      SELECT 1
      FROM unnest($3::text[]) AS required(metric_key)
      WHERE NOT EXISTS (
        ${QUALITY_ROW_COVERED_BY_REQUIRED_METRIC}
      )
    )
  RETURNING 1
)
SELECT count(*)::text AS deleted_count
FROM deleted
`.trim();
}

export const POSTGRES_VERIFY_INTAKE_OBSERVATION_WATERMARK_SQL = qualityVerifySql("evidence_intake_observation");
export const POSTGRES_DELETE_RETAINED_INTAKE_OBSERVATIONS_SQL = qualityDeleteSql("evidence_intake_observation");
export const POSTGRES_VERIFY_CLIENT_QUALITY_REPORT_WATERMARK_SQL = qualityVerifySql("evidence_client_quality_report");
export const POSTGRES_DELETE_RETAINED_CLIENT_QUALITY_REPORTS_SQL = qualityDeleteSql("evidence_client_quality_report");

export interface PostgresRetentionStatements {
  readonly materialize: string;
  readonly verify: string;
  readonly delete: string;
}

export const POSTGRES_EVIDENCE_RETENTION_STATEMENTS: Readonly<
  Record<EvidenceRetentionSourceClass, PostgresRetentionStatements>
> = Object.freeze({
  product_event: {
    materialize: POSTGRES_MATERIALIZE_EVIDENCE_AGGREGATES_SQL,
    verify: POSTGRES_VERIFY_EVIDENCE_AGGREGATE_WATERMARK_SQL,
    delete: POSTGRES_DELETE_RETAINED_RAW_EVIDENCE_SQL
  },
  evidence_intake_observation: {
    materialize: POSTGRES_MATERIALIZE_INTAKE_OBSERVATION_AGGREGATES_SQL,
    verify: POSTGRES_VERIFY_INTAKE_OBSERVATION_WATERMARK_SQL,
    delete: POSTGRES_DELETE_RETAINED_INTAKE_OBSERVATIONS_SQL
  },
  evidence_client_quality_report: {
    materialize: POSTGRES_MATERIALIZE_CLIENT_QUALITY_REPORT_AGGREGATES_SQL,
    verify: POSTGRES_VERIFY_CLIENT_QUALITY_REPORT_WATERMARK_SQL,
    delete: POSTGRES_DELETE_RETAINED_CLIENT_QUALITY_REPORTS_SQL
  }
});

interface CoveredRow {
  readonly covered: unknown;
}

interface DeletedCountRow {
  readonly deleted_count: unknown;
}

function nonNegativeCount(value: unknown): number {
  const count = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    throw new Error("PostgreSQL evidence source deletion returned an invalid count");
  }
  return count;
}

export class PostgresEvidenceRetentionSource implements EvidenceRetentionSourceRepository {
  private readonly statements: PostgresRetentionStatements;

  public constructor(
    private readonly executor: PostgresExecutor,
    public readonly sourceClass: EvidenceRetentionSourceClass
  ) {
    this.statements = POSTGRES_EVIDENCE_RETENTION_STATEMENTS[sourceClass];
  }

  public async materializeEligibleAggregates(window: EvidenceRetentionWindow): Promise<void> {
    await this.executor.query(this.statements.materialize, [
      window.cutoffReceivedAt,
      window.policyVersion,
      window.maintenanceNow
    ]);
  }

  public async verifyAggregateWatermark(window: EvidenceRetentionWindow): Promise<boolean> {
    const result = await this.executor.query<CoveredRow>(this.statements.verify, this.coverageParameters(window));
    return result.rows[0]?.covered === true;
  }

  public async deleteEligibleSourceRows(window: EvidenceRetentionWindow): Promise<number> {
    const result = await this.executor.query<DeletedCountRow>(this.statements.delete, this.coverageParameters(window));
    return nonNegativeCount(result.rows[0]?.deleted_count);
  }

  private coverageParameters(window: EvidenceRetentionWindow): readonly unknown[] {
    return [window.cutoffReceivedAt, window.policyVersion, [...EVIDENCE_SOURCE_OWNED_METRIC_KEYS[this.sourceClass]]];
  }
}

export function createPostgresEvidenceRetentionSources(
  executor: PostgresExecutor
): readonly EvidenceRetentionSourceRepository[] {
  return Object.freeze([
    new PostgresEvidenceRetentionSource(executor, "product_event"),
    new PostgresEvidenceRetentionSource(executor, "evidence_intake_observation"),
    new PostgresEvidenceRetentionSource(executor, "evidence_client_quality_report")
  ]);
}
