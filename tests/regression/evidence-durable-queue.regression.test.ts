import { describe, expect, test } from "vitest";

import {
  admitEvidenceEvent,
  EVIDENCE_QUEUE_LIMITS,
  EvidenceClientQueue,
  type AdmittedEvidenceEvent,
  type EvidenceCollectionClass
} from "../../src/platform/evidence/evidence-client-queue.js";
import {
  createIndexedDbEvidenceQueueStore,
  EVIDENCE_QUEUE_DATABASE,
  type EvidenceIdbDatabase
} from "../../src/platform/evidence/evidence-queue-store.js";
import type { EvidenceEventInput } from "../../src/platform/evidence/evidence-types.js";
import { createScriptedFetch } from "../unit/evidence-collector-test-support.js";
import { FakeIndexedDbFactory } from "../unit/evidence-fake-indexeddb.js";
import {
  beaconedEventIds,
  coreOutcomeEvent,
  createDurableTestCollector,
  createRecordingNavigator,
  drain,
  durableEntries,
  durablePayload,
  durableQueueIds,
  eventIds,
  hangingFetch,
  HOUR_MS,
  ManualClock,
  offlineFetch,
  persistQueuedEvent,
  productSampleEvent,
  QUEUE_T0,
  reliabilityEvent,
  trackDurablePeak
} from "../unit/evidence-queue-test-support.js";

const SYNTHETIC_EVENT_BYTES = 8 * 1024;
const TTL_MS = EVIDENCE_QUEUE_LIMITS.ttlMs;

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

function admitted(input: EvidenceEventInput): AdmittedEvidenceEvent {
  const result = admitEvidenceEvent(input);
  if (result === null) {
    throw new Error("Fixture event was not admitted.");
  }
  return result;
}

function tabQueue(factory: FakeIndexedDbFactory, clock: ManualClock): EvidenceClientQueue {
  return new EvidenceClientQueue(createIndexedDbEvidenceQueueStore(factory), clock.now);
}

function durableBytes(factory: FakeIndexedDbFactory): number {
  return durableEntries(factory).reduce((sum, entry) => sum + entry.bytes, 0);
}

function resetTransactionPeak(factory: FakeIndexedDbFactory): void {
  factory.database(EVIDENCE_QUEUE_DATABASE.name).peakOpenTransactions = 0;
}

function transactionPeak(factory: FakeIndexedDbFactory): number {
  return factory.database(EVIDENCE_QUEUE_DATABASE.name).peakOpenTransactions;
}

