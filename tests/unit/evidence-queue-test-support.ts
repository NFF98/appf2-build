import {
  createBrowserEvidenceBeaconTransport,
  type EvidenceBeaconNavigator
} from "../../src/platform/evidence/evidence-batch-transport.js";
import {
  createBrowserEvidenceCollector,
  type EvidenceCollector
} from "../../src/platform/evidence/evidence-collector.js";
import {
  createWebStorageEvidenceQueueStore,
  EVIDENCE_QUEUE_STORAGE_KEY_PREFIX,
  type EvidenceQueueStorage
} from "../../src/platform/evidence/evidence-queue-store.js";
import type { EvidenceEventInput } from "../../src/platform/evidence/evidence-types.js";
import { ManualScheduler } from "./evidence-collector-test-support.js";

export const QUEUE_T0 = Date.parse("2026-10-05T00:00:00.000Z");
export const HOUR_MS = 60 * 60 * 1000;

export class MemoryWebStorage implements EvidenceQueueStorage {
  private readonly items = new Map<string, string>();

  public get length(): number {
    return this.items.size;
  }

  public key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }

  public getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.items.set(key, value);
  }

  public removeItem(key: string): void {
    this.items.delete(key);
  }

  public queuedEventIds(): string[] {
    return [...this.items.keys()]
      .filter(key => key.startsWith(EVIDENCE_QUEUE_STORAGE_KEY_PREFIX))
      .map(key => key.slice(EVIDENCE_QUEUE_STORAGE_KEY_PREFIX.length))
      .sort();
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

export function createDurableTestCollector(input: {
  readonly fetch: typeof fetch;
  readonly storage: MemoryWebStorage;
  readonly clock: ManualClock;
  readonly navigator?: EvidenceBeaconNavigator;
  readonly scheduler?: ManualScheduler;
}): EvidenceCollector {
  let uuidIndex = 0;
  return createBrowserEvidenceCollector({
    fetch: input.fetch,
    queueStore: createWebStorageEvidenceQueueStore(input.storage),
    beaconTransport: createBrowserEvidenceBeaconTransport(input.navigator ?? {}),
    now: input.clock.now,
    scheduler: input.scheduler ?? new ManualScheduler(),
    jitter: () => 0.5,
    sleep: async () => undefined,
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
