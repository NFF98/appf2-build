import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import {
  EVIDENCE_AGGREGATE_METRIC_KEYS,
  EVIDENCE_RAW_DERIVED_METRIC_KEYS,
  EVIDENCE_RETENTION_SOURCE_CLASSES,
  EVIDENCE_SOURCE_OWNED_METRIC_KEYS,
  rawRetentionCutoff
} from "../../src/platform/evidence/evidence-retention-maintenance.js";
import {
  POSTGRES_INSERT_CLIENT_QUALITY_REPORT_SQL,
  POSTGRES_INSERT_INTAKE_OBSERVATION_SQL
} from "../../src/platform/evidence/postgres-evidence-quality-repository.js";
import type {
  PostgresExecutor,
  PostgresQueryResult
} from "../../src/platform/evidence/postgres-evidence-repository.js";
import {
  createPostgresEvidenceRetentionSources,
  POSTGRES_DELETE_RETAINED_CLIENT_QUALITY_REPORTS_SQL,
  POSTGRES_DELETE_RETAINED_INTAKE_OBSERVATIONS_SQL,
  POSTGRES_DELETE_RETAINED_RAW_EVIDENCE_SQL,
  POSTGRES_EVIDENCE_RETENTION_STATEMENTS,
  POSTGRES_MATERIALIZE_CLIENT_QUALITY_REPORT_AGGREGATES_SQL,
  POSTGRES_MATERIALIZE_EVIDENCE_AGGREGATES_SQL,
  POSTGRES_MATERIALIZE_INTAKE_OBSERVATION_AGGREGATES_SQL,
  POSTGRES_VERIFY_CLIENT_QUALITY_REPORT_WATERMARK_SQL,
  POSTGRES_VERIFY_EVIDENCE_AGGREGATE_WATERMARK_SQL,
  POSTGRES_VERIFY_INTAKE_OBSERVATION_WATERMARK_SQL,
  PostgresEvidenceRetentionSource
} from "../../src/platform/evidence/postgres-evidence-retention-repository.js";

const MIGRATION_SQL = readFileSync(
  new URL("../../supabase/migrations/20261005120000_t008_evidence_retention.sql", import.meta.url),
  "utf8"
);
const QUALITY_MIGRATION_SQL = readFileSync(
  new URL("../../supabase/migrations/20261005130000_t008_evidence_quality_sources.sql", import.meta.url),
  "utf8"
);

const QUALITY_MATERIALIZE_SQL = [
  POSTGRES_MATERIALIZE_INTAKE_OBSERVATION_AGGREGATES_SQL,
  POSTGRES_MATERIALIZE_CLIENT_QUALITY_REPORT_AGGREGATES_SQL
];
const QUALITY_COVERAGE_SQL = [
  POSTGRES_VERIFY_INTAKE_OBSERVATION_WATERMARK_SQL,
  POSTGRES_DELETE_RETAINED_INTAKE_OBSERVATIONS_SQL,
  POSTGRES_VERIFY_CLIENT_QUALITY_REPORT_WATERMARK_SQL,
  POSTGRES_DELETE_RETAINED_CLIENT_QUALITY_REPORTS_SQL
];

function normalized(sql: string): string {
  return sql.replaceAll(/\s+/g, " ");
}

class RecordingExecutor implements PostgresExecutor {
  public readonly calls: { statement: string; parameters: readonly unknown[] }[] = [];

  public constructor(private readonly rows: readonly unknown[]) {}

  public async query<Row>(statement: string, parameters: readonly unknown[]): Promise<PostgresQueryResult<Row>> {
    this.calls.push({ statement, parameters });
    return { rows: this.rows as Row[] };
  }
}

const WINDOW = {
  cutoffReceivedAt: "2026-01-01T00:00:00.000Z",
  maintenanceNow: "2026-04-01T00:00:00.000Z",
  policyVersion: "1.0.0"
};

