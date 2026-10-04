import { describe, expect, test } from "vitest";

import {
  EVIDENCE_QUEUE_LIMITS,
  EvidenceClientQueue,
  type AdmittedEvidenceEvent,
  type EvidenceCollectionClass
} from "../../src/platform/evidence/evidence-client-queue.js";
import {
  createWebStorageEvidenceQueueStore,
  type EvidenceQueueEntry
} from "../../src/platform/evidence/evidence-queue-store.js";
import { createScriptedFetch } from "../unit/evidence-collector-test-support.js";
import {
  coreOutcomeEvent,
  createDurableTestCollector,
  eventIds,
  hangingFetch,
  HOUR_MS,
  ManualClock,
  MemoryWebStorage,
  offlineFetch,
  persistQueuedEvent,
  productSampleEvent,
  QUEUE_T0,
  reliabilityEvent,
  settle
} from "../unit/evidence-queue-test-support.js";

const SYNTHETIC_EVENT_BYTES = 8 * 1024;

function durableEntries(storage: MemoryWebStorage): readonly EvidenceQueueEntry[] {
  return createWebStorageEvidenceQueueStore(storage).entries();
}

function expectDurableWithinBounds(storage: MemoryWebStorage): void {
  const entries = durableEntries(storage);
  expect(entries.length).toBeLessThanOrEqual(EVIDENCE_QUEUE_LIMITS.maxEvents);
  expect(entries.reduce((sum, entry) => sum + entry.bytes, 0))
    .toBeLessThanOrEqual(EVIDENCE_QUEUE_LIMITS.maxBytes);
}