function requireObject(value: unknown): object {
  if (typeof value !== "object" || value === null) {
    throw new Error("Expected an object.");
  }
  return value;
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
    const factory = new FakeIndexedDbFactory();
    const collector = createDurableTestCollector({
      fetch: holdingFetch,
      factory,
      clock: new ManualClock(QUEUE_T0)
    });
    const samples = Array.from({ length: 200 }, (_, index) => productSampleEvent(index + 1));
    samples.forEach(event => collector.emit(event));
    const inFlight = collector.flush();
    await drain();
    expect(fetch.requests).toHaveLength(0);
    expect(collector.queuedCount()).toBe(200);

    const outcomes = Array.from({ length: 10 }, (_, index) => coreOutcomeEvent(index + 1));
    outcomes.forEach(event => collector.emit(event));
    release?.();
    await inFlight;
    await collector.flush();
    await collector.settled();

    const delivered = fetch.requests.flatMap(request => eventIds(request.events));
    expect(delivered.slice(0, 50)).toEqual(eventIds(samples.slice(0, 50)));
    expect(delivered.slice(50)).toEqual(eventIds([...samples.slice(50), ...outcomes]));
    expect(collector.queuedCount()).toBe(0);
    expect(durableQueueIds(factory)).toEqual([]);
  });

  test("tampered or mismatched persisted records are never restored or sent", async () => {
    const factory = new FakeIndexedDbFactory();
    const valid = coreOutcomeEvent(1);
    await persistQueuedEvent(factory, valid, QUEUE_T0);
    const tampered = { ...coreOutcomeEvent(2), properties: { raw_intent: "my salary is 100k" } };
    await persistQueuedEvent(factory, tampered, QUEUE_T0);
    const mismatched = coreOutcomeEvent(3);
    await persistQueuedEvent(factory, mismatched, QUEUE_T0, { eventId: coreOutcomeEvent(4).event_id });
    await persistQueuedEvent(factory, coreOutcomeEvent(5), QUEUE_T0, { collectionClass: "PRODUCT_SAMPLE" });
    await persistQueuedEvent(factory, coreOutcomeEvent(6), QUEUE_T0, { bytes: 1 });

    const fetch = createScriptedFetch([200]);
    const collector = createDurableTestCollector({
      fetch: fetch.fetchImpl,
      factory,
      clock: new ManualClock(QUEUE_T0 + 1000)
    });
    await collector.settled();

    expect(eventIds(collector.queuedEvents())).toEqual([valid.event_id]);
    expect(durableQueueIds(factory)).toEqual([valid.event_id]);
    await collector.flush();
    expect(fetch.requests.flatMap(request => eventIds(request.events))).toEqual([valid.event_id]);
  });

  test("restore keeps enqueue order and re-applies the priority bound to oversized persisted queues", async () => {
    const factory = new FakeIndexedDbFactory();
    const samples = Array.from({ length: 100 }, (_, index) => productSampleEvent(index + 1));
    const outcomes = Array.from({ length: 120 }, (_, index) => coreOutcomeEvent(index + 1));
    const failures = Array.from({ length: 30 }, (_, index) => reliabilityEvent(index + 1));
    const ordered = [...samples, ...outcomes, ...failures];
    for (const event of [...ordered].reverse()) {
      await persistQueuedEvent(factory, event, QUEUE_T0 + ordered.indexOf(event));
    }

    const collector = createDurableTestCollector({
      fetch: offlineFetch(),
      factory,
      clock: new ManualClock(QUEUE_T0 + 60_000)
    });
    await collector.settled();

    const restored = eventIds(collector.queuedEvents());
    const expected = eventIds([...samples.slice(50), ...outcomes, ...failures]);
    expect(restored).toEqual(expected);
    expect(durableQueueIds(factory)).toEqual([...expected].sort());
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
    const factory = new FakeIndexedDbFactory();
    const clock = new ManualClock(QUEUE_T0);
    const sleepLog: number[] = [];
    const fetch = createScriptedFetch([503, 503, 503, 200]);
    const collector = createDurableTestCollector({
      fetch: fetch.fetchImpl,
      factory,
      clock,
      sleep: clockAdvancingSleep(clock, sleepLog)
    });
    const expiring = coreOutcomeEvent(1);
    const live = reliabilityEvent(1);
    collector.emit(expiring);
    await collector.settled();
    clock.set(QUEUE_T0 + HOUR_MS);
    collector.emit(live);

    clock.set(QUEUE_T0 + TTL_MS - 500);
    await collector.flush();
    await collector.settled();

    expect(sleepLog).toEqual([1000, 5000]);
    expect(fetch.requests.map(request => eventIds(request.events))).toEqual([
      [expiring.event_id, live.event_id],
      [live.event_id],
      [live.event_id]
    ]);
    expect(new Set(fetch.requests.map(request => request.batch_id)).size).toBe(1);
    expect(eventIds(collector.queuedEvents())).toEqual([live.event_id]);
    expect(durableQueueIds(factory)).toEqual([live.event_id]);

    await collector.flush();
    await collector.settled();

    expect(fetch.requests).toHaveLength(4);
    expect(fetch.requests[3]?.batch_id).not.toBe(fetch.requests[0]?.batch_id);
    expect(eventIds(fetch.requests[3]?.events ?? [])).toEqual([live.event_id]);
    expect(collector.queuedCount()).toBe(0);
    expect(durableQueueIds(factory)).toEqual([]);
  });

  test("a batch that fully expires during backoff stops retrying and leaves no durable record", async () => {
    const factory = new FakeIndexedDbFactory();
    const clock = new ManualClock(QUEUE_T0);
    const sleepLog: number[] = [];
    const fetch = createScriptedFetch([503, 200]);
    const collector = createDurableTestCollector({
      fetch: fetch.fetchImpl,
      factory,
      clock,
      sleep: clockAdvancingSleep(clock, sleepLog)
    });
    collector.emit(coreOutcomeEvent(1));
    await collector.settled();

    clock.set(QUEUE_T0 + TTL_MS - 500);
    await collector.flush();
    await collector.settled();

    expect(sleepLog).toEqual([1000]);
    expect(fetch.requests).toHaveLength(1);
    expect(collector.queuedCount()).toBe(0);
    expect(durableQueueIds(factory)).toEqual([]);
  });
});

