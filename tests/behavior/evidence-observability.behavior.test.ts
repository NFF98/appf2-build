import { describe, expect, test } from "vitest";

import { createBrowserEvidenceBeaconTransport } from "../../src/platform/evidence/evidence-batch-transport.js";
import {
  EVIDENCE_QUEUE_LIMITS,
  EvidenceClientQueue,
  type AdmittedEvidenceEvent,
  type EvidenceCollectionClass
} from "../../src/platform/evidence/evidence-client-queue.js";
import { createBrowserEvidenceCollector } from "../../src/platform/evidence/evidence-collector.js";
import { EvidenceIngestionService } from "../../src/platform/evidence/evidence-ingestion-service.js";
import type {
  EvidenceIntakeObservation,
  EvidenceQueueDrop,
  EvidenceQueueObserver
} from "../../src/platform/evidence/evidence-observability.js";
import { createIndexedDbEvidenceQueueStore } from "../../src/platform/evidence/evidence-queue-store.js";
import type { EvidenceEventInput, EvidenceWriteResult } from "../../src/platform/evidence/evidence-types.js";
import { ManualScheduler } from "../unit/evidence-collector-test-support.js";
import { FakeIndexedDbFactory } from "../unit/evidence-fake-indexeddb.js";
import {
  coreOutcomeEvent,
  drain,
  durableQueueIds,
  hangingFetch,
  ManualClock,
  productSampleEvent,
  QUEUE_T0
} from "../unit/evidence-queue-test-support.js";

const SYNTHETIC_EVENT_BYTES = 8 * 1024;
const RECORDS_AT_BYTE_BOUND = EVIDENCE_QUEUE_LIMITS.maxBytes / SYNTHETIC_EVENT_BYTES;

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

async function proveServerRejectionObservation(): Promise<void> {
  const observations: EvidenceIntakeObservation[] = [];
  const stored = new Set<string>();
  const failures: unknown[] = [];
  const service = (observe: (observation: EvidenceIntakeObservation) => void) => new EvidenceIngestionService({
    anonymousIdentities: { ensure: async () => "ACTIVE", refreshLastSeen: async () => undefined },
    evidence: {
      insert: async (event: EvidenceEventInput): Promise<EvidenceWriteResult> => {
        if (stored.has(event.event_id)) {
          return "DUPLICATE";
        }
        stored.add(event.event_id);
        return "INSERTED";
      }
    },
    diagnostics: { reportNonBlockingFailure: error => { failures.push(error); } },
    now: () => new Date("2026-10-05T00:00:00.000Z"),
    observer: { observeIntake: observe }
  });
  const valid = coreOutcomeEvent(1);
  const batch = [
    valid,
    { ...coreOutcomeEvent(2), occurred_at: "2026-10-05T00:11:00.000Z" },
    { ...coreOutcomeEvent(3), event_type: "F00-EVT-999" },
    { ...coreOutcomeEvent(4), properties: { surface: "CREATE", raw_intent: "secret prompt" } },
    valid
  ];

  const result = await service(observation => { observations.push(observation); }).ingest(batch);

  expect(result).toMatchObject({ accepted: 2, duplicates: 1, rejected: 2 });
  expect(observations).toEqual([{
    received: 5,
    accepted: 2,
    duplicates: 1,
    rejected: 2,
    clock_invalid: 1,
    rejection_codes: { "F07-ERR-004": 1, "F07-ERR-005": 1 }
  }]);
  expect(JSON.stringify(observations)).not.toContain("secret prompt");

  const faulty = await service(() => { throw new Error("metrics sink offline"); }).ingest([coreOutcomeEvent(5)]);
  expect(faulty).toMatchObject({ accepted: 1, rejected: 0 });
  expect(failures).toEqual([new Error("metrics sink offline")]);
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
  test("TEST-F07-AC-028 evidence rejection, local queue drop and queue expiry are each observable", async () => {
    await proveServerRejectionObservation();
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