describe("F07 evidence retention SQL contract", () => {
  test("the raw retention cutoff is exactly 90 UTC days before maintenance_now", () => {
    expect(rawRetentionCutoff(new Date("2026-04-01T00:00:00.000Z")).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  test("raw eligibility and deletion use only first durable received_at, never occurred_at", () => {
    for (const sql of [
      POSTGRES_MATERIALIZE_EVIDENCE_AGGREGATES_SQL,
      POSTGRES_VERIFY_EVIDENCE_AGGREGATE_WATERMARK_SQL,
      POSTGRES_DELETE_RETAINED_RAW_EVIDENCE_SQL,
      ...QUALITY_MATERIALIZE_SQL,
      ...QUALITY_COVERAGE_SQL
    ]) {
      expect(normalized(sql)).toMatch(/received_at < \$1::timestamptz/);
      expect(sql).not.toMatch(/occurred_at\s*<\s*\$1/);
    }
  });

  test("materialization never re-adds rows below an existing aggregate watermark", () => {
    for (const [sql, alias] of [
      [POSTGRES_MATERIALIZE_EVIDENCE_AGGREGATES_SQL, "raw"],
      [POSTGRES_MATERIALIZE_INTAKE_OBSERVATION_AGGREGATES_SQL, "source"],
      [POSTGRES_MATERIALIZE_CLIENT_QUALITY_REPORT_AGGREGATES_SQL, "source"]
    ] as const) {
      const text = normalized(sql);
      expect(text).toContain(`${alias}.received_at >= aggregate.materialized_through_received_at`);
      expect(text).toContain(`${alias}.received_at < EXCLUDED.materialized_through_received_at`);
      expect(text).toContain(
        "WHERE aggregate.materialized_through_received_at < EXCLUDED.materialized_through_received_at"
      );
      expect(text).toContain(
        "ON CONFLICT ( bucket_date, metric_key, (COALESCE(function_id, '')), (COALESCE(event_type, '')), (COALESCE(collection_class, '')), policy_version )"
      );
    }
  });

  test("the migration is expand-only and pins the F07 aggregate allowlist and canonical aggregate time", () => {
    expect(MIGRATION_SQL).not.toMatch(/\b(?:DROP|RENAME|TRUNCATE|DELETE)\b/i);
    expect(MIGRATION_SQL).not.toMatch(/ALTER TABLE public\.product_event/);
    for (const metricKey of EVIDENCE_AGGREGATE_METRIC_KEYS) {
      expect(MIGRATION_SQL).toContain(`'${metricKey}'`);
    }
    const sql = normalized(MIGRATION_SQL);
    expect(sql).toContain("SELECT occurred_at - received_at > INTERVAL '10 minutes'");
    expect(sql).toContain(
      "WHEN occurred_at - received_at > INTERVAL '10 minutes' THEN received_at ELSE occurred_at END AT TIME ZONE 'UTC' )::date"
    );
    expect(sql).toContain("ALTER TABLE public.evidence_daily_aggregate ENABLE ROW LEVEL SECURITY;");
  });
});

describe("F07 evidence quality source SQL contract", () => {
  test("quality metrics bucket by received_at UTC day with NULL operational dimensions and exact BS-P1-018 semantics", () => {
    const intake = normalized(POSTGRES_MATERIALIZE_INTAKE_OBSERVATION_AGGREGATES_SQL);
    expect(intake).toContain("FROM public.evidence_intake_observation WHERE received_at < $1::timestamptz");
    expect(intake).toContain("public.evidence_received_bucket_date(received_at) AS bucket_date");
    expect(intake).toContain("'event_batch_accept_rate'::text AS metric_key, accepted_attempts AS numerator_count, request_attempts AS denominator_count");
    expect(intake).toContain("count(*) FILTER (WHERE batch_accepted) AS accepted_attempts");
    expect(intake).toContain("'event_rejection_rate'::text, rejected_count, event_received_count");
    expect(intake).toContain("'duplicate_retry_rate'::text, duplicate_count, event_received_count");
    expect(intake).toContain("'unknown_event_type_count'::text, unknown_event_type_count, NULL::bigint");
    expect(intake).toContain("WHEN 'unknown_event_type_count' THEN NULL::bigint");

    const reports = normalized(POSTGRES_MATERIALIZE_CLIENT_QUALITY_REPORT_AGGREGATES_SQL);
    expect(reports).toContain("FROM public.evidence_client_quality_report WHERE received_at < $1::timestamptz");
    expect(reports).toContain("'local_queue_drop_count'::text AS metric_key, local_queue_drop_count AS numerator_count");
    expect(reports).toContain("'offline_expired_event_count'::text, offline_expired_event_count");

    for (const sql of QUALITY_MATERIALIZE_SQL) {
      expect(normalized(sql)).toContain("SELECT bucket_date, metric_key, NULL, NULL, NULL, numerator_count");
      expect(sql).not.toMatch(/\b(?:batch_id|event_id|anonymous_id|session_id|intent_id|share_id|trace_id|properties)\b/);
    }
  });

  test("each source class verifies and deletes only against its own owned metric watermarks", async () => {
    for (const sql of [
      POSTGRES_VERIFY_EVIDENCE_AGGREGATE_WATERMARK_SQL,
      POSTGRES_DELETE_RETAINED_RAW_EVIDENCE_SQL,
      ...QUALITY_COVERAGE_SQL
    ]) {
      expect(normalized(sql)).toContain("aggregate.materialized_through_received_at >= $1::timestamptz");
      expect(normalized(sql)).toContain("unnest($3::text[]) AS required(metric_key)");
    }
    for (const sql of QUALITY_COVERAGE_SQL) {
      const text = normalized(sql);
      expect(text).toContain("aggregate.bucket_date = public.evidence_received_bucket_date(source.received_at)");
      expect(text).toContain("aggregate.function_id IS NULL AND aggregate.event_type IS NULL AND aggregate.collection_class IS NULL");
    }
    expect(POSTGRES_VERIFY_INTAKE_OBSERVATION_WATERMARK_SQL).toContain("FROM public.evidence_intake_observation AS source");
    expect(POSTGRES_DELETE_RETAINED_INTAKE_OBSERVATIONS_SQL).toContain("DELETE FROM public.evidence_intake_observation AS source");
    expect(POSTGRES_VERIFY_CLIENT_QUALITY_REPORT_WATERMARK_SQL).toContain("FROM public.evidence_client_quality_report AS source");
    expect(POSTGRES_DELETE_RETAINED_CLIENT_QUALITY_REPORTS_SQL).toContain("DELETE FROM public.evidence_client_quality_report AS source");

    expect(EVIDENCE_RAW_DERIVED_METRIC_KEYS).toEqual(["event_count", "clock_invalid_rate"]);
    expect(EVIDENCE_SOURCE_OWNED_METRIC_KEYS).toEqual({
      product_event: ["event_count", "clock_invalid_rate"],
      evidence_intake_observation: [
        "event_batch_accept_rate",
        "event_rejection_rate",
        "duplicate_retry_rate",
        "unknown_event_type_count"
      ],
      evidence_client_quality_report: ["local_queue_drop_count", "offline_expired_event_count"]
    });
    expect(Object.values(EVIDENCE_SOURCE_OWNED_METRIC_KEYS).flat().sort()).toEqual([...EVIDENCE_AGGREGATE_METRIC_KEYS].sort());

    for (const sourceClass of EVIDENCE_RETENTION_SOURCE_CLASSES) {
      const executor = new RecordingExecutor([{ covered: true, deleted_count: "7" }]);
      const source = new PostgresEvidenceRetentionSource(executor, sourceClass);
      const statements = POSTGRES_EVIDENCE_RETENTION_STATEMENTS[sourceClass];

      expect(await source.verifyAggregateWatermark(WINDOW)).toBe(true);
      expect(await source.deleteEligibleSourceRows(WINDOW)).toBe(7);
      await source.materializeEligibleAggregates(WINDOW);

      const owned = [...EVIDENCE_SOURCE_OWNED_METRIC_KEYS[sourceClass]];
      expect(executor.calls).toEqual([
        { statement: statements.verify, parameters: [WINDOW.cutoffReceivedAt, WINDOW.policyVersion, owned] },
        { statement: statements.delete, parameters: [WINDOW.cutoffReceivedAt, WINDOW.policyVersion, owned] },
        { statement: statements.materialize, parameters: [WINDOW.cutoffReceivedAt, WINDOW.policyVersion, WINDOW.maintenanceNow] }
      ]);
    }
    expect(createPostgresEvidenceRetentionSources(new RecordingExecutor([])).map(source => source.sourceClass))
      .toEqual([...EVIDENCE_RETENTION_SOURCE_CLASSES]);
  });

  test("an absent or malformed verification/deletion result fails closed", async () => {
    for (const sourceClass of EVIDENCE_RETENTION_SOURCE_CLASSES) {
      const empty = new PostgresEvidenceRetentionSource(new RecordingExecutor([]), sourceClass);
      expect(await empty.verifyAggregateWatermark(WINDOW)).toBe(false);
      await expect(empty.deleteEligibleSourceRows(WINDOW)).rejects.toThrow("invalid count");

      const malformed = new PostgresEvidenceRetentionSource(
        new RecordingExecutor([{ covered: "true", deleted_count: "-1" }]),
        sourceClass
      );
      expect(await malformed.verifyAggregateWatermark(WINDOW)).toBe(false);
      await expect(malformed.deleteEligibleSourceRows(WINDOW)).rejects.toThrow("invalid count");
    }
  });

  test("quality source writes are idempotent on their own keys and never rewrite received_at", () => {
    const intake = normalized(POSTGRES_INSERT_INTAKE_OBSERVATION_SQL);
    expect(intake).toContain("INSERT INTO public.evidence_intake_observation");
    expect(intake).toContain("ON CONFLICT (observation_id) DO NOTHING");
    const report = normalized(POSTGRES_INSERT_CLIENT_QUALITY_REPORT_SQL);
    expect(report).toContain("INSERT INTO public.evidence_client_quality_report");
    expect(report).toContain("ON CONFLICT (report_id) DO NOTHING");
    for (const sql of [intake, report]) {
      expect(sql).not.toMatch(/DO UPDATE/i);
    }
  });

  test("the quality source migration is expand-only, bounded and non-identifying", () => {
    const statements = QUALITY_MIGRATION_SQL.replaceAll(/--.*$/gm, "");
    expect(statements).not.toMatch(/\b(?:DROP|RENAME|TRUNCATE|DELETE)\b/i);
    expect(statements).not.toMatch(/ALTER TABLE public\.(?:product_event|evidence_daily_aggregate)/);
    expect(statements).not.toMatch(/\b(?:batch_id|event_id|anonymous_id|session_id|intent_id|share_id|trace_id|properties|payload|body)\b/);
    const sql = normalized(statements);
    expect(sql).toContain("SELECT (received_at AT TIME ZONE 'UTC')::date");
    expect(sql).toContain("observation_id uuid PRIMARY KEY");
    expect(sql).toContain("report_id uuid PRIMARY KEY");
    expect(sql).toContain("route_rejection_code IN ('API-REQUEST-TOO-LARGE', 'F07-ERR-003', 'F07-ERR-007')");
    expect(sql).toContain("CHECK (event_received_count = accepted_count + duplicate_count + rejected_count)");
    expect(sql).toContain("CHECK (unknown_event_type_count <= rejected_count)");
    expect(sql).toContain("route_rejection_code IS NULL OR (NOT batch_accepted AND event_received_count = 0)");
    expect(sql).toContain("CHECK (local_queue_drop_count BETWEEN 0 AND 9007199254740991)");
    expect(sql).toContain("CHECK (local_queue_drop_count > 0 OR offline_expired_event_count > 0)");
    expect(sql).toContain("ON public.evidence_intake_observation (received_at)");
    expect(sql).toContain("ON public.evidence_client_quality_report (received_at)");
    expect(sql).toContain("ALTER TABLE public.evidence_intake_observation ENABLE ROW LEVEL SECURITY;");
    expect(sql).toContain("ALTER TABLE public.evidence_client_quality_report ENABLE ROW LEVEL SECURITY;");
  });
});