describe("Shared durable TTL is enforced independent of capacity pressure", () => {
  test("an expired entry written by another tab is purged when a fresh event is admitted far below the bounds", async () => {
    const factory = new FakeIndexedDbFactory();
    const clock = new ManualClock(QUEUE_T0);
    const tabAFetch = createScriptedFetch([200]);
    const tabA = createDurableTestCollector({ fetch: tabAFetch.fetchImpl, factory, clock });
    const tabB = createDurableTestCollector({ fetch: hangingFetch(), factory, clock });
    await Promise.all([tabA.settled(), tabB.settled()]);

    const stale = coreOutcomeEvent(1);
    tabA.emit(stale);
    await tabA.settled();
    expect(durableQueueIds(factory)).toEqual([stale.event_id]);

    clock.set(QUEUE_T0 + TTL_MS + 1);
    const fresh = reliabilityEvent(1);
    tabB.emit(fresh);
    await tabB.settled();

    expect(durableQueueIds(factory)).toEqual([fresh.event_id]);
    expect(durablePayload(factory, stale.event_id)).toBeUndefined();
    await tabA.flush();
    expect(tabAFetch.requests).toHaveLength(0);
    expect(tabA.queuedCount()).toBe(0);
  });

  test("an entry exactly 24h old is still live in the shared queue and expires one millisecond later", async () => {
    const factory = new FakeIndexedDbFactory();
    const clock = new ManualClock(QUEUE_T0);
    const tabA = createDurableTestCollector({ fetch: hangingFetch(), factory, clock });
    const tabB = createDurableTestCollector({ fetch: hangingFetch(), factory, clock });
    const boundary = coreOutcomeEvent(1);
    tabA.emit(boundary);
    await tabA.settled();

    clock.set(QUEUE_T0 + TTL_MS);
    tabB.emit(productSampleEvent(1));
    await tabB.settled();
    expect(durableQueueIds(factory)).toEqual([boundary.event_id, productSampleEvent(1).event_id].sort());

    clock.set(QUEUE_T0 + TTL_MS + 1);
    tabB.emit(productSampleEvent(2));
    await tabB.settled();
    expect(durableQueueIds(factory)).toEqual([productSampleEvent(1).event_id, productSampleEvent(2).event_id].sort());
  });
});

