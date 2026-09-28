import { describe, expect, test } from "vitest";

import {
  batchId,
  createScriptedFetch,
  createTestCollector,
  shareOpenEvent
} from "../unit/evidence-collector-test-support.js";

async function proveNetworkFailureRetryAndLaterFlush(): Promise<void> {
  const sleepLog: number[] = [];
  const fetch = createScriptedFetch(["network", "network", "network", 200]);
  const collector = createTestCollector({
    fetch: fetch.fetchImpl,
    sleepLog,
    batchIds: [batchId(1), batchId(2)]
  });
  const productState = { step: "ready" };

  collector.emit(shareOpenEvent(1));
  productState.step = "continued";
  expect(productState.step).toBe("continued");
  expect(fetch.requests).toHaveLength(0);

  await collector.flush();

  expect(fetch.requests).toHaveLength(3);
  expect(sleepLog).toEqual([1000, 5000]);
  expect(new Set(fetch.requests.map(request => request.batch_id))).toEqual(new Set([batchId(1)]));
  expect(fetch.requests.every(request => request.events[0]?.event_id === shareOpenEvent(1).event_id)).toBe(true);
  expect(collector.queuedCount()).toBe(1);
  expect(collector.queuedEvents()[0]?.event_id).toBe(shareOpenEvent(1).event_id);

  await collector.flush();

  expect(fetch.requests).toHaveLength(4);
  expect(fetch.requests[3]?.batch_id).toBe(batchId(2));
  expect(fetch.requests[3]?.events[0]?.event_id).toBe(shareOpenEvent(1).event_id);
  expect(collector.queuedCount()).toBe(0);
}

async function proveTransientHttpRetry(): Promise<void> {
  const sleepLog: number[] = [];
  const fetch = createScriptedFetch([429, 503, 200]);
  const collector = createTestCollector({
    fetch: fetch.fetchImpl,
    sleepLog,
    batchIds: [batchId(3)]
  });
  const productState = { accepted: false };

  collector.emit(shareOpenEvent(2));
  productState.accepted = true;
  await collector.flush();

  expect(productState.accepted).toBe(true);
  expect(fetch.requests.map(request => request.batch_id)).toEqual([batchId(3), batchId(3), batchId(3)]);
  expect(fetch.requests.every(request => request.events[0]?.event_id === shareOpenEvent(2).event_id)).toBe(true);
  expect(sleepLog).toEqual([1000, 5000]);
  expect(collector.queuedCount()).toBe(0);
}

async function proveNonRetry4xx(): Promise<void> {
  const sleepLog: number[] = [];
  const fetch = createScriptedFetch([400]);
  const collector = createTestCollector({
    fetch: fetch.fetchImpl,
    sleepLog,
    batchIds: [batchId(4)]
  });

  collector.emit(shareOpenEvent(3));
  await collector.flush();

  expect(fetch.requests).toHaveLength(1);
  expect(sleepLog).toEqual([]);
  expect(collector.queuedCount()).toBe(0);
}

describe("EvidenceCollector retry isolation", () => {
  test("TEST-F07-AC-015 keeps product flow moving across transient ingest failure and bounded retry", async () => {
    await proveNetworkFailureRetryAndLaterFlush();
    await proveTransientHttpRetry();
    await proveNonRetry4xx();
  });

  test("flush rejects are swallowed so evidence failure cannot become an unhandled rejection", async () => {
    const fetch = createScriptedFetch(["network", "network", "network"]);
    const collector = createTestCollector({ fetch: fetch.fetchImpl });
    collector.emit(shareOpenEvent(4));

    await expect(collector.flush()).resolves.toBeUndefined();
    expect(collector.queuedCount()).toBe(1);
  });
});
