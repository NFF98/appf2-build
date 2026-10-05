import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import {
  createProductionEventsBatchHandler,
  createProductionEvidenceRetentionMaintenance
} from "../../src/edge/evidence-runtime.js";
import { EvidenceIngestionService } from "../../src/platform/evidence/evidence-ingestion-service.js";
import type { AnonymousIdentityRepository } from "../../src/platform/evidence/evidence-repository.js";
import {
  EVIDENCE_AGGREGATE_POLICY_VERSION,
  EVIDENCE_RETENTION_SOURCE_CLASSES,
  EvidenceRetentionMaintenance,
  evidenceAggregateRate,
  type EvidenceRetentionFailure,
  type EvidenceRetentionRunResult,
  type EvidenceRetentionSourceClass,
  type EvidenceRetentionSourceRepository
} from "../../src/platform/evidence/evidence-retention-maintenance.js";
import { PostgresEvidenceRepository } from "../../src/platform/evidence/postgres-evidence-repository.js";
import {
  createPostgresEvidenceRetentionSources,
  POSTGRES_DELETE_RETAINED_RAW_EVIDENCE_SQL,
  POSTGRES_MATERIALIZE_EVIDENCE_AGGREGATES_SQL,
  POSTGRES_MATERIALIZE_INTAKE_OBSERVATION_AGGREGATES_SQL,
  PostgresEvidenceRetentionSource
} from "../../src/platform/evidence/postgres-evidence-retention-repository.js";
import { FakeEvidenceRetentionPostgres, type StoredDailyAggregate } from "./evidence-retention-postgres-fake.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 90 * DAY_MS;
const ANONYMOUS_ID = "a1e4567e-e89b-42d3-a456-426614174000";
const SESSION_ID = "b1e4567e-e89b-42d3-a456-426614174000";
const SHARE_ID = "c1e4567e-e89b-42d3-a456-426614174000";
const BATCH_ID = "d1e4567e-e89b-42d3-a456-426614174000";
const REPORT_ID = "e1e4567e-e89b-42d3-a456-426614174000";
const SECOND_REPORT_ID = "f1e4567e-e89b-42d3-a456-426614174000";
const RETENTION_MIGRATION = new URL(
  "../../supabase/migrations/20261005120000_t008_evidence_retention.sql",
  import.meta.url
);
const QUALITY_MIGRATION = new URL(
  "../../supabase/migrations/20261005130000_t008_evidence_quality_sources.sql",
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
  let uuidIndex = 0;
  const diagnostics = {
    reportNonBlockingFailure: (error: unknown) => { intakeFailures.push(error); },
    reportMaintenanceFailure: (failure: EvidenceRetentionFailure) => { failures.push(failure); }
  };
  const ingestion = new EvidenceIngestionService({
    anonymousIdentities: new ActiveIdentities(),
    evidence: new PostgresEvidenceRepository(database),
    diagnostics,
    now: clock.now
  });
  const handler = createProductionEventsBatchHandler({
    executor: database,
    diagnostics,
    now: clock.now,
    randomUUID: () => {
      uuidIndex += 1;
      return `99999999-0000-4000-8000-${String(uuidIndex).padStart(12, "0")}`;
    }
  });
  const sources = createPostgresEvidenceRetentionSources(database);
  const maintenance = (override?: EvidenceRetentionSourceRepository) => override === undefined
    ? createProductionEvidenceRetentionMaintenance({ executor: database, diagnostics, now: clock.now })
    : new EvidenceRetentionMaintenance({
        sources: sources.map(source => source.sourceClass === override.sourceClass ? override : source),
        diagnostics,
        now: clock.now
      });
  const post = (body: unknown) => handler({ body: typeof body === "string" ? body : JSON.stringify(body) });
  return { clock, database, failures, intakeFailures, ingestion, maintenance, post, sources };
}

function completedRun(
  maintenanceNow: number,
  deleted: Partial<Record<EvidenceRetentionSourceClass, number>> = {}
): EvidenceRetentionRunResult {
  return {
    status: "COMPLETED",
    maintenance_now: new Date(maintenanceNow).toISOString(),
    cutoff_received_at: new Date(maintenanceNow - RETENTION_MS).toISOString(),
    sources: EVIDENCE_RETENTION_SOURCE_CLASSES.map(sourceClass => ({
      source_class: sourceClass,
      status: "COMPLETED",
      deleted_rows: deleted[sourceClass] ?? 0
    }))
  };
}

