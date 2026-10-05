import { describe, expect, test } from "vitest";

import {
  EVIDENCE_BEACON_BUDGET_BYTES,
  serializeEvidenceBatch
} from "../../src/platform/evidence/evidence-batch-transport.js";
import { EVIDENCE_QUEUE_LIMITS } from "../../src/platform/evidence/evidence-client-queue.js";
import { bindEvidencePageLifecycle } from "../../src/platform/evidence/evidence-page-lifecycle.js";
import type { EvidenceEventInput } from "../../src/platform/evidence/evidence-types.js";
import { EVIDENCE_LIMITS, isUuid } from "../../src/platform/evidence/evidence-validator.js";
import { createScriptedFetch } from "../unit/evidence-collector-test-support.js";
import { FakeIndexedDbFactory } from "../unit/evidence-fake-indexeddb.js";
import {
  beaconedEventIds,
  beaconPayload,
  coreOutcomeEvent,
  createDurableTestCollector,
  createRecordingNavigator,
  drain,
  durableQueueIds,
  eventIds,
  hangingFetch,
  HOUR_MS,
  largestValidEvent,
  ManualClock,
  offlineFetch,
  productSampleEvent,
  QUEUE_T0,
  reliabilityEvent
} from "../unit/evidence-queue-test-support.js";

const TTL_MS = EVIDENCE_QUEUE_LIMITS.ttlMs;

function lifecycleTargets() {
  const document = Object.assign(new EventTarget(), {
    visibilityState: "visible" as DocumentVisibilityState
  });
  return { window: new EventTarget(), document };
}

async function proveInSessionExpiry(): Promise<void> {
  const factory = new FakeIndexedDbFactory();
  const clock = new ManualClock(QUEUE_T0);
  const fetch = createScriptedFetch(["network", "network", "network", "network", "network", "network", 200]);
  const collector = createDurableTestCollector({ fetch: fetch.fetchImpl, factory, clock });
  const stale = coreOutcomeEvent(1);

  collector.emit(stale);
  await collector.settled();
  expect(durableQueueIds(factory)).toEqual([stale.event_id]);
  await collector.flush();
  expect(collector.queuedCount()).toBe(1);

  clock.set(QUEUE_T0 + TTL_MS);
  await collector.flush();
  expect(fetch.requests).toHaveLength(6);
  expect(eventIds(collector.queuedEvents())).toEqual([stale.event_id]);
  expect(durableQueueIds(factory)).toEqual([stale.event_id]);

  clock.set(QUEUE_T0 + TTL_MS + 1);
  const fresh = coreOutcomeEvent(2);
  collector.emit(fresh);
  await collector.flush();
  await collector.settled();

  expect(fetch.requests).toHaveLength(7);
  expect(eventIds(fetch.requests[6]?.events ?? [])).toEqual([fresh.event_id]);
  expect(collector.queuedCount()).toBe(0);
  expect(durableQueueIds(factory)).toEqual([]);
}

async function proveRestartExpiry(): Promise<void> {
  const factory = new FakeIndexedDbFactory();
  const clock = new ManualClock(QUEUE_T0);
  const firstSession = createDurableTestCollector({ fetch: offlineFetch(), factory, clock });
  const retained = reliabilityEvent(1);
  firstSession.emit(retained);
  await firstSession.flush();
  expect(durableQueueIds(factory)).toEqual([retained.event_id]);

  clock.set(QUEUE_T0 + 23 * HOUR_MS);
  const online = createScriptedFetch([200]);
  const secondSession = createDurableTestCollector({ fetch: online.fetchImpl, factory, clock });
  await secondSession.settled();
  expect(eventIds(secondSession.queuedEvents())).toEqual([retained.event_id]);
  await secondSession.flush();
  await secondSession.settled();
  expect(eventIds(online.requests[0]?.events ?? [])).toEqual([retained.event_id]);
  expect(durableQueueIds(factory)).toEqual([]);

  const expired = reliabilityEvent(2);
  clock.set(QUEUE_T0 + 30 * HOUR_MS);
  const thirdSession = createDurableTestCollector({ fetch: offlineFetch(), factory, clock });
  thirdSession.emit(expired);
  await thirdSession.flush();
  expect(durableQueueIds(factory)).toEqual([expired.event_id]);

  clock.set(QUEUE_T0 + 30 * HOUR_MS + TTL_MS + 1);
  const late = createScriptedFetch([200]);
  const fourthSession = createDurableTestCollector({ fetch: late.fetchImpl, factory, clock });
  await fourthSession.settled();
  expect(fourthSession.queuedCount()).toBe(0);
  expect(durableQueueIds(factory)).toEqual([]);
  await fourthSession.flush();
  expect(late.requests).toHaveLength(0);
}

