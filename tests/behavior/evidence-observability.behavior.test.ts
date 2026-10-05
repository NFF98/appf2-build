import { afterEach, describe, expect, test, vi } from "vitest";

import {
  createProductionEventsBatchHandler,
  createProductionEvidenceRetentionMaintenance
} from "../../src/edge/evidence-runtime.js";
import type { EventsBatchHttpRequest, EventsBatchHttpResponse } from "../../src/edge/events-batch.js";
import { createBrowserEvidenceBeaconTransport } from "../../src/platform/evidence/evidence-batch-transport.js";
import {
  EVIDENCE_QUEUE_LIMITS,
  EvidenceClientQueue,
  type AdmittedEvidenceEvent,
  type EvidenceCollectionClass
} from "../../src/platform/evidence/evidence-client-queue.js";
import { createBrowserEvidenceCollector } from "../../src/platform/evidence/evidence-collector.js";
import type {
  EvidenceQueueDrop,
  EvidenceQueueObserver
} from "../../src/platform/evidence/evidence-observability.js";
import type { EvidenceQualityReport } from "../../src/platform/evidence/evidence-quality-report.js";
import { createIndexedDbEvidenceQueueStore } from "../../src/platform/evidence/evidence-queue-store.js";
import type { EvidenceRetentionFailure } from "../../src/platform/evidence/evidence-retention-maintenance.js";
import type { EvidenceEventInput } from "../../src/platform/evidence/evidence-types.js";
import {
  POSTGRES_INSERT_CLIENT_QUALITY_REPORT_SQL,
  POSTGRES_INSERT_INTAKE_OBSERVATION_SQL
} from "../../src/platform/evidence/postgres-evidence-quality-repository.js";
import { ManualScheduler } from "../unit/evidence-collector-test-support.js";
import { FakeIndexedDbFactory } from "../unit/evidence-fake-indexeddb.js";
import {
  coreOutcomeEvent,
  createRecordingNavigator,
  drain,
  durableQueueIds,
  hangingFetch,
  ManualClock,
  persistQueuedEvent,
  productSampleEvent,
  QUEUE_T0
} from "../unit/evidence-queue-test-support.js";
import { FakeEvidenceRetentionPostgres } from "./evidence-retention-postgres-fake.js";

const SYNTHETIC_EVENT_BYTES = 8 * 1024;
const RECORDS_AT_BYTE_BOUND = EVIDENCE_QUEUE_LIMITS.maxBytes / SYNTHETIC_EVENT_BYTES;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const BATCH_ID = "d3e4567e-e89b-42d3-a456-426614174000";
const REPORT_ID = "e3e4567e-e89b-42d3-a456-426614174000";
const SECOND_REPORT_ID = "f3e4567e-e89b-42d3-a456-426614174000";
const ANONYMOUS_ID = "a3e4567e-e89b-42d3-a456-426614174000";

interface SentBatch {
  readonly batch_id: string;
  readonly events: readonly EvidenceEventInput[];
  readonly quality_report?: EvidenceQualityReport;
}

class RecordingDrops implements EvidenceQueueObserver {
  public readonly drops: EvidenceQueueDrop[] = [];

  public observeQueueDrop(drop: EvidenceQueueDrop): void {
    this.drops.push(drop);
  }

  public count(code: EvidenceQueueDrop["code"], collectionClass?: EvidenceCollectionClass): number {
    return this.drops.filter(drop =>
      drop.code === code && (collectionClass === undefined || drop.collection_class === collectionClass)
    ).length;
  }
}

function syntheticEvent(index: number, collectionClass: EvidenceCollectionClass): AdmittedEvidenceEvent {
  return {
    event: {
      event_id: `9${String(index).padStart(7, "0")}-0000-4000-8000-000000000000`,
      event_type: "F00-EVT-001",
      schema_version: "2.0.0",
      occurred_at: "2026-10-05T00:00:00.000Z",
      function_id: "F00"
    },
    collectionClass,
    serialized: "{}",
    bytes: SYNTHETIC_EVENT_BYTES
  };
}

