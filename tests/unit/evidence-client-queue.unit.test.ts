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
import {
  createWebStorageEvidenceQueueStore,
  EVIDENCE_QUEUE_STORAGE_KEY_PREFIX,
  NON_DURABLE_EVIDENCE_QUEUE_STORE,
  resolveBrowserEvidenceQueueStore
} from "../../src/platform/evidence/evidence-queue-store.js";
import { EVIDENCE_LIMITS } from "../../src/platform/evidence/evidence-validator.js";
import { createScriptedFetch } from "./evidence-collector-test-support.js";
import {
  coreOutcomeEvent,
  createDurableTestCollector,
  eventIds,
  ManualClock,
  MemoryWebStorage,
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

function createQueue(clock = new ManualClock(QUEUE_T0), storage = new MemoryWebStorage()) {
  return {
    queue: new EvidenceClientQueue(createWebStorageEvidenceQueueStore(storage), clock.now),
    clock,
    storage
  };
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

  test("expired records are purged before any live record is evicted", () => {
    const { queue, clock, storage } = createQueue();
    for (let index = 1; index <= EVIDENCE_QUEUE_LIMITS.maxEvents; index += 1) {
      queue.enqueue(admitted(coreOutcomeEvent(index)));
    }
    expect(storage.queuedEventIds()).toHaveLength(200);

    clock.set(QUEUE_T0 + EVIDENCE_QUEUE_LIMITS.ttlMs + 1);
    expect(queue.enqueue(admitted(productSampleEvent(1)))).toBe("QUEUED");
    expect(eventIds(queue.events())).toEqual([productSampleEvent(1).event_id]);
    expect(storage.queuedEventIds()).toEqual([productSampleEvent(1).event_id]);
  });

  test("the same event_id is queued once and first enqueue wins", () => {
    const { queue, clock } = createQueue();
    expect(queue.enqueue(admitted(coreOutcomeEvent(1)))).toBe("QUEUED");
    clock.set(QUEUE_T0 + 1000);
    expect(queue.enqueue(admitted(coreOutcomeEvent(1)))).toBe("DUPLICATE");
    expect(queue.size()).toBe(1);
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

  test("queues a detached validated snapshot so later caller mutation cannot change it", () => {
    const original = {
      ...coreOutcomeEvent(1),
      properties: { surface: "CREATE", source_capsule_id: "capsule-1" }
    };
    const result = admitted(original);
    original.properties.surface = "raw prompt text";
    expect(result.event).not.toBe(original);
    expect(result.event.properties).toEqual({ surface: "CREATE", source_capsule_id: "capsule-1" });
    expect(JSON.parse(result.serialized)).toEqual(result.event);
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

describe("Evidence queue browser storage", () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

  afterEach(() => {
    if (originalDescriptor === undefined) {
      Reflect.deleteProperty(globalThis, "localStorage");
    } else {
      Object.defineProperty(globalThis, "localStorage", originalDescriptor);
    }
  });

  test("load drops malformed queue entries and leaves unrelated storage keys untouched", () => {
    const storage = new MemoryWebStorage();
    storage.setItem("unrelated", "keep");
    storage.setItem(`${EVIDENCE_QUEUE_STORAGE_KEY_PREFIX}bad-json`, "{");
    storage.setItem(`${EVIDENCE_QUEUE_STORAGE_KEY_PREFIX}no-time`, '{"event":{}}');
    storage.setItem(`${EVIDENCE_QUEUE_STORAGE_KEY_PREFIX}ok`, '{"enqueued_at":1,"event":{"a":1}}');

    const records = createWebStorageEvidenceQueueStore(storage).load();

    expect(records).toEqual([{ eventId: "ok", enqueuedAt: 1, event: { a: 1 } }]);
    expect(storage.getItem("unrelated")).toBe("keep");
    expect(storage.queuedEventIds()).toEqual(["ok"]);
  });

  test("storage write failure never blocks emit and the event stays queued in memory", async () => {
    const storage = new MemoryWebStorage();
    storage.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
    const fetch = createScriptedFetch([200]);
    const collector = createDurableTestCollector({
      fetch: fetch.fetchImpl,
      storage,
      clock: new ManualClock(QUEUE_T0)
    });

    expect(() => collector.emit(coreOutcomeEvent(1))).not.toThrow();
    expect(collector.queuedCount()).toBe(1);
    await collector.flush();
    expect(eventIds(fetch.requests[0]?.events ?? [])).toEqual([coreOutcomeEvent(1).event_id]);
  });

  test("browser store resolution uses localStorage when reachable and degrades to non-durable", () => {
    const storage = new MemoryWebStorage();
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    const durable = resolveBrowserEvidenceQueueStore();
    durable.put("event-1", QUEUE_T0, '{"x":1}');
    expect(storage.queuedEventIds()).toEqual(["event-1"]);

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("denied", "SecurityError");
      }
    });
    expect(resolveBrowserEvidenceQueueStore()).toBe(NON_DURABLE_EVIDENCE_QUEUE_STORE);

    Reflect.deleteProperty(globalThis, "localStorage");
    expect(resolveBrowserEvidenceQueueStore()).toBe(NON_DURABLE_EVIDENCE_QUEUE_STORE);
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