function sourceResult(run: EvidenceRetentionRunResult, sourceClass: EvidenceRetentionSourceClass) {
  return run.sources.find(result => result.source_class === sourceClass);
}

function aggregateCounts(database: FakeEvidenceRetentionPostgres, metricKeys?: readonly string[]) {
  return database.aggregateRows()
    .filter(row => metricKeys === undefined || metricKeys.includes(row.metric_key))
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
  expect(await harness.maintenance().run()).toEqual(completedRun(receivedA + RETENTION_MS));
  expect(storedEventIds(harness.database)).toEqual([eventId(1), eventId(2)]);

  harness.clock.set(receivedA + RETENTION_MS + 1);
  expect(await harness.maintenance().run()).toEqual(completedRun(receivedA + RETENTION_MS + 1, { product_event: 1 }));
  expect(storedEventIds(harness.database)).toEqual([eventId(2)]);
  const afterFirstDeletion = aggregateCounts(harness.database);
  expect(afterFirstDeletion).toContainEqual({
    bucket_date: "2026-01-01",
    metric_key: "event_count",
    event_type: "F05-EVT-007",
    numerator_count: 1,
    denominator_count: null
  });

  expect(await harness.maintenance().run()).toEqual(completedRun(receivedA + RETENTION_MS + 1));
  expect(aggregateCounts(harness.database)).toEqual(afterFirstDeletion);

  harness.clock.set(receivedA + 30 * DAY_MS + RETENTION_MS + 1);
  expect(sourceResult(await harness.maintenance().run(), "product_event")).toEqual({
    source_class: "product_event",
    status: "COMPLETED",
    deleted_rows: 1
  });
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
  expect(sourceResult(await harness.maintenance().run(), "product_event")).toMatchObject({ deleted_rows: 1 });
  harness.clock.set(Date.parse("2026-02-02T10:00:00.000Z") + RETENTION_MS + 1);
  expect(sourceResult(await harness.maintenance().run(), "product_event")).toMatchObject({ deleted_rows: 1 });
  expect(sourceResult(await harness.maintenance().run(), "product_event")).toMatchObject({ deleted_rows: 0 });

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
  const productEvent = new PostgresEvidenceRetentionSource(harness.database, "product_event");

  expect(await productEvent.deleteEligibleSourceRows({
    cutoffReceivedAt: new Date(receivedAt + 1).toISOString(),
    maintenanceNow: harness.clock.now().toISOString(),
    policyVersion: EVIDENCE_AGGREGATE_POLICY_VERSION
  })).toBe(0);

  harness.database.failNext = POSTGRES_MATERIALIZE_EVIDENCE_AGGREGATES_SQL;
  expect(sourceResult(await harness.maintenance().run(), "product_event")).toEqual({
    source_class: "product_event",
    status: "FAILED_CLOSED",
    stage: "MATERIALIZE",
    deleted_rows: 0
  });

  const skipsMaterialization: EvidenceRetentionSourceRepository = {
    sourceClass: "product_event",
    materializeEligibleAggregates: async () => undefined,
    verifyAggregateWatermark: window => productEvent.verifyAggregateWatermark(window),
    deleteEligibleSourceRows: window => productEvent.deleteEligibleSourceRows(window)
  };
  const deletesBefore = harness.database.executed(POSTGRES_DELETE_RETAINED_RAW_EVIDENCE_SQL);
  expect(await harness.maintenance(skipsMaterialization).run()).toMatchObject({
    status: "FAILED_CLOSED",
    sources: [{ source_class: "product_event", status: "FAILED_CLOSED", stage: "VERIFY", deleted_rows: 0 }, {}, {}]
  });
  expect(harness.database.executed(POSTGRES_DELETE_RETAINED_RAW_EVIDENCE_SQL)).toBe(deletesBefore);

  harness.database.failNext = POSTGRES_DELETE_RETAINED_RAW_EVIDENCE_SQL;
  expect(sourceResult(await harness.maintenance().run(), "product_event")).toMatchObject({
    status: "FAILED_CLOSED",
    stage: "DELETE"
  });
  expect(storedEventIds(harness.database)).toEqual([eventId(20)]);
  expect(harness.failures.map(failure => [failure.source_class, failure.stage])).toEqual([
    ["product_event", "MATERIALIZE"],
    ["product_event", "VERIFY"],
    ["product_event", "DELETE"]
  ]);
  expect(harness.failures.every(failure => failure.cutoff_received_at === new Date(receivedAt + 1).toISOString())).toBe(true);

  expect(sourceResult(await harness.maintenance().run(), "product_event")).toMatchObject({
    status: "COMPLETED",
    deleted_rows: 1
  });
  expect(aggregateCounts(harness.database, ["event_count"])).toEqual([
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

const AGGREGATE_COLUMNS = [
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

const IDENTITY_COLUMNS = ["event_id", "anonymous_id", "session_id", "intent_id", "share_id", "trace_id", "properties"];

// Day 1: one canonical batch, its retry, three pre-service rejections and a quality-only batch.
// Day 2: only a malformed request, so its event-level rates have a zero denominator.
async function ingestQualityDays(harness: ReturnType<typeof createHarness>): Promise<void> {
  const report = { report_id: REPORT_ID, local_queue_drop_count: 3, offline_expired_event_count: 1 };
  const canonical = [
    shareRestoreReady(30, "2026-01-01T11:59:00.000Z"),
    shareRestoreReady(31, "2026-01-01T12:30:00.000Z"),
    shellOpened(32, "2026-01-01T12:10:00.000Z"),
    { ...shareRestoreReady(33, "2026-01-01T11:00:00.000Z"), event_type: "F05-EVT-999" },
    { ...shareRestoreReady(34, "2026-01-01T11:00:00.000Z"), properties: { share_mode: "DURABLE_REFERENCE", raw_intent: "secret prompt" } }
  ];
  const first = await harness.post({ batch_id: BATCH_ID, events: canonical, quality_report: report });
  expect(first).toMatchObject({
    status: 200,
    body: { data: { accepted: 3, duplicates: 0, rejected: 2, diagnostics: [{ event_id: eventId(31), code: "F07-ERR-013" }] } }
  });
  harness.clock.set(Date.parse("2026-01-01T12:05:00.000Z"));
  const retry = await harness.post({ batch_id: BATCH_ID, events: canonical.slice(0, 2), quality_report: report });
  expect(retry).toMatchObject({ status: 200, body: { data: { accepted: 0, duplicates: 2, rejected: 0 } } });
  expect((await harness.post(new Uint8Array(256 * 1024 + 1).fill(32))).body).toMatchObject({ error: { code: "API-REQUEST-TOO-LARGE" } });
  expect((await harness.post("{")).body).toMatchObject({ error: { code: "F07-ERR-003" } });
  const tooMany = Array.from({ length: 51 }, (_, index) => shareRestoreReady(100 + index, "2026-01-01T11:00:00.000Z"));
  expect((await harness.post({ batch_id: BATCH_ID, events: tooMany })).body).toMatchObject({ error: { code: "F07-ERR-007" } });
  const qualityOnly = await harness.post({
    batch_id: BATCH_ID,
    events: [],
    quality_report: { report_id: SECOND_REPORT_ID, local_queue_drop_count: 0, offline_expired_event_count: 2 }
  });
  expect(qualityOnly).toMatchObject({ status: 200, body: { data: { accepted: 0, duplicates: 0, rejected: 0 } } });

  harness.clock.set(Date.parse("2026-01-02T08:00:00.000Z"));
  expect((await harness.post({ batch_id: BATCH_ID, events: [] })).body).toMatchObject({ error: { code: "F07-ERR-003" } });
  expect(harness.database.intakeObservations.size).toBe(7);
  expect(harness.database.clientQualityReports.size).toBe(2);
}

async function proveAllSevenQualityMetricsSurviveDeletion(): Promise<void> {
  const harness = createHarness("2026-01-01T12:00:00.000Z");
  await ingestQualityDays(harness);

  const maintenanceNow = Date.parse("2026-01-02T08:00:00.000Z") + RETENTION_MS + 1;
  harness.clock.set(maintenanceNow);
  expect(await harness.maintenance().run()).toEqual(completedRun(maintenanceNow, {
    product_event: 3,
    evidence_intake_observation: 7,
    evidence_client_quality_report: 2
  }));
  expect(harness.database.events.size).toBe(0);
  expect(harness.database.intakeObservations.size).toBe(0);
  expect(harness.database.clientQualityReports.size).toBe(0);

  const expected = [
    { bucket_date: "2026-01-01", metric_key: "duplicate_retry_rate", event_type: null, numerator_count: 2, denominator_count: 7 },
    { bucket_date: "2026-01-01", metric_key: "event_batch_accept_rate", event_type: null, numerator_count: 3, denominator_count: 6 },
    { bucket_date: "2026-01-01", metric_key: "event_rejection_rate", event_type: null, numerator_count: 2, denominator_count: 7 },
    { bucket_date: "2026-01-01", metric_key: "clock_invalid_rate", event_type: "F00-EVT-001", numerator_count: 0, denominator_count: 1 },
    { bucket_date: "2026-01-01", metric_key: "event_count", event_type: "F00-EVT-001", numerator_count: 1, denominator_count: null },
    { bucket_date: "2026-01-01", metric_key: "clock_invalid_rate", event_type: "F05-EVT-007", numerator_count: 1, denominator_count: 2 },
    { bucket_date: "2026-01-01", metric_key: "event_count", event_type: "F05-EVT-007", numerator_count: 2, denominator_count: null },
    { bucket_date: "2026-01-01", metric_key: "local_queue_drop_count", event_type: null, numerator_count: 3, denominator_count: null },
    { bucket_date: "2026-01-01", metric_key: "offline_expired_event_count", event_type: null, numerator_count: 3, denominator_count: null },
    { bucket_date: "2026-01-01", metric_key: "unknown_event_type_count", event_type: null, numerator_count: 1, denominator_count: null },
    { bucket_date: "2026-01-02", metric_key: "duplicate_retry_rate", event_type: null, numerator_count: 0, denominator_count: 0 },
    { bucket_date: "2026-01-02", metric_key: "event_batch_accept_rate", event_type: null, numerator_count: 0, denominator_count: 1 },
    { bucket_date: "2026-01-02", metric_key: "event_rejection_rate", event_type: null, numerator_count: 0, denominator_count: 0 },
    { bucket_date: "2026-01-02", metric_key: "unknown_event_type_count", event_type: null, numerator_count: 0, denominator_count: null }
  ];
  expect(aggregateCounts(harness.database)).toEqual(expected);
  const day2Rejection = harness.database.aggregateRows()
    .find(row => row.bucket_date === "2026-01-02" && row.metric_key === "event_rejection_rate");
  expect(evidenceAggregateRate(day2Rejection?.numerator_count ?? -1, day2Rejection?.denominator_count ?? null)).toBeNull();
  expect(evidenceAggregateRate(2, 7)).toBeCloseTo(2 / 7);
  expect(evidenceAggregateRate(1, null)).toBeNull();

  const operational = harness.database.aggregateRows().filter(row => row.function_id === null);
  expect(operational).toHaveLength(10);
  for (const row of operational) {
    expect([row.event_type, row.collection_class]).toEqual([null, null]);
  }

  expect(await harness.maintenance().run()).toEqual(completedRun(maintenanceNow));
  expect(aggregateCounts(harness.database)).toEqual(expected);
  expect(harness.failures).toEqual([]);
  expect(harness.intakeFailures).toEqual([]);
  assertNonIdentifying(harness.database.aggregateRows());
}

function assertNonIdentifying(rows: readonly StoredDailyAggregate[]): void {
  const retentionSql = readFileSync(RETENTION_MIGRATION, "utf8");
  const qualitySql = readFileSync(QUALITY_MIGRATION, "utf8");
  expect(migrationTableColumns(retentionSql, "evidence_daily_aggregate")).toEqual(AGGREGATE_COLUMNS);
  expect(migrationTableColumns(qualitySql, "evidence_intake_observation")).toEqual([
    "observation_id",
    "received_at",
    "batch_accepted",
    "event_received_count",
    "accepted_count",
    "duplicate_count",
    "rejected_count",
    "unknown_event_type_count",
    "route_rejection_code"
  ]);
  expect(migrationTableColumns(qualitySql, "evidence_client_quality_report")).toEqual([
    "report_id",
    "received_at",
    "local_queue_drop_count",
    "offline_expired_event_count"
  ]);
  for (const table of ["evidence_intake_observation", "evidence_client_quality_report"]) {
    for (const identity of [...IDENTITY_COLUMNS, "batch_id"]) {
      expect(migrationTableColumns(qualitySql, table)).not.toContain(identity);
    }
  }
  for (const identity of [...IDENTITY_COLUMNS, "occurred_at", "received_at"]) {
    expect(AGGREGATE_COLUMNS).not.toContain(identity);
  }
  const persisted = JSON.stringify(rows);
  for (const row of rows) {
    expect(Object.keys(row).sort()).toEqual([...AGGREGATE_COLUMNS].sort());
    expect(row.collection_class).toBeNull();
    expect(row.policy_version).toBe(EVIDENCE_AGGREGATE_POLICY_VERSION);
  }
  for (const value of [ANONYMOUS_ID, SESSION_ID, SHARE_ID, BATCH_ID, REPORT_ID, eventId(30), "DURABLE_REFERENCE", "capsule-1", "secret prompt"]) {
    expect(persisted).not.toContain(value);
  }
}

// One source class failing closed keeps its own rows, never borrows another class's coverage and
// never blocks the deletion another class verified on its own.
async function proveSourceSpecificWatermarks(): Promise<void> {
  const harness = createHarness("2026-01-01T12:00:00.000Z");
  await ingestQualityDays(harness);
  const maintenanceNow = Date.parse("2026-01-02T08:00:00.000Z") + RETENTION_MS + 1;
  harness.clock.set(maintenanceNow);

  harness.database.failNext = POSTGRES_MATERIALIZE_INTAKE_OBSERVATION_AGGREGATES_SQL;
  const partial = await harness.maintenance().run();
  expect(partial.status).toBe("FAILED_CLOSED");
  expect(partial.sources).toEqual([
    { source_class: "product_event", status: "COMPLETED", deleted_rows: 3 },
    { source_class: "evidence_intake_observation", status: "FAILED_CLOSED", stage: "MATERIALIZE", deleted_rows: 0 },
    { source_class: "evidence_client_quality_report", status: "COMPLETED", deleted_rows: 2 }
  ]);
  expect(harness.database.intakeObservations.size).toBe(7);
  expect(aggregateCounts(harness.database, ["event_batch_accept_rate", "event_rejection_rate"])).toEqual([]);

  const intake = harness.sources.find(source => source.sourceClass === "evidence_intake_observation");
  if (intake === undefined) {
    throw new Error("intake source missing");
  }
  const skipsIntakeMaterialization: EvidenceRetentionSourceRepository = {
    sourceClass: "evidence_intake_observation",
    materializeEligibleAggregates: async () => undefined,
    verifyAggregateWatermark: window => intake.verifyAggregateWatermark(window),
    deleteEligibleSourceRows: window => intake.deleteEligibleSourceRows(window)
  };
  expect(await harness.maintenance(skipsIntakeMaterialization).run()).toMatchObject({
    status: "FAILED_CLOSED",
    sources: [
      { source_class: "product_event", status: "COMPLETED", deleted_rows: 0 },
      { source_class: "evidence_intake_observation", status: "FAILED_CLOSED", stage: "VERIFY", deleted_rows: 0 },
      { source_class: "evidence_client_quality_report", status: "COMPLETED", deleted_rows: 0 }
    ]
  });
  expect(await intake.deleteEligibleSourceRows({
    cutoffReceivedAt: new Date(maintenanceNow - RETENTION_MS).toISOString(),
    maintenanceNow: new Date(maintenanceNow).toISOString(),
    policyVersion: EVIDENCE_AGGREGATE_POLICY_VERSION
  })).toBe(0);
  expect(harness.database.intakeObservations.size).toBe(7);
  expect(harness.failures.map(failure => [failure.source_class, failure.stage])).toEqual([
    ["evidence_intake_observation", "MATERIALIZE"],
    ["evidence_intake_observation", "VERIFY"]
  ]);

  expect(await harness.maintenance().run()).toEqual(completedRun(maintenanceNow, { evidence_intake_observation: 7 }));
  expect(aggregateCounts(harness.database, ["event_batch_accept_rate"])).toEqual([
    { bucket_date: "2026-01-01", metric_key: "event_batch_accept_rate", event_type: null, numerator_count: 3, denominator_count: 6 },
    { bucket_date: "2026-01-02", metric_key: "event_batch_accept_rate", event_type: null, numerator_count: 0, denominator_count: 1 }
  ]);
}

describe("F07 raw evidence retention", () => {
  test("TEST-F07-026 EvidenceRetentionMaintenance deletes raw product_event only after received_at + 90 days and verified aggregate watermark", async () => {
    await proveReceivedAtCutoffAndRerun();
    await proveIncrementalWatermarkAcrossRuns();
    await proveFailClosedDeletion();
  });

  test("TEST-F07-AC-027 evidence_daily_aggregate keeps bounded non-identifying counts and rates after raw deletion", async () => {
    await proveAllSevenQualityMetricsSurviveDeletion();
    await proveSourceSpecificWatermarks();
  });
});
