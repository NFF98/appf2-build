import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { EvidenceIngestionService } from "../../src/platform/evidence/evidence-ingestion-service.js";
import type { AnonymousIdentityRepository } from "../../src/platform/evidence/evidence-repository.js";
import {
  EVIDENCE_AGGREGATE_POLICY_VERSION,
  EvidenceRetentionMaintenance,
  type EvidenceRetentionFailure,
  type EvidenceRetentionRepository
} from "../../src/platform/evidence/evidence-retention-maintenance.js";
import { PostgresEvidenceRepository } from "../../src/platform/evidence/postgres-evidence-repository.js";
import {
  POSTGRES_DELETE_RETAINED_RAW_EVIDENCE_SQL,
  POSTGRES_MATERIALIZE_EVIDENCE_AGGREGATES_SQL,
  PostgresEvidenceRetentionRepository
} from "../../src/platform/evidence/postgres-evidence-retention-repository.js";
import { FakeEvidenceRetentionPostgres } from "./evidence-retention-postgres-fake.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 90 * DAY_MS;
const ANONYMOUS_ID = "a1e4567e-e89b-42d3-a456-426614174000";
const SESSION_ID = "b1e4567e-e89b-42d3-a456-426614174000";
const SHARE_ID = "c1e4567e-e89b-42d3-a456-426614174000";
const MIGRATION = new URL(
  "../../supabase/migrations/20261005120000_t008_evidence_retention.sql",
  import.meta.url
);

class ActiveIdentities implements AnonymousIdentityRepository {
  public async ensure(): Promise<"ACTIVE"> {
    return "ACTIVE";
  }

  public async refreshLastSeen(): Promise<void> {
    return undefined;
  }
}

class Clock {
  public current: Date;

  public constructor(iso: string) {
    this.current = new Date(iso);
  }

  public readonly now = (): Date => new Date(this.current.getTime());

  public set(epochMs: number): void {
    this.current = new Date(epochMs);
  }
}

function eventId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function shareRestoreReady(index: number, occurredAt: string) {
  return {
    event_id: eventId(index),
    event_type: "F05-EVT-007",
    schema_version: "2.0.0",
    occurred_at: occurredAt,
    anonymous_id: ANONYMOUS_ID,
    session_id: SESSION_ID,
    function_id: "F05",
    share_id: SHARE_ID,
    properties: { share_mode: "DURABLE_REFERENCE" }
  };
}

function shellOpened(index: number, occurredAt: string) {
  return {
    event_id: eventId(index),
    event_type: "F00-EVT-001",
    schema_version: "2.0.0",
    occurred_at: occurredAt,
    anonymous_id: ANONYMOUS_ID,
    session_id: SESSION_ID,
    function_id: "F00",
    properties: { surface: "DISCOVER", source_capsule_id: "capsule-1" }
  };
}

function createHarness(startIso: string) {
  const database = new FakeEvidenceRetentionPostgres();
  const clock = new Clock(startIso);
  const failures: EvidenceRetentionFailure[] = [];
  const intakeFailures: unknown[] = [];
  const ingestion = new EvidenceIngestionService({
    anonymousIdentities: new ActiveIdentities(),
    evidence: new PostgresEvidenceRepository(database),
    diagnostics: { reportNonBlockingFailure: error => { intakeFailures.push(error); } },
    now: clock.now
  });
  const repository = new PostgresEvidenceRetentionRepository(database);
  const maintenance = (target: EvidenceRetentionRepository = repository) => new EvidenceRetentionMaintenance({
    repository: target,
    diagnostics: { reportMaintenanceFailure: failure => { failures.push(failure); } },
    now: clock.now
  });
  return { clock, database, failures, intakeFailures, ingestion, maintenance, repository };
}

function aggregateCounts(database: FakeEvidenceRetentionPostgres) {
  return database.aggregateRows()
    .map(row => ({
      bucket_date: row.bucket_date,
      metric_key: row.metric_key,
      event_type: row.event_type,
      numerator_count: row.numerator_count,
      denominator_count: row.denominator_count
    }))
    .sort((left, right) =>
      `${left.bucket_date}${left.event_type ?? ""}${left.metric_key}`
        .localeCompare(`${right.bucket_date}${right.event_type ?? ""}${right.metric_key}`));
}

function storedEventIds(database: FakeEvidenceRetentionPostgres): string[] {
  return [...database.events.keys()].sort();
}