async function provePageHideHandsOffBatches(events: readonly EvidenceEventInput[]): Promise<void> {
  const factory = new FakeIndexedDbFactory();
  const beacon = createRecordingNavigator([true, true]);
  const collector = createDurableTestCollector({
    fetch: hangingFetch(),
    factory,
    clock: new ManualClock(QUEUE_T0),
    navigator: beacon.navigator
  });
  const targets = lifecycleTargets();
  bindEvidencePageLifecycle(collector, targets);
  events.forEach(event => collector.emit(event));
  await collector.settled();

  targets.window.dispatchEvent(new Event("pagehide"));
  await collector.settled();

  expect(beacon.beacons).toHaveLength(2);
  expect(collector.queuedCount()).toBe(0);
  expect(durableQueueIds(factory)).toEqual([]);
  const payloads = await Promise.all(beacon.beacons.map(beaconPayload));
  expect(beacon.beacons.map(sent => [sent.url, sent.type])).toEqual([
    ["/api/v1/events/batch", "application/json"],
    ["/api/v1/events/batch", "application/json"]
  ]);
  expect(payloads.map(payload => Object.keys(payload).sort())).toEqual([
    ["batch_id", "events"],
    ["batch_id", "events"]
  ]);
  expect(payloads.every(payload => isUuid(payload.batch_id))).toBe(true);
  expect(payloads[0]?.batch_id).not.toBe(payloads[1]?.batch_id);
  expect(payloads.map(payload => payload.events.length)).toEqual([50, 10]);
  expect(payloads.flatMap(payload => eventIds(payload.events))).toEqual(eventIds(events));
  expect(payloads[0]?.events[0]).toEqual(events[0]);
}

async function provePageHideHandsOffMemoryOnlyRecordsSynchronously(): Promise<void> {
  const factory = new FakeIndexedDbFactory();
  factory.failWrites = true;
  const beacon = createRecordingNavigator([true]);
  const collector = createDurableTestCollector({
    fetch: hangingFetch(),
    factory,
    clock: new ManualClock(QUEUE_T0),
    navigator: beacon.navigator
  });
  const targets = lifecycleTargets();
  bindEvidencePageLifecycle(collector, targets);
  const events = [coreOutcomeEvent(1), reliabilityEvent(1)];
  events.forEach(event => collector.emit(event));
  await collector.settled();
  expect(collector.queuedCount()).toBe(2);

  targets.window.dispatchEvent(new Event("pagehide"));

  expect(beacon.beacons).toHaveLength(1);
  expect(collector.queuedCount()).toBe(0);
  expect(await beaconedEventIds(beacon.beacons)).toEqual(eventIds(events));
}

function memoryOnlyPageHideCollector(beacon: ReturnType<typeof createRecordingNavigator>) {
  const factory = new FakeIndexedDbFactory();
  factory.failWrites = true;
  const collector = createDurableTestCollector({
    fetch: hangingFetch(),
    factory,
    clock: new ManualClock(QUEUE_T0),
    navigator: beacon.navigator
  });
  const targets = lifecycleTargets();
  bindEvidencePageLifecycle(collector, targets);
  return { collector, targets };
}