describe("Shared durable bound is atomic across concurrently admitting tabs", () => {
  test("two tabs admitting from the same 199-entry state never exceed 200 events and evict only PRODUCT_SAMPLE", async () => {
    const factory = new FakeIndexedDbFactory();
    const clock = new ManualClock(QUEUE_T0);
    const seededCores = Array.from({ length: 150 }, (_, index) => coreOutcomeEvent(index + 1));
    const seededSamples = Array.from({ length: 49 }, (_, index) => productSampleEvent(index + 1));
    let offset = 0;
    for (const event of [...seededSamples, ...seededCores]) {
      await persistQueuedEvent(factory, event, QUEUE_T0 + offset);
      offset += 1;
    }
    const tabA = tabQueue(factory, clock);
    const tabB = tabQueue(factory, clock);
    const peak = trackDurablePeak(factory);
    resetTransactionPeak(factory);

    clock.set(QUEUE_T0 + 10_000);
    expect(tabA.enqueue(admitted(coreOutcomeEvent(1001)))).toBe("QUEUED");
    expect(tabB.enqueue(admitted(coreOutcomeEvent(1002)))).toBe("QUEUED");
    await Promise.all([tabA.settled(), tabB.settled()]);

    expect(transactionPeak(factory)).toBeGreaterThanOrEqual(2);
    expect(peak.count).toBe(EVIDENCE_QUEUE_LIMITS.maxEvents);
    expect(durableQueueIds(factory)).toEqual(eventIds([
      ...seededSamples.slice(1),
      ...seededCores,
      coreOutcomeEvent(1001),
      coreOutcomeEvent(1002)
    ]).sort());
  });

  test("two tabs admitting from the same near-1 MiB state never exceed the byte bound", async () => {
    const factory = new FakeIndexedDbFactory();
    const clock = new ManualClock(QUEUE_T0);
    const nearFull = EVIDENCE_QUEUE_LIMITS.maxBytes / SYNTHETIC_EVENT_BYTES - 1;
    for (let index = 1; index <= nearFull; index += 1) {
      await persistQueuedEvent(factory, productSampleEvent(index), QUEUE_T0 + index, {
        bytes: SYNTHETIC_EVENT_BYTES
      });
    }
    expect(durableBytes(factory)).toBe(EVIDENCE_QUEUE_LIMITS.maxBytes - SYNTHETIC_EVENT_BYTES);
    const tabA = tabQueue(factory, clock);
    const tabB = tabQueue(factory, clock);
    const peak = trackDurablePeak(factory);
    resetTransactionPeak(factory);

    clock.set(QUEUE_T0 + 10_000);
    tabA.enqueue(syntheticEvent("core-a", "CORE_OUTCOME"));
    tabB.enqueue(syntheticEvent("core-b", "RELIABILITY"));
    await Promise.all([tabA.settled(), tabB.settled()]);

    expect(transactionPeak(factory)).toBeGreaterThanOrEqual(2);
    expect(peak.bytes).toBe(EVIDENCE_QUEUE_LIMITS.maxBytes);
    expect(durableBytes(factory)).toBe(EVIDENCE_QUEUE_LIMITS.maxBytes);
    expect(durableQueueIds(factory)).toContain("core-a");
    expect(durableQueueIds(factory)).toContain("core-b");
    expect(durableQueueIds(factory)).not.toContain(productSampleEvent(1).event_id);
  });

  test("a concurrent PRODUCT_SAMPLE cannot displace CORE_OUTCOME from a shared queue full of retained classes", async () => {
    const factory = new FakeIndexedDbFactory();
    const clock = new ManualClock(QUEUE_T0);
    const seeded = Array.from({ length: 199 }, (_, index) => coreOutcomeEvent(index + 1));
    for (const event of seeded) {
      await persistQueuedEvent(factory, event, QUEUE_T0);
    }
    const tabA = tabQueue(factory, clock);
    const tabB = tabQueue(factory, clock);
    const peak = trackDurablePeak(factory);

    clock.set(QUEUE_T0 + 10_000);
    tabA.enqueue(admitted(productSampleEvent(1)));
    tabB.enqueue(admitted(coreOutcomeEvent(1001)));
    await Promise.all([tabA.settled(), tabB.settled()]);

    expect(peak.count).toBeLessThanOrEqual(EVIDENCE_QUEUE_LIMITS.maxEvents);
    expect(durableQueueIds(factory)).toEqual(eventIds([...seeded, coreOutcomeEvent(1001)]).sort());
    expect(await tabA.sendable(tabA.nextBatch())).toEqual([]);
    expect(tabA.size()).toBe(0);
  });
});

