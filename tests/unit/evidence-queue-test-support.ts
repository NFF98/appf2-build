import {
  createBrowserEvidenceBeaconTransport,
  type EvidenceBeaconNavigator
} from "../../src/platform/evidence/evidence-batch-transport.js";
import { admitEvidenceEvent } from "../../src/platform/evidence/evidence-client-queue.js";
import {
  createBrowserEvidenceCollector,
  type EvidenceCollector
} from "../../src/platform/evidence/evidence-collector.js";
import type { EvidenceQueueEntry } from "../../src/platform/evidence/evidence-queue-policy.js";
import {
  createIndexedDbEvidenceQueueStore,
  EVIDENCE_QUEUE_DATABASE
} from "../../src/platform/evidence/evidence-queue-store.js";
import type { EvidenceEventInput } from "../../src/platform/evidence/evidence-types.js";
import { ManualScheduler } from "./evidence-collector-test-support.js";
import { FakeIndexedDbFactory } from "./evidence-fake-indexeddb.js";

export const QUEUE_T0 = Date.parse("2026-10-05T00:00:00.000Z");
export const HOUR_MS = 60 * 60 * 1000;

function queueDatabaseRecords(factory: FakeIndexedDbFactory, storeName: string): Map<string, unknown> {
  const database = factory.database(EVIDENCE_QUEUE_DATABASE.name);
  return database.stores.has(storeName) ? database.records(storeName) : new Map();
}

export function durableEntries(factory: FakeIndexedDbFactory): EvidenceQueueEntry[] {
  return [...queueDatabaseRecords(factory, EVIDENCE_QUEUE_DATABASE.entryStore).values()]
    .map(value => value as EvidenceQueueEntry);
}

export function durableQueueIds(factory: FakeIndexedDbFactory): string[] {
  return durableEntries(factory).map(entry => entry.eventId).sort();
}

export function durablePayload(factory: FakeIndexedDbFactory, eventId: string): unknown {
  return queueDatabaseRecords(factory, EVIDENCE_QUEUE_DATABASE.payloadStore).get(eventId);
}

export interface DurablePeak {
  count: number;
  bytes: number;
}

// Observes the shared durable queue after every committed readwrite transaction from any
// connection, which is the state every other collector can observe.
export function trackDurablePeak(factory: FakeIndexedDbFactory): DurablePeak {
  const peak: DurablePeak = { count: 0, bytes: 0 };
  factory.commitListeners.push(() => {
    const entries = durableEntries(factory);
    peak.count = Math.max(peak.count, entries.length);
    peak.bytes = Math.max(peak.bytes, entries.reduce((sum, entry) => sum + entry.bytes, 0));
  });
  return peak;
}

export async function ensureQueueDatabase(factory: FakeIndexedDbFactory): Promise<void> {
  await createIndexedDbEvidenceQueueStore(factory).liveIds(QUEUE_T0);
}

export async function persistQueuedEvent(
  factory: FakeIndexedDbFactory,
  event: { readonly event_id: string },
  enqueuedAt: number,
  overrides: Partial<EvidenceQueueEntry> = {}
): Promise<void> {
  await ensureQueueDatabase(factory);
  const serialized = JSON.stringify(event);
  const entry: EvidenceQueueEntry = {
    eventId: event.event_id,
    enqueuedAt,
    collectionClass: admitEvidenceEvent(event)?.collectionClass ?? "CORE_OUTCOME",
    bytes: new TextEncoder().encode(serialized).byteLength,
    ...overrides
  };
  queueDatabaseRecords(factory, EVIDENCE_QUEUE_DATABASE.entryStore).set(entry.eventId, entry);
  queueDatabaseRecords(factory, EVIDENCE_QUEUE_DATABASE.payloadStore)
    .set(entry.eventId, { eventId: entry.eventId, serialized });
}

export class ManualClock {
  public constructor(public current: number = QUEUE_T0) {}

  public readonly now = (): number => this.current;