function fill(queue: EvidenceClientQueue, collectionClass: EvidenceCollectionClass, from: number, count: number): void {
  for (let index = from; index < from + count; index += 1) {
    expect(queue.enqueue(syntheticEvent(index, collectionClass))).toBe("QUEUED");
  }
}

function uuidSequence(prefix: string): () => string {
  let index = 0;
  return () => {
    index += 1;
    return `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`;
  };
}

function createServer(clock: ManualClock) {
  const database = new FakeEvidenceRetentionPostgres();
  const failures: unknown[] = [];
  const diagnostics = {
    reportNonBlockingFailure: (error: unknown) => { failures.push(error); },
    reportMaintenanceFailure: (failure: EvidenceRetentionFailure) => { failures.push(failure); }
  };
  const runtime = { executor: database, diagnostics, now: () => new Date(clock.current), randomUUID: uuidSequence("99999999") };
  const handler = createProductionEventsBatchHandler(runtime);
  const post = (body: unknown) => handler({ body: typeof body === "string" ? body : JSON.stringify(body) });
  const maintenance = () => createProductionEvidenceRetentionMaintenance(runtime);
  return { database, failures, handler, post, maintenance };
}

// Browser fetch wired to the production handler; "network" attempts never reach the server.
function serverFetch(
  handler: (request: EventsBatchHttpRequest) => Promise<EventsBatchHttpResponse>,
  script: readonly ("network" | "server")[] = []
) {
  const remaining = [...script];
  const bodies: SentBatch[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = String(init?.body);
    bodies.push(JSON.parse(body) as SentBatch);
    if ((remaining.shift() ?? "server") === "network") {
      throw new TypeError("Failed to fetch");
    }
    const response = await handler({ body });
    return new Response(JSON.stringify(response.body), { status: response.status });
  };
  return { fetchImpl, bodies };
}

const ZERO_COUNTS = {
  batch_accepted: false,
  event_received_count: 0,
  accepted_count: 0,
  duplicate_count: 0,
  rejected_count: 0,
  unknown_event_type_count: 0
};

async function proveRouteRejectionsRecordedBeforePreServiceReturn(): Promise<void> {
  const server = createServer(new ManualClock(QUEUE_T0));
  const cases: readonly (readonly [string | Uint8Array, string])[] = [
    [new Uint8Array(256 * 1024 + 1).fill(32), "API-REQUEST-TOO-LARGE"],
    ["not json", "F07-ERR-003"],
    [JSON.stringify({ batch_id: BATCH_ID, events: [] }), "F07-ERR-003"],
    [JSON.stringify({
      batch_id: BATCH_ID,
      events: [coreOutcomeEvent(1)],
      quality_report: { report_id: REPORT_ID, local_queue_drop_count: 0, offline_expired_event_count: 0 }
    }), "F07-ERR-003"],
    [JSON.stringify({
      batch_id: BATCH_ID,
      events: [coreOutcomeEvent(1)],
      quality_report: { report_id: REPORT_ID, local_queue_drop_count: 1, offline_expired_event_count: 0, anonymous_id: ANONYMOUS_ID }
    }), "F07-ERR-003"],
    [JSON.stringify({ batch_id: BATCH_ID, events: Array.from({ length: 51 }, (_, index) => coreOutcomeEvent(index)) }), "F07-ERR-007"]
  ];
  server.database.failNext = POSTGRES_INSERT_INTAKE_OBSERVATION_SQL;
  for (const [body, code] of cases) {
    expect(await server.handler({ body })).toMatchObject({ status: 400, body: { error: { code, retryable: false } } });
  }
  expect([...server.database.intakeObservations.values()]).toEqual(cases.map(([, code]) => ({
    observation_id: expect.any(String),
    received_at: new Date(QUEUE_T0).toISOString(),
    ...ZERO_COUNTS,
    route_rejection_code: code
  })));
  expect(server.database.executed(POSTGRES_INSERT_INTAKE_OBSERVATION_SQL)).toBe(cases.length + 1);
  expect(server.database.events.size).toBe(0);
  expect(server.database.identities.size).toBe(0);
  expect(server.database.clientQualityReports.size).toBe(0);
  expect(server.failures).toEqual([]);
}