async function provePageHideStaysWithinBeaconBudget(): Promise<void> {
  const beacon = createRecordingNavigator();
  const { collector, targets } = memoryOnlyPageHideCollector(beacon);
  const events = Array.from({ length: 50 }, (_, index) => largestValidEvent(index + 1));
  events.forEach(event => collector.emit(event));
  await collector.settled();
  expect(collector.queuedCount()).toBe(50);
  const normalRequestBytes = new TextEncoder().encode(serializeEvidenceBatch({
    batch_id: "bbbbbbbb-cccc-4ddd-8eee-000000000000",
    events
  })).byteLength;
  expect(normalRequestBytes).toBeGreaterThan(EVIDENCE_BEACON_BUDGET_BYTES);
  expect(normalRequestBytes).toBeLessThanOrEqual(EVIDENCE_LIMITS.requestBytes);

  const handedOffPerPageHide: number[] = [];
  while (collector.queuedCount() > 0 && handedOffPerPageHide.length < events.length) {
    const before = collector.queuedCount();
    const firstBeacon = beacon.beacons.length;
    targets.window.dispatchEvent(new Event("pagehide"));
    const sent = beacon.beacons.slice(firstBeacon);
    expect(sent.every(attempt => attempt.accepted)).toBe(true);
    expect(sent.reduce((sum, attempt) => sum + attempt.bytes, 0)).toBeLessThanOrEqual(EVIDENCE_BEACON_BUDGET_BYTES);
    handedOffPerPageHide.push(before - collector.queuedCount());
    beacon.completeInFlight();
  }

  expect(handedOffPerPageHide.length).toBeGreaterThan(1);
  expect(handedOffPerPageHide.every(count => count > 0)).toBe(true);
  expect(await beaconedEventIds(beacon.beacons)).toEqual(eventIds(events));
}

async function provePartiallyAcceptedPageHideRetainsRefusedRecords(): Promise<void> {
  const events = Array.from({ length: 60 }, (_, index) => coreOutcomeEvent(index + 1));
  const firstBatchBytes = new TextEncoder().encode(serializeEvidenceBatch({
    batch_id: "bbbbbbbb-cccc-4ddd-8eee-000000000000",
    events: events.slice(0, 50)
  })).byteLength;
  const beacon = createRecordingNavigator([], {
    foreignInFlightBytes: EVIDENCE_BEACON_BUDGET_BYTES - firstBatchBytes
  });
  const { collector, targets } = memoryOnlyPageHideCollector(beacon);
  events.forEach(event => collector.emit(event));
  await collector.settled();

  targets.window.dispatchEvent(new Event("pagehide"));

  expect(beacon.beacons.map(attempt => attempt.accepted)).toEqual([true, false]);
  expect(beacon.beacons[0]?.bytes).toBe(firstBatchBytes);
  expect(await beaconedEventIds(beacon.beacons.slice(0, 1))).toEqual(eventIds(events.slice(0, 50)));
  expect(eventIds(collector.queuedEvents())).toEqual(eventIds(events.slice(50)));

  beacon.completeInFlight();
  targets.window.dispatchEvent(new Event("pagehide"));
  expect(beacon.beacons.map(attempt => attempt.accepted)).toEqual([true, false, true]);
  expect(await beaconedEventIds(beacon.beacons.slice(2))).toEqual(eventIds(events.slice(50)));
  expect(collector.queuedCount()).toBe(0);
}

async function proveRefusedPageHideKeepsDurableQueue(events: readonly EvidenceEventInput[]): Promise<void> {
  const factory = new FakeIndexedDbFactory();
  const clock = new ManualClock(QUEUE_T0);
  const refused = createRecordingNavigator([false]);
  const collector = createDurableTestCollector({
    fetch: hangingFetch(),
    factory,
    clock,
    navigator: refused.navigator
  });
  const targets = lifecycleTargets();
  bindEvidencePageLifecycle(collector, targets);
  events.forEach(event => collector.emit(event));
  await collector.settled();

  expect(() => targets.window.dispatchEvent(new Event("pagehide"))).not.toThrow();
  await collector.settled();
  expect(refused.beacons).toHaveLength(1);
  expect(collector.queuedCount()).toBe(60);
  expect(durableQueueIds(factory)).toHaveLength(60);

  const nextSessionFetch = createScriptedFetch([200, 200]);
  const nextSession = createDurableTestCollector({ fetch: nextSessionFetch.fetchImpl, factory, clock });
  await nextSession.flush();
  await nextSession.settled();
  expect(nextSessionFetch.requests.flatMap(request => eventIds(request.events))).toEqual(eventIds(events));
  expect(durableQueueIds(factory)).toEqual([]);
}