async function proveReceivedAtCutoffAndRerun(): Promise<void> {
  const receivedA = Date.parse("2026-01-01T12:00:00.000Z");
  const harness = createHarness("2026-01-01T12:00:00.000Z");

  const first = await harness.ingestion.ingest([shareRestoreReady(1, "2026-01-01T11:59:00.000Z")]);
  expect(first).toMatchObject({ accepted: 1, duplicates: 0 });

  harness.clock.set(receivedA + 30 * DAY_MS);
  await harness.ingestion.ingest([shareRestoreReady(2, "2025-12-01T00:00:00.000Z")]);

  harness.clock.set(receivedA + 88 * DAY_MS);
  const retry = await harness.ingestion.ingest([shareRestoreReady(1, "2026-01-01T11:59:00.000Z")]);
  expect(retry).toMatchObject({ accepted: 0, duplicates: 1 });
  expect(harness.database.events.get(eventId(1))?.received_at).toBe("2026-01-01T12:00:00.000Z");

  harness.clock.set(receivedA + RETENTION_MS);
  const boundary = await harness.maintenance().run();
  expect(boundary).toEqual({
    status: "COMPLETED",
    maintenance_now: new Date(receivedA + RETENTION_MS).toISOString(),
    cutoff_received_at: "2026-01-01T12:00:00.000Z",
    deleted_raw_events: 0
  });
  expect(storedEventIds(harness.database)).toEqual([eventId(1), eventId(2)]);

  harness.clock.set(receivedA + RETENTION_MS + 1);
  const due = await harness.maintenance().run();
  expect(due).toMatchObject({ status: "COMPLETED", deleted_raw_events: 1 });
  expect(storedEventIds(harness.database)).toEqual([eventId(2)]);
  const afterFirstDeletion = aggregateCounts(harness.database);
  expect(afterFirstDeletion).toContainEqual({
    bucket_date: "2026-01-01",
    metric_key: "event_count",
    event_type: "F05-EVT-007",
    numerator_count: 1,
    denominator_count: null
  });

  const rerun = await harness.maintenance().run();
  expect(rerun).toMatchObject({ status: "COMPLETED", deleted_raw_events: 0 });
  expect(aggregateCounts(harness.database)).toEqual(afterFirstDeletion);

  harness.clock.set(receivedA + 30 * DAY_MS + RETENTION_MS + 1);
  expect(await harness.maintenance().run()).toMatchObject({ status: "COMPLETED", deleted_raw_events: 1 });
  expect(storedEventIds(harness.database)).toEqual([]);
  expect(aggregateCounts(harness.database)).toContainEqual({
    bucket_date: "2025-12-01",
    metric_key: "event_count",
    event_type: "F05-EVT-007",
    numerator_count: 1,
    denominator_count: null
  });
  expect(harness.failures).toEqual([]);
  expect(harness.intakeFailures).toEqual([]);
}

async function proveIncrementalWatermarkAcrossRuns(): Promise<void> {
  const harness = createHarness("2026-02-01T23:30:00.000Z");
  await harness.ingestion.ingest([shareRestoreReady(10, "2026-02-01T23:00:00.000Z")]);
  harness.clock.set(Date.parse("2026-02-02T10:00:00.000Z"));
  await harness.ingestion.ingest([shareRestoreReady(11, "2026-02-01T23:50:00.000Z")]);

  harness.clock.set(Date.parse("2026-02-01T23:30:00.000Z") + RETENTION_MS + 1);
  expect(await harness.maintenance().run()).toMatchObject({ deleted_raw_events: 1 });
  harness.clock.set(Date.parse("2026-02-02T10:00:00.000Z") + RETENTION_MS + 1);
  expect(await harness.maintenance().run()).toMatchObject({ deleted_raw_events: 1 });
  expect(await harness.maintenance().run()).toMatchObject({ deleted_raw_events: 0 });

  expect(aggregateCounts(harness.database)).toEqual([
    {
      bucket_date: "2026-02-01",
      metric_key: "clock_invalid_rate",
      event_type: "F05-EVT-007",
      numerator_count: 0,
      denominator_count: 2
    },
    {
      bucket_date: "2026-02-01",
      metric_key: "event_count",
      event_type: "F05-EVT-007",
      numerator_count: 2,
      denominator_count: null
    }
  ]);
}

async function proveFailClosedDeletion(): Promise<void> {
  const receivedAt = Date.parse("2026-03-01T00:00:00.000Z");
  const harness = createHarness("2026-03-01T00:00:00.000Z");
  await harness.ingestion.ingest([shareRestoreReady(20, "2026-02-28T23:59:00.000Z")]);
  harness.clock.set(receivedAt + RETENTION_MS + 1);

  expect(await harness.repository.deleteEligibleRawEvents({
    cutoffReceivedAt: new Date(receivedAt + 1).toISOString(),
    maintenanceNow: harness.clock.now().toISOString(),
    policyVersion: EVIDENCE_AGGREGATE_POLICY_VERSION
  })).toBe(0);

  harness.database.failNext = POSTGRES_MATERIALIZE_EVIDENCE_AGGREGATES_SQL;
  expect(await harness.maintenance().run()).toMatchObject({
    status: "FAILED_CLOSED",
    stage: "MATERIALIZE",
    deleted_raw_events: 0
  });

  const skipsMaterialization: EvidenceRetentionRepository = {
    materializeEligibleAggregates: async () => undefined,
    verifyAggregateWatermark: window => harness.repository.verifyAggregateWatermark(window),
    deleteEligibleRawEvents: window => harness.repository.deleteEligibleRawEvents(window)
  };
  const deletesBefore = harness.database.statements.filter(sql => sql === POSTGRES_DELETE_RETAINED_RAW_EVIDENCE_SQL).length;
  expect(await harness.maintenance(skipsMaterialization).run()).toMatchObject({
    status: "FAILED_CLOSED",
    stage: "VERIFY",
    deleted_raw_events: 0
  });
  expect(harness.database.statements.filter(sql => sql === POSTGRES_DELETE_RETAINED_RAW_EVIDENCE_SQL)).toHaveLength(deletesBefore);

  harness.database.failNext = POSTGRES_DELETE_RETAINED_RAW_EVIDENCE_SQL;
  expect(await harness.maintenance().run()).toMatchObject({ status: "FAILED_CLOSED", stage: "DELETE" });
  expect(storedEventIds(harness.database)).toEqual([eventId(20)]);
  expect(harness.failures.map(failure => failure.stage)).toEqual(["MATERIALIZE", "VERIFY", "DELETE"]);
  expect(harness.failures.every(failure => failure.cutoff_received_at === new Date(receivedAt + 1).toISOString())).toBe(true);

  expect(await harness.maintenance().run()).toMatchObject({ status: "COMPLETED", deleted_raw_events: 1 });
  expect(aggregateCounts(harness.database).filter(row => row.metric_key === "event_count")).toEqual([
    { bucket_date: "2026-02-28", metric_key: "event_count", event_type: "F05-EVT-007", numerator_count: 1, denominator_count: null }
  ]);
}