async function proveEventLevelObservation(): Promise<void> {
  const server = createServer(new ManualClock(Date.parse("2026-10-05T00:00:00.000Z")));
  const valid = { ...coreOutcomeEvent(1), anonymous_id: ANONYMOUS_ID };
  const response = await server.post({
    batch_id: BATCH_ID,
    events: [
      valid,
      { ...coreOutcomeEvent(2), occurred_at: "2026-10-05T00:11:00.000Z" },
      { ...coreOutcomeEvent(3), event_type: "F00-EVT-999" },
      { ...coreOutcomeEvent(4), properties: { surface: "CREATE", raw_intent: "secret prompt" } },
      valid
    ]
  });

  expect(response).toMatchObject({ status: 200, body: { data: { accepted: 2, duplicates: 1, rejected: 2 } } });
  expect([...server.database.intakeObservations.values()]).toEqual([{
    observation_id: expect.any(String),
    received_at: "2026-10-05T00:00:00.000Z",
    batch_accepted: true,
    event_received_count: 5,
    accepted_count: 2,
    duplicate_count: 1,
    rejected_count: 2,
    unknown_event_type_count: 1,
    route_rejection_code: null
  }]);
  const persisted = JSON.stringify([...server.database.intakeObservations.values()]);
  for (const value of [BATCH_ID, ANONYMOUS_ID, valid.event_id, "capsule-1", "secret prompt", "F00-EVT-999"]) {
    expect(persisted).not.toContain(value);
  }
}

// report_id is the idempotency key: the first durable receipt wins, a duplicate never double counts
// or rewrites received_at, and an undurable report is never confirmed with 2xx.
async function proveServerQualityReportIdempotence(): Promise<void> {
  const clock = new ManualClock(QUEUE_T0);
  const server = createServer(clock);
  const report = { report_id: REPORT_ID, local_queue_drop_count: 2, offline_expired_event_count: 1 };

  expect(await server.post({ batch_id: BATCH_ID, events: [], quality_report: report })).toMatchObject({
    status: 200,
    body: { data: { accepted: 0, duplicates: 0, rejected: 0, rejections: [], diagnostics: [] } }
  });
  clock.set(QUEUE_T0 + 60 * MINUTE_MS);
  expect(await server.post({ batch_id: BATCH_ID, events: [coreOutcomeEvent(1)], quality_report: report })).toMatchObject({
    status: 200,
    body: { data: { accepted: 1 } }
  });
  expect(await server.post({
    batch_id: BATCH_ID,
    events: [],
    quality_report: { ...report, local_queue_drop_count: 9 }
  })).toMatchObject({ status: 200 });
  expect([...server.database.clientQualityReports.values()]).toEqual([
    { ...report, received_at: new Date(QUEUE_T0).toISOString() }
  ]);

  const second = { report_id: SECOND_REPORT_ID, local_queue_drop_count: 0, offline_expired_event_count: 4 };
  server.database.failNext = POSTGRES_INSERT_CLIENT_QUALITY_REPORT_SQL;
  expect(await server.post({ batch_id: BATCH_ID, events: [], quality_report: second })).toMatchObject({
    status: 503,
    body: { error: { code: "F07-ERR-010", retryable: true } }
  });
  expect(server.database.clientQualityReports.has(SECOND_REPORT_ID)).toBe(false);
  expect([...server.database.intakeObservations.values()].at(-1)).toMatchObject({ ...ZERO_COUNTS, route_rejection_code: null });
  expect(await server.post({ batch_id: BATCH_ID, events: [], quality_report: second })).toMatchObject({ status: 200 });
  expect(server.database.clientQualityReports.get(SECOND_REPORT_ID)).toEqual({
    ...second,
    received_at: new Date(QUEUE_T0 + 60 * MINUTE_MS).toISOString()
  });

  expect([...server.database.events.values()].map(event => event.event_type)).toEqual(["F00-EVT-003"]);
  expect([...server.database.intakeObservations.values()].map(row => row.batch_accepted)).toEqual([true, true, true, false, true]);
  expect(server.failures).toEqual([new Error("simulated database failure")]);
}

