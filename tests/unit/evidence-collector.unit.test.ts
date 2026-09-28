import { describe, expect, test } from "vitest";

import { EVIDENCE_TIMER_FLUSH_MS } from "../../src/platform/evidence/evidence-collector.js";
import {
  createScriptedFetch,
  createTestCollector,
  ManualScheduler,
  shareOpenEvent
} from "./evidence-collector-test-support.js";

describe("EvidenceCollector batching", () => {
  test("TEST-F07-013 batches local Runtime emits instead of sending one network request per action", async () => {
    const scheduler = new ManualScheduler();
    const underThreshold = createScriptedFetch();
    const collector = createTestCollector({
      fetch: underThreshold.fetchImpl,
      scheduler
    });
    const productState = { actions: 0 };

    for (let index = 1; index <= 3; index += 1) {
      collector.emit(shareOpenEvent(index));
      productState.actions += 1;
    }

    expect(productState.actions).toBe(3);
    expect(collector.queuedCount()).toBe(3);
    expect(underThreshold.requests).toHaveLength(0);
    expect(scheduler.pending?.delayMs).toBe(EVIDENCE_TIMER_FLUSH_MS);

    scheduler.fire();
    await collector.flush();

    expect(underThreshold.requests).toHaveLength(1);
    expect(underThreshold.requests[0]?.url).toBe("/api/v1/events/batch");
    expect(underThreshold.requests[0]?.method).toBe("POST");
    expect(underThreshold.requests[0]?.events.map(event => event.event_id)).toEqual([
      shareOpenEvent(1).event_id,
      shareOpenEvent(2).event_id,
      shareOpenEvent(3).event_id
    ]);
    expect(collector.queuedCount()).toBe(0);

    const threshold = createScriptedFetch();
    const thresholdCollector = createTestCollector({ fetch: threshold.fetchImpl });
    for (let index = 1; index <= 19; index += 1) {
      thresholdCollector.emit(shareOpenEvent(index));
    }
    expect(threshold.requests).toHaveLength(0);
    expect(thresholdCollector.queuedCount()).toBe(19);

    thresholdCollector.emit(shareOpenEvent(20));
    expect(threshold.requests).toHaveLength(0);
    expect(thresholdCollector.queuedCount()).toBe(20);
    await thresholdCollector.flush();

    expect(threshold.requests).toHaveLength(1);
    expect(threshold.requests[0]?.events).toHaveLength(20);
    expect(threshold.requests[0]?.headerNames).not.toContain("idempotency-key");
    expect(thresholdCollector.queuedCount()).toBe(0);
  });

  test("TEST-F07-014 chunks every outgoing batch to at most 50 events through the production collector path", async () => {
    const fetch = createScriptedFetch();
    const collector = createTestCollector({ fetch: fetch.fetchImpl });

    for (let index = 1; index <= 65; index += 1) {
      collector.emit(shareOpenEvent(index));
    }

    expect(collector.queuedCount()).toBe(65);
    expect(fetch.requests).toHaveLength(0);

    await collector.flush();

    const outgoingSizes = fetch.requests.map(request => request.events.length);
    expect(outgoingSizes).toEqual([50, 15]);
    expect(outgoingSizes.every(size => size <= 50)).toBe(true);
    expect(fetch.requests[0]?.events[0]?.event_id).toBe(shareOpenEvent(1).event_id);
    expect(fetch.requests[0]?.events[49]?.event_id).toBe(shareOpenEvent(50).event_id);
    expect(fetch.requests[1]?.events[0]?.event_id).toBe(shareOpenEvent(51).event_id);
    expect(fetch.requests[1]?.events[14]?.event_id).toBe(shareOpenEvent(65).event_id);
    expect(collector.queuedCount()).toBe(0);
  });

  test("single-flight flush does not duplicate the same queued events", async () => {
    let release: (() => void) | undefined;
    const hold = new Promise<void>(resolve => {
      release = resolve;
    });
    const fetch = createScriptedFetch();
    const holdingFetch: typeof globalThis.fetch = async (input, init) => {
      await hold;
      return fetch.fetchImpl(input, init);
    };
    const collector = createTestCollector({ fetch: holdingFetch });

    for (let index = 1; index <= 20; index += 1) {
      collector.emit(shareOpenEvent(index));
    }
    const first = collector.flush();
    const second = collector.flush();
    release?.();
    await Promise.all([first, second]);

    expect(fetch.requests).toHaveLength(1);
    expect(fetch.requests[0]?.events).toHaveLength(20);
    expect(collector.queuedCount()).toBe(0);
  });
});
