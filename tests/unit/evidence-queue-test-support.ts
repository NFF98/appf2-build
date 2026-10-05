import {
  createBrowserEvidenceBeaconTransport,
  EVIDENCE_BEACON_BUDGET_BYTES,
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
  EVIDENCE_QUEUE_DATABASE,
  type DurableEvidenceAdmission,
  type DurableEvidenceRecord,
  type EvidenceQueueDropRequest,
  type EvidenceQueueStore
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

// Every IndexedDB open and transaction issued against the queue database so far.
export function queueStorageRequests(factory: FakeIndexedDbFactory): number {
  return factory.openRequests + factory.database(EVIDENCE_QUEUE_DATABASE.name).createdTransactions;
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

export interface RequestedQueueRemoval {
  readonly eventIds: readonly string[];
  readonly drop: EvidenceQueueDropRequest | undefined;
}

// One page's view of the shared durable queue. Every non-empty remove() the page requests is
// recorded; terminate() models the page being torn down: its later calls never reach storage and
// never settle.
export class PageQueueStore implements EvidenceQueueStore {
  public readonly removals: RequestedQueueRemoval[] = [];
  private terminated = false;

  public constructor(private readonly shared: EvidenceQueueStore) {}

  public terminate(): void {
    this.terminated = true;
  }

  public admit(record: DurableEvidenceRecord, now: number): Promise<DurableEvidenceAdmission> {
    return this.track(() => this.shared.admit(record, now));
  }

  public liveIds(now: number): Promise<ReadonlySet<string>> {
    return this.track(() => this.shared.liveIds(now));
  }

  public load(now: number): Promise<readonly DurableEvidenceRecord[]> {
    return this.track(() => this.shared.load(now));
  }

  public remove(eventIds: readonly string[], drop?: EvidenceQueueDropRequest): Promise<void> {
    if (eventIds.length > 0) {
      this.removals.push({ eventIds: [...eventIds], drop });
    }
    return this.track(() => this.shared.remove(eventIds, drop));
  }

  private track<T>(operation: () => Promise<T>): Promise<T> {
    return this.terminated ? new Promise<T>(() => undefined) : operation();
  }
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
  readonly bytes: number;
  readonly accepted: boolean;
  readonly body: Promise<string>;
}

// Models the user agent's keepalive quota: an accepted beacon stays in flight, counting against the
// 64 KiB budget, until completeInFlight(); a beacon that does not fit the remaining quota is refused.
// Scripted results can additionally refuse beacons that would fit.
export function createRecordingNavigator(
  results: readonly boolean[] = [],
  options: { readonly foreignInFlightBytes?: number } = {}
) {
  const remaining = [...results];
  const beacons: RecordedBeacon[] = [];
  let inFlightBytes = options.foreignInFlightBytes ?? 0;
  const navigator: EvidenceBeaconNavigator = {
    sendBeacon(url, data) {
      const blob = data instanceof Blob ? data : new Blob([]);
      const scripted = remaining.shift() ?? true;
      const accepted = scripted && inFlightBytes + blob.size <= EVIDENCE_BEACON_BUDGET_BYTES;
      if (accepted) {
        inFlightBytes += blob.size;
      }
      beacons.push({ url: String(url), type: blob.type, bytes: blob.size, accepted, body: blob.text() });
      return accepted;
    }
  };
  return {
    navigator,
    beacons,
    completeInFlight(): void {
      inFlightBytes = 0;
    }
  };
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

// The locked registry caps every envelope and property string, so no valid event approaches the
// 8 KiB event bound; this fills every optional envelope field and property to its maximum.
export function largestValidEvent(index: number): EvidenceEventInput {
  const maxSemVer = `1.0.0-${"a".repeat(250)}`;
  return {
    event_id: fixtureEventId(4, index),
    event_type: "F01-EVT-001",
    schema_version: "2.0.0",
    occurred_at: "2026-10-05T00:00:00.000Z",
    function_id: "F01",
    anonymous_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    session_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    intent_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    share_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    blueprint_hash: `sha256:${"b".repeat(64)}`,
    capability_id: `${"c".repeat(127)}.${"d".repeat(128)}`,
    error_code: `E${"X".repeat(63)}`,
    policy_rule_id: `P${"r".repeat(127)}`,
    trace_id: "f".repeat(32),
    properties: {
      intent_kind: "CREATE",
      policy_version: `p${"v".repeat(63)}`,
      prompt_version: `p${"v".repeat(63)}`,
      blueprint_schema_version: maxSemVer,
      registry_version: maxSemVer,
      model_adapter: `m${"a".repeat(63)}`,
      attempt_no: 255,
      latency_ms: 2147483647,
      coverage_status: "EXTERNAL_OR_HEAVY_REQUIRED"
    }
  };
}

export function eventIds(events: readonly EvidenceEventInput[]): string[] {
  return events.map(event => event.event_id);
}