describe("Shared durable bound control and multi-collector proofs", () => {
  test("control: read and write in separate transactions do interleave across connections and break the bound", async () => {
    const factory = new FakeIndexedDbFactory();
    for (let index = 1; index <= EVIDENCE_QUEUE_LIMITS.maxEvents - 1; index += 1) {
      await persistQueuedEvent(factory, productSampleEvent(index), QUEUE_T0);
    }
    const peak = trackDurablePeak(factory);
    const openConnection = (): Promise<EvidenceIdbDatabase> => new Promise((resolve, reject) => {
      const request = factory.open(EVIDENCE_QUEUE_DATABASE.name, EVIDENCE_QUEUE_DATABASE.version);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const naiveAdmit = async (eventId: string): Promise<void> => {
      const database = await openConnection();
      const count = await new Promise<number>(resolve => {
        const request = database.transaction(EVIDENCE_QUEUE_DATABASE.entryStore, "readwrite")
          .objectStore(EVIDENCE_QUEUE_DATABASE.entryStore)
          .getAll();
        request.onsuccess = () => resolve(request.result.length);
      });
      if (count < EVIDENCE_QUEUE_LIMITS.maxEvents) {
        await new Promise<void>(resolve => {
          const transaction = database.transaction(EVIDENCE_QUEUE_DATABASE.entryStore, "readwrite");
          transaction.objectStore(EVIDENCE_QUEUE_DATABASE.entryStore)
            .put({ eventId, enqueuedAt: QUEUE_T0, collectionClass: "CORE_OUTCOME", bytes: 1 });
          transaction.oncomplete = () => resolve();
        });
      }
    };

    await Promise.all([naiveAdmit("naive-a"), naiveAdmit("naive-b")]);

    expect(peak.count).toBe(EVIDENCE_QUEUE_LIMITS.maxEvents + 1);
  });

  test("two collectors constructed before either writes keep the shared durable queue bounded and retain CORE_OUTCOME / RELIABILITY", async () => {
    const factory = new FakeIndexedDbFactory();
    const clock = new ManualClock(QUEUE_T0);
    const peak = trackDurablePeak(factory);
    const firstTab = createDurableTestCollector({ fetch: hangingFetch(), factory, clock });
    const secondTab = createDurableTestCollector({ fetch: hangingFetch(), factory, clock });
    const outcomes = Array.from({ length: 120 }, (_, index) => coreOutcomeEvent(index + 1));
    const failures = Array.from({ length: 80 }, (_, index) => reliabilityEvent(index + 1));

    for (let index = 1; index <= 150; index += 1) {
      firstTab.emit(productSampleEvent(index));
    }
    clock.set(QUEUE_T0 + 1000);
    for (let index = 151; index <= 300; index += 1) {
      secondTab.emit(productSampleEvent(index));
    }
    await Promise.all([firstTab.settled(), secondTab.settled()]);
    expect(durableQueueIds(factory)).toHaveLength(EVIDENCE_QUEUE_LIMITS.maxEvents);

    clock.set(QUEUE_T0 + 2000);
    outcomes.forEach(event => firstTab.emit(event));
    failures.forEach(event => secondTab.emit(event));
    await Promise.all([firstTab.settled(), secondTab.settled()]);
    const retained = eventIds([...outcomes, ...failures]).sort();
    expect(durableQueueIds(factory)).toEqual(retained);

    secondTab.emit(productSampleEvent(301));
    firstTab.emit(productSampleEvent(302));
    await Promise.all([firstTab.settled(), secondTab.settled()]);
    expect(durableQueueIds(factory)).toEqual(retained);
    expect(peak.count).toBeLessThanOrEqual(EVIDENCE_QUEUE_LIMITS.maxEvents);
    expect(peak.bytes).toBeLessThanOrEqual(EVIDENCE_QUEUE_LIMITS.maxBytes);
  });
});

describe("Shared overflow eviction is final for normal flush; only terminal pagehide may hand off a stale local copy", () => {
  async function staleOwnerScenario(ownerFetch: typeof fetch, navigator = createRecordingNavigator()) {
    const factory = new FakeIndexedDbFactory();
    const clock = new ManualClock(QUEUE_T0);
    const owner = createDurableTestCollector({ fetch: ownerFetch, factory, clock, navigator: navigator.navigator });
    const otherTab = createDurableTestCollector({ fetch: hangingFetch(), factory, clock });
    const evicted = productSampleEvent(1);
    const memoryOnly = productSampleEvent(2);

    owner.emit(evicted);
    await owner.settled();
    factory.failWrites = true;
    owner.emit(memoryOnly);
    await owner.settled();
    factory.failWrites = false;
    expect(durableQueueIds(factory)).toEqual([evicted.event_id]);

    clock.set(QUEUE_T0 + 1000);
    const cores = Array.from({ length: EVIDENCE_QUEUE_LIMITS.maxEvents }, (_, index) => coreOutcomeEvent(index + 1));
    cores.forEach(event => otherTab.emit(event));
    await otherTab.settled();
    expect(durableQueueIds(factory)).toEqual(eventIds(cores).sort());
    expect(eventIds(owner.queuedEvents())).toEqual([evicted.event_id, memoryOnly.event_id]);
    return { owner, evicted, memoryOnly, beacons: navigator.beacons };
  }

  test("a PRODUCT_SAMPLE evicted by another tab is never sent by the stale owner's flush, while memory-only fallback still is", async () => {
    const fetch = createScriptedFetch([200]);
    const { owner, memoryOnly } = await staleOwnerScenario(fetch.fetchImpl);

    await owner.flush();
    await owner.settled();

    expect(fetch.requests.map(request => eventIds(request.events))).toEqual([[memoryOnly.event_id]]);
    expect(owner.queuedCount()).toBe(0);
  });

  test("the stale owner's terminal pagehide may synchronously hand off its local copy of a PRODUCT_SAMPLE another tab evicted", async () => {
    const { owner, evicted, memoryOnly, beacons } = await staleOwnerScenario(hangingFetch());

    owner.flushOnPageHide();
    expect(beacons.map(beacon => beacon.accepted)).toEqual([true]);
    expect(owner.queuedCount()).toBe(0);
    expect(await beaconedEventIds(beacons)).toEqual([evicted.event_id, memoryOnly.event_id]);
  });

  test("a refused terminal pagehide does not adopt the stale-copy exception: the next normal flush still omits the evicted record", async () => {
    const fetch = createScriptedFetch([200]);
    const refusing = createRecordingNavigator([false]);
    const { owner, evicted, memoryOnly, beacons } = await staleOwnerScenario(fetch.fetchImpl, refusing);

    owner.flushOnPageHide();
    expect(beacons.map(beacon => beacon.accepted)).toEqual([false]);
    expect(eventIds(owner.queuedEvents())).toEqual([evicted.event_id, memoryOnly.event_id]);

    await owner.flush();
    await owner.settled();
    expect(fetch.requests.map(request => eventIds(request.events))).toEqual([[memoryOnly.event_id]]);
    expect(owner.queuedCount()).toBe(0);
  });
});

describe("Validated queued snapshots are immutable after admission", () => {
  test("mutating the caller's input or anything read from the queue cannot change the sent or persisted payload", async () => {
    const factory = new FakeIndexedDbFactory();
    const fetch = createScriptedFetch([200]);
    const collector = createDurableTestCollector({ fetch: fetch.fetchImpl, factory, clock: new ManualClock(QUEUE_T0) });
    const original = {
      ...coreOutcomeEvent(1),
      properties: { surface: "CREATE", source_capsule_id: "capsule-1" }
    };
    const validated: unknown = JSON.parse(JSON.stringify(original));

    collector.emit(original);
    original.properties.surface = "raw prompt text";
    Reflect.set(original, "raw_intent", "my salary is 100k");
    await collector.settled();

    const queued = requireObject(collector.queuedEvents()[0]);
    const properties = requireObject(Reflect.get(queued, "properties"));
    expect(Object.isFrozen(queued)).toBe(true);
    expect(Object.isFrozen(properties)).toBe(true);
    expect(Reflect.set(queued, "raw_intent", "build me a budget app")).toBe(false);
    expect(Reflect.set(queued, "event_type", "F00-EVT-001")).toBe(false);
    expect(Reflect.set(properties, "surface", "raw prompt text")).toBe(false);
    expect(Reflect.deleteProperty(properties, "source_capsule_id")).toBe(false);
    expect(() => Object.defineProperty(properties, "raw_intent", { value: "x", enumerable: true })).toThrow(TypeError);

    const queue = new EvidenceClientQueue(null, new ManualClock(QUEUE_T0).now);
    queue.enqueue(admitted(coreOutcomeEvent(2)));
    const [record] = queue.nextBatch();
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record?.event.properties)).toBe(true);

    expect(collector.queuedEvents()).toEqual([validated]);
    const payload = requireObject(durablePayload(factory, coreOutcomeEvent(1).event_id));
    expect(JSON.parse(String(Reflect.get(payload, "serialized")))).toEqual(validated);
    await collector.flush();
    expect(fetch.requests[0]?.events).toEqual([validated]);
  });
});