  public set(epochMs: number): void {
    this.current = epochMs;
  }
}

export interface RecordedBeacon {
  readonly url: string;
  readonly type: string;
  readonly body: Promise<string>;
}

export function createRecordingNavigator(results: readonly boolean[] = []) {
  const remaining = [...results];
  const beacons: RecordedBeacon[] = [];
  const navigator: EvidenceBeaconNavigator = {
    sendBeacon(url, data) {
      const blob = data instanceof Blob ? data : new Blob([]);
      beacons.push({ url: String(url), type: blob.type, body: blob.text() });
      return remaining.shift() ?? true;
    }
  };
  return { navigator, beacons };
}

export async function beaconPayload(beacon: RecordedBeacon): Promise<{
  readonly batch_id: string;
  readonly events: readonly EvidenceEventInput[];
}> {
  return JSON.parse(await beacon.body) as {
    batch_id: string;
    events: EvidenceEventInput[];
  };
}

export async function beaconedEventIds(beacons: readonly RecordedBeacon[]): Promise<string[]> {
  const payloads = await Promise.all(beacons.map(beaconPayload));
  return payloads.flatMap(payload => eventIds(payload.events));
}

export function createDurableTestCollector(input: {
  readonly fetch: typeof fetch;
  readonly factory: FakeIndexedDbFactory;
  readonly clock: ManualClock;
  readonly navigator?: EvidenceBeaconNavigator;
  readonly scheduler?: ManualScheduler;
  readonly sleep?: (ms: number) => Promise<void>;
}): EvidenceCollector {
  let uuidIndex = 0;
  return createBrowserEvidenceCollector({
    fetch: input.fetch,
    queueStore: createIndexedDbEvidenceQueueStore(input.factory),
    beaconTransport: createBrowserEvidenceBeaconTransport(input.navigator ?? {}),
    now: input.clock.now,
    scheduler: input.scheduler ?? new ManualScheduler(),
    jitter: () => 0.5,
    sleep: input.sleep ?? (async () => undefined),
    randomUUID: () => {
      uuidIndex += 1;
      return `bbbbbbbb-cccc-4ddd-8eee-${String(uuidIndex).padStart(12, "0")}`;
    }
  });
}

export function hangingFetch(): typeof fetch {
  return () => new Promise<Response>(() => undefined);
}

export function offlineFetch(): typeof fetch {
  return async () => {
    throw new TypeError("Failed to fetch");
  };
}

export function settle(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, 0);
  });
}

export async function drain(rounds = 10): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await settle();
  }
}

function fixtureEventId(kind: number, index: number): string {
  return `${kind}0000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

export function productSampleEvent(index: number): EvidenceEventInput {
  return {
    event_id: fixtureEventId(1, index),
    event_type: "F00-EVT-001",
    schema_version: "2.0.0",
    occurred_at: "2026-10-05T00:00:00.000Z",
    function_id: "F00",
    properties: { surface: "DISCOVER", source_capsule_id: `capsule-${index}` }
  };
}

export function coreOutcomeEvent(index: number): EvidenceEventInput {
  return {
    event_id: fixtureEventId(2, index),
    event_type: "F00-EVT-003",
    schema_version: "2.0.0",
    occurred_at: "2026-10-05T00:00:00.000Z",
    function_id: "F00",
    properties: { surface: "CREATE", source_capsule_id: `capsule-${index}` }
  };
}

export function reliabilityEvent(index: number): EvidenceEventInput {
  return {
    event_id: fixtureEventId(3, index),
    event_type: "F02-EVT-003",
    schema_version: "2.0.0",
    occurred_at: "2026-10-05T00:00:00.000Z",
    function_id: "F02",
    properties: {
      content_hash: `sha256:${"a".repeat(64)}`,
      blueprint_schema_version: "1.0.0",
      registry_version: "7.0.0",
      validation_stage: "V05"
    }
  };
}

export function eventIds(events: readonly EvidenceEventInput[]): string[] {
  return events.map(event => event.event_id);
}