function sumAggregate(server: ReturnType<typeof createServer>, metricKey: string): number {
  return server.database.aggregateRows()
    .filter(row => row.metric_key === metricKey)
    .reduce((sum, row) => sum + row.numerator_count, 0);
}

// Browser production default (no injected observer): queue drops become a sealed quality_report that
// is retried with the same report_id, survives a sendBeacon handoff, is deduped by the server and
// cleared only by a 2xx acknowledge.
async function proveBrowserQualityReportRoundTrip(): Promise<void> {
  const clock = new ManualClock(QUEUE_T0);
  const server = createServer(clock);
  const network = serverFetch(server.handler, ["network", "server", "network"]);
  const recording = createRecordingNavigator();
  const collector = createBrowserEvidenceCollector({
    fetch: network.fetchImpl,
    queueStore: null,
    beaconTransport: createBrowserEvidenceBeaconTransport(recording.navigator),
    scheduler: new ManualScheduler(),
    now: clock.now,
    jitter: () => 0.5,
    sleep: async () => undefined,
    randomUUID: uuidSequence("cccccccc")
  });
  await collector.settled();

  collector.emit(productSampleEvent(1));
  clock.set(QUEUE_T0 + EVIDENCE_QUEUE_LIMITS.ttlMs + 1);
  server.database.failNext = POSTGRES_INSERT_CLIENT_QUALITY_REPORT_SQL;
  await collector.flush();
  const sealed = network.bodies[0]?.quality_report;
  expect(sealed).toEqual({ report_id: expect.any(String), local_queue_drop_count: 0, offline_expired_event_count: 1 });
  expect(network.bodies).toEqual([0, 1, 2].map(() => ({ batch_id: network.bodies[0]?.batch_id, events: [], quality_report: sealed })));
  expect(server.database.clientQualityReports.size).toBe(0);

  collector.flushOnPageHide();
  expect(recording.beacons).toHaveLength(1);
  const beaconBody = await recording.beacons[0]?.body ?? "";
  expect(JSON.parse(beaconBody)).toMatchObject({ events: [], quality_report: sealed });
  clock.set(clock.current + MINUTE_MS);
  const beaconReceivedAt = new Date(clock.current).toISOString();
  expect(await server.handler({ body: beaconBody })).toMatchObject({ status: 200 });

  clock.set(clock.current + MINUTE_MS);
  await collector.flush();
  expect(network.bodies).toHaveLength(4);
  expect(network.bodies[3]?.quality_report).toEqual(sealed);
  expect([...server.database.clientQualityReports.values()]).toEqual([{ ...sealed, received_at: beaconReceivedAt }]);
  await collector.flush();
  expect(network.bodies).toHaveLength(4);

  collector.emit(productSampleEvent(2));
  clock.set(clock.current + EVIDENCE_QUEUE_LIMITS.ttlMs + 1);
  collector.emit(coreOutcomeEvent(1));
  await collector.flush();
  const piggyback = network.bodies[4];
  expect(piggyback?.events.map(event => event.event_id)).toEqual([coreOutcomeEvent(1).event_id]);
  expect(piggyback?.quality_report).toEqual({ report_id: expect.any(String), local_queue_drop_count: 0, offline_expired_event_count: 1 });
  expect(piggyback?.quality_report?.report_id).not.toBe(sealed?.report_id);

  for (let index = 100; index < 100 + EVIDENCE_QUEUE_LIMITS.maxEvents; index += 1) {
    collector.emit(productSampleEvent(index));
  }
  collector.emit(coreOutcomeEvent(2));
  await drain();
  await collector.flush();
  expect(collector.queuedCount()).toBe(0);
  const overflowReports = network.bodies.slice(5).flatMap(body => body.quality_report === undefined ? [] : [body.quality_report]);
  expect(overflowReports).toEqual([{ report_id: expect.any(String), local_queue_drop_count: 1, offline_expired_event_count: 0 }]);
  expect(server.database.clientQualityReports.size).toBe(3);
  expect(server.database.events.size).toBe(EVIDENCE_QUEUE_LIMITS.maxEvents + 1);

  clock.set(clock.current + RETENTION_MS + 1);
  expect(await server.maintenance().run()).toMatchObject({ status: "COMPLETED" });
  expect(sumAggregate(server, "local_queue_drop_count")).toBe(1);
  expect(sumAggregate(server, "offline_expired_event_count")).toBe(2);
  expect(server.failures).toEqual([new Error("simulated database failure")]);
}

