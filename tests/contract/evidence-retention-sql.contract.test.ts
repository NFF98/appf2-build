import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import {
  EVIDENCE_AGGREGATE_METRIC_KEYS,
  EVIDENCE_RAW_DERIVED_METRIC_KEYS,
  rawRetentionCutoff
} from "../../src/platform/evidence/evidence-retention-maintenance.js";
import type {
  PostgresExecutor,
  PostgresQueryResult
} from "../../src/platform/evidence/postgres-evidence-repository.js";
import {
  POSTGRES_DELETE_RETAINED_RAW_EVIDENCE_SQL,
  POSTGRES_MATERIALIZE_EVIDENCE_AGGREGATES_SQL,
  POSTGRES_VERIFY_EVIDENCE_AGGREGATE_WATERMARK_SQL,
  PostgresEvidenceRetentionRepository
} from "../../src/platform/evidence/postgres-evidence-retention-repository.js";

const MIGRATION_SQL = readFileSync(
  new URL("../../supabase/migrations/20261005120000_t008_evidence_retention.sql", import.meta.url),
  "utf8"
);

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
      POSTGRES_DELETE_RETAINED_RAW_EVIDENCE_SQL
    ]) {
      expect(normalized(sql)).toMatch(/received_at < \$1::timestamptz/);
      expect(sql).not.toMatch(/occurred_at\s*<\s*\$1/);
    }
  });

  test("materialization never re-adds rows below an existing aggregate watermark", () => {
    const sql = normalized(POSTGRES_MATERIALIZE_EVIDENCE_AGGREGATES_SQL);
    expect(sql).toContain("raw.received_at >= aggregate.materialized_through_received_at");
    expect(sql).toContain("raw.received_at < EXCLUDED.materialized_through_received_at");
    expect(sql).toContain(
      "WHERE aggregate.materialized_through_received_at < EXCLUDED.materialized_through_received_at"
    );
    expect(sql).toContain(
      "ON CONFLICT ( bucket_date, metric_key, (COALESCE(function_id, '')), (COALESCE(event_type, '')), (COALESCE(collection_class, '')), policy_version )"
    );
  });

  test("verification and deletion require every raw-derived aggregate watermark to cover the cutoff", async () => {
    for (const sql of [POSTGRES_VERIFY_EVIDENCE_AGGREGATE_WATERMARK_SQL, POSTGRES_DELETE_RETAINED_RAW_EVIDENCE_SQL]) {
      expect(normalized(sql)).toContain("aggregate.materialized_through_received_at >= $1::timestamptz");
      expect(normalized(sql)).toContain("unnest($3::text[]) AS required(metric_key)");
    }
    const executor = new RecordingExecutor([{ covered: true, deleted_count: "7" }]);
    const repository = new PostgresEvidenceRetentionRepository(executor);

    expect(await repository.verifyAggregateWatermark(WINDOW)).toBe(true);
    expect(await repository.deleteEligibleRawEvents(WINDOW)).toBe(7);
    await repository.materializeEligibleAggregates(WINDOW);

    expect(executor.calls.map(call => call.parameters)).toEqual([
      [WINDOW.cutoffReceivedAt, WINDOW.policyVersion, [...EVIDENCE_RAW_DERIVED_METRIC_KEYS]],
      [WINDOW.cutoffReceivedAt, WINDOW.policyVersion, [...EVIDENCE_RAW_DERIVED_METRIC_KEYS]],
      [WINDOW.cutoffReceivedAt, WINDOW.policyVersion, WINDOW.maintenanceNow]
    ]);
  });

  test("an absent or malformed verification/deletion result fails closed", async () => {
    const empty = new PostgresEvidenceRetentionRepository(new RecordingExecutor([]));
    expect(await empty.verifyAggregateWatermark(WINDOW)).toBe(false);
    await expect(empty.deleteEligibleRawEvents(WINDOW)).rejects.toThrow("invalid count");

    const malformed = new PostgresEvidenceRetentionRepository(
      new RecordingExecutor([{ covered: "true", deleted_count: "-1" }])
    );
    expect(await malformed.verifyAggregateWatermark(WINDOW)).toBe(false);
    await expect(malformed.deleteEligibleRawEvents(WINDOW)).rejects.toThrow("invalid count");
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