function syntheticEvent(id: string, collectionClass: EvidenceCollectionClass): AdmittedEvidenceEvent {
  return {
    event: {
      event_id: id,
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

describe("Durable evidence queue regressions", () => {
  test("delivery removes only delivered records when overflow evicts during an in-flight flush", async () => {
    let release: (() => void) | undefined;
    const hold = new Promise<void>(resolve => {
      release = resolve;
    });
    const fetch = createScriptedFetch([200, 200, 200, 200, 200]);
    const holdingFetch: typeof globalThis.fetch = async (input, init) => {
      await hold;
      return fetch.fetchImpl(input, init);
    };
    const storage = new MemoryWebStorage();
    const collector = createDurableTestCollector({
      fetch: holdingFetch,
      storage,
      clock: new ManualClock(QUEUE_T0)
    });
    const samples = Array.from({ length: 200 }, (_, index) => productSampleEvent(index + 1));
    samples.forEach(event => collector.emit(event));
    const inFlight = collector.flush();
    await settle();
    expect(fetch.requests).toHaveLength(0);
    expect(collector.queuedCount()).toBe(200);

    const outcomes = Array.from({ length: 10 }, (_, index) => coreOutcomeEvent(index + 1));
    outcomes.forEach(event => collector.emit(event));
    release?.();
    await inFlight;
    await collector.flush();

    const delivered = fetch.requests.flatMap(request => eventIds(request.events));
    expect(delivered.slice(0, 50)).toEqual(eventIds(samples.slice(0, 50)));
    expect(delivered.slice(50)).toEqual(eventIds([...samples.slice(50), ...outcomes]));
    expect(collector.queuedCount()).toBe(0);
    expect(storage.queuedEventIds()).toEqual([]);
  });

  test("tampered or mismatched persisted records are never restored or sent", async () => {
    const storage = new MemoryWebStorage();
    const valid = coreOutcomeEvent(1);
    persistQueuedEvent(storage, valid, QUEUE_T0);
    const tampered = { ...coreOutcomeEvent(2), properties: { raw_intent: "my salary is 100k" } };
    persistQueuedEvent(storage, tampered, QUEUE_T0);
    const mismatched = coreOutcomeEvent(3);
    persistQueuedEvent(storage, mismatched, QUEUE_T0, { eventId: coreOutcomeEvent(4).event_id });
    persistQueuedEvent(storage, coreOutcomeEvent(5), QUEUE_T0, { collectionClass: "PRODUCT_SAMPLE" });
    persistQueuedEvent(storage, coreOutcomeEvent(6), QUEUE_T0, { bytes: 1 });

    const fetch = createScriptedFetch([200]);
    const collector = createDurableTestCollector({
      fetch: fetch.fetchImpl,
      storage,
      clock: new ManualClock(QUEUE_T0 + 1000)
    });

    expect(eventIds(collector.queuedEvents())).toEqual([valid.event_id]);
    expect(storage.queuedEventIds()).toEqual([valid.event_id]);
    await collector.flush();
    expect(fetch.requests.flatMap(request => eventIds(request.events))).toEqual([valid.event_id]);
  });

  test("restore keeps enqueue order and re-applies the priority bound to oversized persisted queues", async () => {
    const storage = new MemoryWebStorage();
    const samples = Array.from({ length: 100 }, (_, index) => productSampleEvent(index + 1));
    const outcomes = Array.from({ length: 120 }, (_, index) => coreOutcomeEvent(index + 1));
    const failures = Array.from({ length: 30 }, (_, index) => reliabilityEvent(index + 1));
    const ordered = [...samples, ...outcomes, ...failures];
    [...ordered].reverse().forEach(event => {
      persistQueuedEvent(storage, event, QUEUE_T0 + ordered.indexOf(event));
    });

    const collector = createDurableTestCollector({
      fetch: offlineFetch(),
      storage,
      clock: new ManualClock(QUEUE_T0 + 60_000)
    });

    const restored = eventIds(collector.queuedEvents());
    const expected = eventIds([...samples.slice(50), ...outcomes, ...failures]);
    expect(restored).toEqual(expected);
    expect(storage.queuedEventIds()).toEqual([...expected].sort());
  });
});

describe("Durable evidence queue TTL during retry backoff", () => {
  function clockAdvancingSleep(clock: ManualClock, sleepLog: number[]) {
    return async (ms: number): Promise<void> => {
      sleepLog.push(ms);
      clock.set(clock.current + ms);
    };
  }

  test("a retry whose backoff crosses the 24h TTL never transmits the expired record", async () => {
    const storage = new MemoryWebStorage();
    const clock = new ManualClock(QUEUE_T0);
    const sleepLog: number[] = [];
    const fetch = createScriptedFetch([503, 503, 503, 200]);
    const collector = createDurableTestCollector({
      fetch: fetch.fetchImpl,
      storage,
      clock,
      sleep: clockAdvancingSleep(clock, sleepLog)
    });
    const expiring = coreOutcomeEvent(1);
    const live = reliabilityEvent(1);
    collector.emit(expiring);
    clock.set(QUEUE_T0 + HOUR_MS);
    collector.emit(live);

    clock.set(QUEUE_T0 + EVIDENCE_QUEUE_LIMITS.ttlMs - 500);
    await collector.flush();

    expect(sleepLog).toEqual([1000, 5000]);
    expect(fetch.requests.map(request => eventIds(request.events))).toEqual([
      [expiring.event_id, live.event_id],
      [live.event_id],
      [live.event_id]
    ]);
    expect(new Set(fetch.requests.map(request => request.batch_id)).size).toBe(1);
    expect(eventIds(collector.queuedEvents())).toEqual([live.event_id]);
    expect(storage.queuedEventIds()).toEqual([live.event_id]);

    await collector.flush();

    expect(fetch.requests).toHaveLength(4);
    expect(fetch.requests[3]?.batch_id).not.toBe(fetch.requests[0]?.batch_id);
    expect(eventIds(fetch.requests[3]?.events ?? [])).toEqual([live.event_id]);
    expect(collector.queuedCount()).toBe(0);
    expect(storage.queuedEventIds()).toEqual([]);
  });

  test("a batch that fully expires during backoff stops retrying and leaves no durable record", async () => {
    const storage = new MemoryWebStorage();
    const clock = new ManualClock(QUEUE_T0);
    const sleepLog: number[] = [];
    const fetch = createScriptedFetch([503, 200]);
    const collector = createDurableTestCollector({
      fetch: fetch.fetchImpl,
      storage,
      clock,
      sleep: clockAdvancingSleep(clock, sleepLog)
    });
    collector.emit(coreOutcomeEvent(1));

    clock.set(QUEUE_T0 + EVIDENCE_QUEUE_LIMITS.ttlMs - 500);
    await collector.flush();

    expect(sleepLog).toEqual([1000]);
    expect(fetch.requests).toHaveLength(1);
    expect(collector.queuedCount()).toBe(0);
    expect(storage.queuedEventIds()).toEqual([]);
  });
});

describe("Durable evidence queue bounds shared across collectors on one origin storage", () => {
  test("two collectors constructed before either writes keep the shared durable queue bounded and retain CORE_OUTCOME / RELIABILITY", () => {
    const storage = new MemoryWebStorage();
    const clock = new ManualClock(QUEUE_T0);
    const firstTab = createDurableTestCollector({ fetch: hangingFetch(), storage, clock });
    const secondTab = createDurableTestCollector({ fetch: hangingFetch(), storage, clock });
    const outcomes = Array.from({ length: 120 }, (_, index) => coreOutcomeEvent(index + 1));
    const failures = Array.from({ length: 80 }, (_, index) => reliabilityEvent(index + 1));

    for (let index = 1; index <= 150; index += 1) {
      firstTab.emit(productSampleEvent(index));
    }
    clock.set(QUEUE_T0 + 1000);
    for (let index = 151; index <= 300; index += 1) {
      secondTab.emit(productSampleEvent(index));
    }
    expect(storage.queuedEventIds()).toHaveLength(EVIDENCE_QUEUE_LIMITS.maxEvents);
    expectDurableWithinBounds(storage);

    clock.set(QUEUE_T0 + 2000);
    outcomes.forEach(event => {
      firstTab.emit(event);
      expectDurableWithinBounds(storage);
    });
    failures.forEach(event => {
      secondTab.emit(event);
      expectDurableWithinBounds(storage);
    });
    const retained = eventIds([...outcomes, ...failures]).sort();
    expect(storage.queuedEventIds()).toEqual(retained);
    expect(eventIds(firstTab.queuedEvents())).toEqual(eventIds(outcomes));
    expect(eventIds(secondTab.queuedEvents())).toEqual(eventIds(failures));

    secondTab.emit(productSampleEvent(301));
    firstTab.emit(productSampleEvent(302));
    expect(storage.queuedEventIds()).toEqual(retained);
    expect(eventIds(firstTab.queuedEvents())).toEqual(eventIds(outcomes));
    expect(eventIds(secondTab.queuedEvents())).toEqual(eventIds(failures));
  });

  test("two queues sharing one durable store keep the combined 1 MiB bound and drop DEBUG_ONLY / PRODUCT_SAMPLE first", () => {
    const storage = new MemoryWebStorage();
    const clock = new ManualClock(QUEUE_T0);
    const firstQueue = new EvidenceClientQueue(createWebStorageEvidenceQueueStore(storage), clock.now);
    const secondQueue = new EvidenceClientQueue(createWebStorageEvidenceQueueStore(storage), clock.now);
    const fullQueueEvents = EVIDENCE_QUEUE_LIMITS.maxBytes / SYNTHETIC_EVENT_BYTES;

    for (let index = 1; index <= fullQueueEvents / 2; index += 1) {
      expect(firstQueue.enqueue(syntheticEvent(`sample-${index}`, "PRODUCT_SAMPLE"))).toBe("QUEUED");
      expect(secondQueue.enqueue(syntheticEvent(`debug-${index}`, "DEBUG_ONLY"))).toBe("QUEUED");
    }
    expect(durableEntries(storage)).toHaveLength(fullQueueEvents);
    expectDurableWithinBounds(storage);

    clock.set(QUEUE_T0 + 1000);
    const cores = Array.from({ length: fullQueueEvents }, (_, index) => `core-${index + 1}`);
    cores.forEach(id => {
      expect(secondQueue.enqueue(syntheticEvent(id, "CORE_OUTCOME"))).toBe("QUEUED");
      expectDurableWithinBounds(storage);
    });
    expect(storage.queuedEventIds()).toEqual([...cores].sort());

    expect(firstQueue.enqueue(syntheticEvent("sample-overflow", "PRODUCT_SAMPLE"))).toBe("QUEUE_FULL");
    expect(secondQueue.enqueue(syntheticEvent("debug-overflow", "DEBUG_ONLY"))).toBe("QUEUE_FULL");
    expect(storage.queuedEventIds()).toEqual([...cores].sort());

    clock.set(QUEUE_T0 + 2000);
    expect(firstQueue.enqueue(syntheticEvent("reliability-1", "RELIABILITY"))).toBe("QUEUED");
    expectDurableWithinBounds(storage);
    expect(storage.queuedEventIds()).toEqual([...cores.slice(1), "reliability-1"].sort());
  });
});