// The default browser queue store reports durable drops to the collector's own quality ledger.
async function proveDefaultDurableStoreFeedsQualityReport(): Promise<void> {
  const factory = new FakeIndexedDbFactory();
  await persistQueuedEvent(factory, coreOutcomeEvent(5), QUEUE_T0);
  vi.stubGlobal("indexedDB", factory);
  const clock = new ManualClock(QUEUE_T0 + EVIDENCE_QUEUE_LIMITS.ttlMs + 1);
  const server = createServer(clock);
  const network = serverFetch(server.handler);
  const collector = createBrowserEvidenceCollector({
    fetch: network.fetchImpl,
    beaconTransport: createBrowserEvidenceBeaconTransport({}),
    scheduler: new ManualScheduler(),
    now: clock.now,
    jitter: () => 0.5,
    sleep: async () => undefined,
    randomUUID: uuidSequence("dddddddd")
  });
  await collector.settled();
  await drain();
  await collector.flush();
  expect(durableQueueIds(factory)).toEqual([]);
  expect(network.bodies).toEqual([{
    batch_id: expect.any(String),
    events: [],
    quality_report: { report_id: expect.any(String), local_queue_drop_count: 0, offline_expired_event_count: 1 }
  }]);
  expect(server.database.clientQualityReports.size).toBe(1);
}

function proveMemoryQueueDropAndExpiryObservation(): void {
  const clock = new ManualClock(QUEUE_T0);
  const observer = new RecordingDrops();
  const queue = new EvidenceClientQueue(null, clock.now, observer);
  fill(queue, "PRODUCT_SAMPLE", 0, RECORDS_AT_BYTE_BOUND);
  expect(queue.enqueue(syntheticEvent(1000, "CORE_OUTCOME"))).toBe("QUEUED");
  expect(observer.drops).toEqual([{ code: "F07-ERR-011", collection_class: "PRODUCT_SAMPLE" }]);

  const full = new EvidenceClientQueue(null, clock.now, observer);
  fill(full, "RELIABILITY", 2000, RECORDS_AT_BYTE_BOUND);
  expect(full.enqueue(syntheticEvent(3000, "PRODUCT_SAMPLE"))).toBe("QUEUE_FULL");
  expect(observer.count("F07-ERR-011", "PRODUCT_SAMPLE")).toBe(2);

  clock.set(QUEUE_T0 + EVIDENCE_QUEUE_LIMITS.ttlMs + 1);
  expect(queue.nextBatch()).toEqual([]);
  expect(full.nextBatch()).toEqual([]);
  expect(observer.count("F07-ERR-012")).toBe(RECORDS_AT_BYTE_BOUND * 2);
  expect(observer.count("F07-ERR-012", "CORE_OUTCOME")).toBe(1);
  expect(observer.drops.every(drop => Object.keys(drop).sort().join() === "code,collection_class")).toBe(true);
}