function migrationTableColumns(sql: string, table: string): string[] {
  const start = sql.indexOf(`CREATE TABLE public.${table} (`);
  const end = sql.indexOf("\n);", start);
  expect(start).toBeGreaterThanOrEqual(0);
  return sql.slice(start, end)
    .split("\n")
    .slice(1)
    .map(line => /^ {2}([a-z_]+) /.exec(line)?.[1])
    .filter((column): column is string => column !== undefined);
}

describe("F07 raw evidence retention", () => {
  test("TEST-F07-026 EvidenceRetentionMaintenance deletes raw product_event only after received_at + 90 days and verified aggregate watermark", async () => {
    await proveReceivedAtCutoffAndRerun();
    await proveIncrementalWatermarkAcrossRuns();
    await proveFailClosedDeletion();
  });

  test("TEST-F07-AC-027 evidence_daily_aggregate keeps bounded non-identifying counts and rates after raw deletion", async () => {
    const harness = createHarness("2026-01-01T23:55:00.000Z");
    const ingested = await harness.ingestion.ingest([
      shareRestoreReady(30, "2026-01-01T23:50:00.000Z"),
      shareRestoreReady(31, "2026-01-02T00:30:00.000Z"),
      shellOpened(32, "2026-01-01T23:54:00.000Z")
    ]);
    expect(ingested).toMatchObject({ accepted: 3, rejected: 0, diagnostics: [{ event_id: eventId(31), code: "F07-ERR-013" }] });

    harness.clock.set(Date.parse("2026-01-01T23:55:00.000Z") + RETENTION_MS + 1);
    expect(await harness.maintenance().run()).toMatchObject({ status: "COMPLETED", deleted_raw_events: 3 });
    expect(harness.database.events.size).toBe(0);

    expect(aggregateCounts(harness.database)).toEqual([
      { bucket_date: "2026-01-01", metric_key: "clock_invalid_rate", event_type: "F00-EVT-001", numerator_count: 0, denominator_count: 1 },
      { bucket_date: "2026-01-01", metric_key: "event_count", event_type: "F00-EVT-001", numerator_count: 1, denominator_count: null },
      { bucket_date: "2026-01-01", metric_key: "clock_invalid_rate", event_type: "F05-EVT-007", numerator_count: 1, denominator_count: 2 },
      { bucket_date: "2026-01-01", metric_key: "event_count", event_type: "F05-EVT-007", numerator_count: 2, denominator_count: null }
    ]);

    const aggregateColumns = [
      "aggregate_id",
      "bucket_date",
      "metric_key",
      "function_id",
      "event_type",
      "collection_class",
      "numerator_count",
      "denominator_count",
      "policy_version",
      "materialized_through_received_at",
      "updated_at"
    ];
    const migrationColumns = migrationTableColumns(readFileSync(MIGRATION, "utf8"), "evidence_daily_aggregate");
    expect(migrationColumns).toEqual(aggregateColumns);
    for (const identity of ["event_id", "anonymous_id", "session_id", "intent_id", "share_id", "trace_id", "properties", "occurred_at", "received_at"]) {
      expect(migrationColumns).not.toContain(identity);
    }
    const persisted = JSON.stringify(harness.database.aggregateRows());
    for (const row of harness.database.aggregateRows()) {
      expect(Object.keys(row).sort()).toEqual([...aggregateColumns].sort());
      expect(row.collection_class).toBeNull();
      expect(row.policy_version).toBe(EVIDENCE_AGGREGATE_POLICY_VERSION);
    }
    for (const identityValue of [ANONYMOUS_ID, SESSION_ID, SHARE_ID, eventId(30), eventId(31), eventId(32), "DURABLE_REFERENCE", "capsule-1"]) {
      expect(persisted).not.toContain(identityValue);
    }
  });
});
