import { describe, expect, test } from "vitest";

import { EVIDENCE_QUEUE_STORAGE_KEY_PREFIX } from "../../src/platform/evidence/evidence-queue-store.js";
import { createScriptedFetch } from "../unit/evidence-collector-test-support.js";
import {
  coreOutcomeEvent,
  createDurableTestCollector,
  eventIds,
  ManualClock,
  MemoryWebStorage,
  offlineFetch,
  productSampleEvent,
  QUEUE_T0,
  reliabilityEvent,
  settle
} from "../unit/evidence-queue-test-support.js";

function persist(storage: MemoryWebStorage, key: string, enqueuedAt: number, event: unknown): void {
  storage.setItem(
    `${EVIDENCE_QUEUE_STORAGE_KEY_PREFIX}${key}`,
    JSON.stringify({ enqueued_at: enqueuedAt, event })
  );
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
    persist(storage, valid.event_id, QUEUE_T0, valid);
    const tampered = { ...coreOutcomeEvent(2), properties: { raw_intent: "my salary is 100k" } };
    persist(storage, tampered.event_id, QUEUE_T0, tampered);
    const mismatched = coreOutcomeEvent(3);
    persist(storage, coreOutcomeEvent(4).event_id, QUEUE_T0, mismatched);

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
      persist(storage, event.event_id, QUEUE_T0 + ordered.indexOf(event), event);
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
