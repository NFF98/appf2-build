import { afterEach, describe, expect, test } from "vitest";

import {
  createBrowserEvidenceBeaconTransport,
  serializeEvidenceBatch
} from "../../src/platform/evidence/evidence-batch-transport.js";
import {
  admitEvidenceEvent,
  EVIDENCE_QUEUE_LIMITS,
  EvidenceClientQueue,
  type AdmittedEvidenceEvent,
  type EvidenceCollectionClass
} from "../../src/platform/evidence/evidence-client-queue.js";
import { planQueueAdmission, type EvidenceQueueEntry } from "../../src/platform/evidence/evidence-queue-policy.js";
import {
  createIndexedDbEvidenceQueueStore,
  EVIDENCE_QUEUE_DATABASE,
  resolveBrowserEvidenceQueueStore
} from "../../src/platform/evidence/evidence-queue-store.js";
import { EVIDENCE_LIMITS } from "../../src/platform/evidence/evidence-validator.js";
import { createScriptedFetch } from "./evidence-collector-test-support.js";
import { FakeIndexedDbFactory } from "./evidence-fake-indexeddb.js";
import {
  coreOutcomeEvent,
  createDurableTestCollector,
  durableQueueIds,
  ensureQueueDatabase,
  eventIds,
  ManualClock,
  productSampleEvent,
  QUEUE_T0,
  reliabilityEvent
} from "./evidence-queue-test-support.js";

const RECORD_BYTES = 8 * 1024;

function syntheticEvent(
  index: number,
  collectionClass: EvidenceCollectionClass,
  bytes = RECORD_BYTES
): AdmittedEvidenceEvent {
  return {
    event: {
      event_id: `${collectionClass}-${index}`,
      event_type: "F00-EVT-001",
      schema_version: "2.0.0",
      occurred_at: "2026-10-05T00:00:00.000Z",
      function_id: "F00"
    },
    collectionClass,
    serialized: "{}",
    bytes
  };
}

function createQueue(clock = new ManualClock(QUEUE_T0)) {
  return { queue: new EvidenceClientQueue(null, clock.now), clock };
}