async function proveSharedQueueObservedExactlyOnce(): Promise<void> {
  const factory = new FakeIndexedDbFactory();
  const clock = new ManualClock(QUEUE_T0);
  const observer = new RecordingDrops();
  const tab = () => new EvidenceClientQueue(createIndexedDbEvidenceQueueStore(factory, observer), clock.now, observer);
  const first = tab();
  const second = tab();

  fill(first, "PRODUCT_SAMPLE", 0, RECORDS_AT_BYTE_BOUND);
  await first.settled();
  expect(second.enqueue(syntheticEvent(500, "CORE_OUTCOME"))).toBe("QUEUED");
  await second.settled();
  await first.sendable(first.batches().flat());
  await first.settled();
  expect(durableQueueIds(factory)).toHaveLength(RECORDS_AT_BYTE_BOUND);
  expect(observer.drops).toEqual([{ code: "F07-ERR-011", collection_class: "PRODUCT_SAMPLE" }]);

  clock.set(QUEUE_T0 + EVIDENCE_QUEUE_LIMITS.ttlMs + 1);
  expect(first.nextBatch()).toEqual([]);
  expect(second.nextBatch()).toEqual([]);
  await first.settled();
  await second.settled();
  await drain();
  expect(durableQueueIds(factory)).toEqual([]);
  expect(observer.count("F07-ERR-012")).toBe(RECORDS_AT_BYTE_BOUND);
  expect(observer.count("F07-ERR-012", "CORE_OUTCOME")).toBe(1);
  expect(observer.count("F07-ERR-011")).toBe(1);
}

async function proveCollectorObserverWiring(): Promise<void> {
  const observer = new RecordingDrops();
  const collector = createBrowserEvidenceCollector({
    fetch: hangingFetch(),
    queueStore: null,
    beaconTransport: createBrowserEvidenceBeaconTransport({}),
    scheduler: new ManualScheduler(),
    now: () => QUEUE_T0,
    observer
  });
  for (let index = 1; index <= EVIDENCE_QUEUE_LIMITS.maxEvents; index += 1) {
    collector.emit(productSampleEvent(index));
  }
  collector.emit(coreOutcomeEvent(1));
  await drain();
  expect(collector.queuedCount()).toBe(EVIDENCE_QUEUE_LIMITS.maxEvents);
  expect(observer.drops).toEqual([{ code: "F07-ERR-011", collection_class: "PRODUCT_SAMPLE" }]);
}

describe("F07 evidence pipeline observability", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("TEST-F07-AC-028 evidence rejection, local queue drop and queue expiry are each observable", async () => {
    await proveRouteRejectionsRecordedBeforePreServiceReturn();
    await proveEventLevelObservation();
    await proveServerQualityReportIdempotence();
    await proveBrowserQualityReportRoundTrip();
    await proveDefaultDurableStoreFeedsQualityReport();
    proveMemoryQueueDropAndExpiryObservation();
    await proveSharedQueueObservedExactlyOnce();
    await proveCollectorObserverWiring();
  });

  test("a throwing queue observer never changes queue admission", () => {
    const queue = new EvidenceClientQueue(null, () => QUEUE_T0, {
      observeQueueDrop: () => { throw new Error("observer fault"); }
    });
    fill(queue, "PRODUCT_SAMPLE", 0, RECORDS_AT_BYTE_BOUND);
    expect(queue.enqueue(syntheticEvent(9000, "CORE_OUTCOME"))).toBe("QUEUED");
    expect(queue.size()).toBe(RECORDS_AT_BYTE_BOUND);
  });
});