describe("F07 durable client evidence queue", () => {
  test("TEST-F07-016 unsent queued evidence is retained at most 24 hours in memory and durable storage", async () => {
    expect(TTL_MS).toBe(24 * HOUR_MS);
    await proveInSessionExpiry();
    await proveRestartExpiry();
  });

  test("TEST-F07-017 queue overflow retains CORE_OUTCOME / RELIABILITY and drops PRODUCT_SAMPLE first", async () => {
    const factory = new FakeIndexedDbFactory();
    const clock = new ManualClock(QUEUE_T0);
    const collector = createDurableTestCollector({ fetch: hangingFetch(), factory, clock });
    const samples = Array.from({ length: 100 }, (_, index) => productSampleEvent(index + 1));
    const outcomes = Array.from({ length: 150 }, (_, index) => coreOutcomeEvent(index + 1));
    const failures = Array.from({ length: 50 }, (_, index) => reliabilityEvent(index + 1));
    const sampleIds = new Set(eventIds(samples));

    samples.forEach(event => collector.emit(event));
    outcomes.slice(0, 50).forEach(event => collector.emit(event));
    failures.forEach(event => collector.emit(event));
    expect(collector.queuedCount()).toBe(EVIDENCE_QUEUE_LIMITS.maxEvents);

    collector.emit(coreOutcomeEvent(51));
    await collector.settled();
    expect(collector.queuedCount()).toBe(200);
    expect(eventIds(collector.queuedEvents())).not.toContain(productSampleEvent(1).event_id);
    expect(eventIds(collector.queuedEvents())).toContain(productSampleEvent(2).event_id);
    expect(eventIds(collector.queuedEvents())).toContain(coreOutcomeEvent(51).event_id);
    expect(durableQueueIds(factory)).toEqual([...eventIds(collector.queuedEvents())].sort());

    outcomes.slice(51).forEach(event => collector.emit(event));
    await collector.settled();
    const retained = eventIds(collector.queuedEvents());
    expect(retained).toHaveLength(200);
    expect(retained.filter(id => sampleIds.has(id))).toEqual([]);
    expect(new Set(retained)).toEqual(new Set(eventIds([...outcomes, ...failures])));

    collector.emit(productSampleEvent(101));
    await collector.settled();
    expect(eventIds(collector.queuedEvents())).toEqual(retained);
    expect(durableQueueIds(factory)).toEqual([...retained].sort());
  });

  test("TEST-F07-AC-018 pagehide best-effort flushes queued evidence through sendBeacon to the batch boundary", async () => {
    const events = Array.from({ length: 60 }, (_, index) => coreOutcomeEvent(index + 1));
    await provePageHideHandsOffBatches(events);
    await provePageHideHandsOffMemoryOnlyRecordsSynchronously();
    await provePageHideStaysWithinBeaconBudget();
    await provePartiallyAcceptedPageHideRetainsRefusedRecords();
    await proveRefusedPageHideKeepsDurableQueue(events);
  });

  test("visibility hidden triggers a normal flush, visible does not, and unbinding detaches both triggers", async () => {
    const factory = new FakeIndexedDbFactory();
    const clock = new ManualClock(QUEUE_T0);
    const fetch = createScriptedFetch([200]);
    const beacon = createRecordingNavigator();
    const collector = createDurableTestCollector({
      fetch: fetch.fetchImpl,
      factory,
      clock,
      navigator: beacon.navigator
    });
    const targets = lifecycleTargets();
    const unbind = bindEvidencePageLifecycle(collector, targets);
    collector.emit(productSampleEvent(1));

    targets.document.dispatchEvent(new Event("visibilitychange"));
    await drain();
    expect(fetch.requests).toHaveLength(0);
    expect(collector.queuedCount()).toBe(1);

    targets.document.visibilityState = "hidden";
    targets.document.dispatchEvent(new Event("visibilitychange"));
    await drain();
    expect(eventIds(fetch.requests[0]?.events ?? [])).toEqual([productSampleEvent(1).event_id]);
    expect(collector.queuedCount()).toBe(0);

    unbind();
    collector.emit(productSampleEvent(2));
    targets.window.dispatchEvent(new Event("pagehide"));
    targets.document.dispatchEvent(new Event("visibilitychange"));
    await drain();
    expect(beacon.beacons).toHaveLength(0);
    expect(fetch.requests).toHaveLength(1);
    expect(collector.queuedCount()).toBe(1);
  });
});