function admitted(input: unknown): AdmittedEvidenceEvent {
  const result = admitEvidenceEvent(input);
  if (result === null) {
    throw new Error("Fixture event was not admitted.");
  }
  return result;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function entry(eventId: string, enqueuedAt: number): EvidenceQueueEntry {
  return { eventId, enqueuedAt, collectionClass: "CORE_OUTCOME", bytes: 1 };
}

describe("EvidenceClientQueue bounds", () => {
  test("enforces the 1 MiB byte bound with lower-priority records evicted oldest-first", () => {
    const { queue } = createQueue();
    for (let index = 1; index <= 128; index += 1) {
      expect(queue.enqueue(syntheticEvent(index, "PRODUCT_SAMPLE"))).toBe("QUEUED");
    }
    expect(queue.queuedBytes()).toBe(EVIDENCE_QUEUE_LIMITS.maxBytes);

    expect(queue.enqueue(syntheticEvent(1, "RELIABILITY"))).toBe("QUEUED");
    expect(eventIds(queue.events())).not.toContain("PRODUCT_SAMPLE-1");
    expect(queue.enqueue(syntheticEvent(129, "PRODUCT_SAMPLE"))).toBe("QUEUED");
    expect(eventIds(queue.events())).not.toContain("PRODUCT_SAMPLE-2");
    expect(queue.queuedBytes()).toBe(EVIDENCE_QUEUE_LIMITS.maxBytes);

    for (let index = 1; index <= 127; index += 1) {
      expect(queue.enqueue(syntheticEvent(index, "CORE_OUTCOME"))).toBe("QUEUED");
    }
    expect(queue.events().every(event => !event.event_id.startsWith("PRODUCT_SAMPLE"))).toBe(true);

    const fullOfRetained = eventIds(queue.events());
    expect(queue.enqueue(syntheticEvent(130, "PRODUCT_SAMPLE"))).toBe("QUEUE_FULL");
    expect(queue.enqueue(syntheticEvent(131, "DEBUG_ONLY"))).toBe("QUEUE_FULL");
    expect(eventIds(queue.events())).toEqual(fullOfRetained);

    expect(queue.enqueue(syntheticEvent(128, "CORE_OUTCOME"))).toBe("QUEUED");
    expect(eventIds(queue.events())).toEqual([...fullOfRetained.slice(1), "CORE_OUTCOME-128"]);
  });

  test("DEBUG_ONLY and PRODUCT_SAMPLE share the first-dropped tier", () => {
    const { queue } = createQueue();
    expect(queue.enqueue(syntheticEvent(1, "PRODUCT_SAMPLE", EVIDENCE_QUEUE_LIMITS.maxBytes / 2))).toBe("QUEUED");
    expect(queue.enqueue(syntheticEvent(1, "DEBUG_ONLY", EVIDENCE_QUEUE_LIMITS.maxBytes / 2))).toBe("QUEUED");
    expect(queue.enqueue(syntheticEvent(1, "RELIABILITY", EVIDENCE_QUEUE_LIMITS.maxBytes / 2))).toBe("QUEUED");
    expect(eventIds(queue.events())).toEqual(["DEBUG_ONLY-1", "RELIABILITY-1"]);
  });

  test("expired records are purged in memory and durable storage before any live record is evicted", async () => {
    const factory = new FakeIndexedDbFactory();
    const clock = new ManualClock(QUEUE_T0);
    const queue = new EvidenceClientQueue(createIndexedDbEvidenceQueueStore(factory), clock.now);
    for (let index = 1; index <= EVIDENCE_QUEUE_LIMITS.maxEvents; index += 1) {
      queue.enqueue(admitted(coreOutcomeEvent(index)));
    }
    await queue.settled();
    expect(durableQueueIds(factory)).toHaveLength(200);

    clock.set(QUEUE_T0 + EVIDENCE_QUEUE_LIMITS.ttlMs + 1);
    expect(queue.enqueue(admitted(productSampleEvent(1)))).toBe("QUEUED");
    await queue.settled();
    expect(eventIds(queue.events())).toEqual([productSampleEvent(1).event_id]);
    expect(durableQueueIds(factory)).toEqual([productSampleEvent(1).event_id]);
  });

  test("the same event_id is queued once and first enqueue wins", () => {
    const { queue, clock } = createQueue();
    expect(queue.enqueue(admitted(coreOutcomeEvent(1)))).toBe("QUEUED");
    clock.set(QUEUE_T0 + 1000);
    expect(queue.enqueue(admitted(coreOutcomeEvent(1)))).toBe("DUPLICATE");
    expect(queue.size()).toBe(1);
  });
});

describe("planQueueAdmission TTL", () => {
  test("an entry exactly 24h old is live and one millisecond older is expired even far below the bounds", () => {
    const boundary = entry("boundary", QUEUE_T0);
    const incoming = entry("incoming", QUEUE_T0 + EVIDENCE_QUEUE_LIMITS.ttlMs);
    expect(planQueueAdmission([boundary], incoming, QUEUE_T0 + EVIDENCE_QUEUE_LIMITS.ttlMs)).toEqual({
      outcome: "QUEUED",
      expired: [],
      evicted: []
    });
    expect(planQueueAdmission([boundary], incoming, QUEUE_T0 + EVIDENCE_QUEUE_LIMITS.ttlMs + 1)).toEqual({
      outcome: "QUEUED",
      expired: [boundary],
      evicted: []
    });
  });

  test("an expired holder of the same event_id does not block a fresh enqueue", () => {
    const now = QUEUE_T0 + EVIDENCE_QUEUE_LIMITS.ttlMs + 1;
    const stale = entry("same", QUEUE_T0);
    expect(planQueueAdmission([stale], entry("same", now), now).outcome).toBe("QUEUED");
    expect(planQueueAdmission([entry("same", now)], entry("same", now), now).outcome).toBe("DUPLICATE");
  });
});

describe("EvidenceClientQueue request-bounded batches", () => {
  test("batches never exceed 50 events or the 256 KiB batch request bound", () => {
    const small = createQueue().queue;
    for (let index = 1; index <= 120; index += 1) {
      small.enqueue(syntheticEvent(index, "CORE_OUTCOME", 100));
    }
    expect(small.batches().map(batch => batch.length)).toEqual([50, 50, 20]);

    const large = createQueue().queue;
    for (let index = 1; index <= 40; index += 1) {
      large.enqueue(syntheticEvent(index, "CORE_OUTCOME", 8000));
    }
    expect(large.batches().map(batch => batch.length)).toEqual([32, 8]);
  });

  test("batch byte accounting equals the serialized batch request bytes", () => {
    const { queue } = createQueue();
    queue.enqueue(admitted(coreOutcomeEvent(1)));
    queue.enqueue(admitted(reliabilityEvent(1)));
    queue.enqueue(admitted(productSampleEvent(1)));
    const batch = queue.nextBatch();
    const serialized = serializeEvidenceBatch({
      batch_id: "bbbbbbbb-cccc-4ddd-8eee-000000000001",
      events: batch.map(record => record.event)
    });
    const accounted = byteLength('{"batch_id":"bbbbbbbb-cccc-4ddd-8eee-000000000001","events":[]}') +
      batch.reduce((sum, record) => sum + record.bytes, 0) +
      batch.length - 1;
    expect(byteLength(serialized)).toBe(accounted);
    expect(accounted).toBeLessThanOrEqual(EVIDENCE_LIMITS.requestBytes);
  });
});

describe("admitEvidenceEvent", () => {
  test("classifies by the locked Evidence Registry collection_class", () => {
    expect(admitted(productSampleEvent(1)).collectionClass).toBe("PRODUCT_SAMPLE");
    expect(admitted(coreOutcomeEvent(1)).collectionClass).toBe("CORE_OUTCOME");
    expect(admitted(reliabilityEvent(1)).collectionClass).toBe("RELIABILITY");
  });

  test("queues a detached, deep-frozen validated snapshot so later mutation cannot change it", () => {
    const original = {
      ...coreOutcomeEvent(1),
      properties: { surface: "CREATE", source_capsule_id: "capsule-1" }
    };
    const result = admitted(original);
    original.properties.surface = "raw prompt text";
    expect(result.event).not.toBe(original);
    expect(result.event.properties).toEqual({ surface: "CREATE", source_capsule_id: "capsule-1" });
    expect(JSON.parse(result.serialized)).toEqual(result.event);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.event)).toBe(true);
    expect(Object.isFrozen(result.event.properties)).toBe(true);
  });

  test("rejects privacy-invalid, unknown and unserializable events without throwing", () => {
    expect(admitEvidenceEvent({
      ...coreOutcomeEvent(1),
      properties: { raw_intent: "build me a budget app" }
    })).toBeNull();
    expect(admitEvidenceEvent({ ...coreOutcomeEvent(2), event_type: "F00-EVT-999" })).toBeNull();
    const cyclic: Record<string, unknown> = { ...coreOutcomeEvent(3) };
    cyclic.properties = cyclic;
    expect(admitEvidenceEvent(cyclic)).toBeNull();
  });
});

describe("Evidence queue IndexedDB store", () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");

  afterEach(() => {
    if (originalDescriptor === undefined) {
      Reflect.deleteProperty(globalThis, "indexedDB");
    } else {
      Object.defineProperty(globalThis, "indexedDB", originalDescriptor);
    }
  });

  test("load deletes malformed entries, entries without payloads and orphan payloads", async () => {
    const factory = new FakeIndexedDbFactory();
    await ensureQueueDatabase(factory);
    const database = factory.database(EVIDENCE_QUEUE_DATABASE.name);
    const entries = database.records(EVIDENCE_QUEUE_DATABASE.entryStore);
    const payloads = database.records(EVIDENCE_QUEUE_DATABASE.payloadStore);
    const valid = { eventId: "ok", enqueuedAt: QUEUE_T0, collectionClass: "CORE_OUTCOME", bytes: 7 };
    entries.set("ok", valid);
    payloads.set("ok", { eventId: "ok", serialized: '{"a":1}' });
    entries.set("bad-class", { ...valid, eventId: "bad-class", collectionClass: "UNKNOWN" });
    entries.set("negative-bytes", { ...valid, eventId: "negative-bytes", bytes: -7 });
    entries.set("bad-time", { ...valid, eventId: "bad-time", enqueuedAt: "yesterday" });
    entries.set("no-payload", { ...valid, eventId: "no-payload" });
    payloads.set("bad-payload", { eventId: "bad-payload", serialized: 42 });
    entries.set("bad-payload", { ...valid, eventId: "bad-payload" });
    payloads.set("orphan", { eventId: "orphan", serialized: "{}" });

    const records = await createIndexedDbEvidenceQueueStore(factory).load(QUEUE_T0);

    expect(records).toEqual([{ entry: valid, serialized: '{"a":1}' }]);
    expect([...database.records(EVIDENCE_QUEUE_DATABASE.entryStore).keys()]).toEqual(["ok"]);
    expect([...database.records(EVIDENCE_QUEUE_DATABASE.payloadStore).keys()].sort()).toEqual(["ok", "orphan"]);
  });

  test("storage write failure never blocks emit and the event stays queued in memory", async () => {
    const factory = new FakeIndexedDbFactory();
    factory.failWrites = true;
    const fetch = createScriptedFetch([200]);
    const collector = createDurableTestCollector({ fetch: fetch.fetchImpl, factory, clock: new ManualClock(QUEUE_T0) });

    expect(() => collector.emit(coreOutcomeEvent(1))).not.toThrow();
    await collector.settled();
    expect(collector.queuedCount()).toBe(1);
    expect(durableQueueIds(factory)).toEqual([]);
    await collector.flush();
    expect(eventIds(fetch.requests[0]?.events ?? [])).toEqual([coreOutcomeEvent(1).event_id]);
  });

  test("a failed database open degrades to memory-only and the next admission retries durably", async () => {
    const factory = new FakeIndexedDbFactory();
    factory.failOpen = true;
    const collector = createDurableTestCollector({
      fetch: createScriptedFetch([]).fetchImpl,
      factory,
      clock: new ManualClock(QUEUE_T0)
    });
    collector.emit(coreOutcomeEvent(1));
    await collector.settled();
    expect(collector.queuedCount()).toBe(1);
    expect(durableQueueIds(factory)).toEqual([]);

    factory.failOpen = false;
    collector.emit(coreOutcomeEvent(2));
    await collector.settled();
    expect(collector.queuedCount()).toBe(2);
    expect(durableQueueIds(factory)).toEqual([coreOutcomeEvent(2).event_id]);
  });

  test("durable records are not sent while the shared queue cannot be read, and are sent once it can", async () => {
    const factory = new FakeIndexedDbFactory();
    const fetch = createScriptedFetch([200]);
    const collector = createDurableTestCollector({ fetch: fetch.fetchImpl, factory, clock: new ManualClock(QUEUE_T0) });
    collector.emit(coreOutcomeEvent(1));
    await collector.settled();

    factory.failReads = true;
    await collector.flush();
    expect(fetch.requests).toHaveLength(0);
    expect(collector.queuedCount()).toBe(1);

    factory.failReads = false;
    await collector.flush();
    await collector.settled();
    expect(eventIds(fetch.requests[0]?.events ?? [])).toEqual([coreOutcomeEvent(1).event_id]);
    expect(durableQueueIds(factory)).toEqual([]);
  });

  test("browser store resolution uses indexedDB when reachable and degrades to memory-only", async () => {
    const factory = new FakeIndexedDbFactory();
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: factory });
    const store = resolveBrowserEvidenceQueueStore();
    expect(store).not.toBeNull();
    await store?.admit({
      entry: { eventId: "event-1", enqueuedAt: QUEUE_T0, collectionClass: "CORE_OUTCOME", bytes: 7 },
      serialized: '{"x":1}'
    }, QUEUE_T0);
    expect(durableQueueIds(factory)).toEqual(["event-1"]);

    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      get() {
        throw new DOMException("denied", "SecurityError");
      }
    });
    expect(resolveBrowserEvidenceQueueStore()).toBeNull();

    Reflect.deleteProperty(globalThis, "indexedDB");
    expect(resolveBrowserEvidenceQueueStore()).toBeNull();
  });
});

describe("Evidence beacon transport", () => {
  const payload = { batch_id: "bbbbbbbb-cccc-4ddd-8eee-000000000001", events: [coreOutcomeEvent(1)] };

  test("reports refusal when sendBeacon is unavailable or throws", () => {
    expect(createBrowserEvidenceBeaconTransport({}).dispatch(payload)).toBe(false);
    expect(createBrowserEvidenceBeaconTransport(undefined).dispatch(payload)).toBe(false);
    expect(createBrowserEvidenceBeaconTransport({
      sendBeacon() {
        throw new TypeError("Illegal invocation");
      }
    }).dispatch(payload)).toBe(false);
  });

  test("invokes sendBeacon on the navigator with the JSON batch body", async () => {
    const calls: { self: unknown; url: string; body: Promise<string> }[] = [];
    const navigator = {
      sendBeacon(this: unknown, url: string | URL, data?: BodyInit | null) {
        calls.push({ self: this, url: String(url), body: (data as Blob).text() });
        return true;
      }
    };
    expect(createBrowserEvidenceBeaconTransport(navigator).dispatch(payload)).toBe(true);
    expect(calls[0]?.self).toBe(navigator);
    expect(calls[0]?.url).toBe("/api/v1/events/batch");
    expect(await calls[0]?.body).toBe(serializeEvidenceBatch(payload));
  });
});
