import { isRecord } from "./evidence-field-schema.js";

export const EVIDENCE_QUEUE_STORAGE_KEY_PREFIX = "appf2.evidence.queue.v1:";

export type EvidenceQueueStorage = Pick<
  Storage,
  "length" | "key" | "getItem" | "setItem" | "removeItem"
>;

export interface PersistedEvidenceRecord {
  readonly eventId: string;
  readonly enqueuedAt: number;
  readonly event: unknown;
}

export interface EvidenceQueueStore {
  load(): readonly PersistedEvidenceRecord[];
  put(eventId: string, enqueuedAt: number, serializedEvent: string): void;
  remove(eventId: string): void;
}

export const NON_DURABLE_EVIDENCE_QUEUE_STORE: EvidenceQueueStore = Object.freeze({
  load: () => [],
  put: () => undefined,
  remove: () => undefined
});

function queueStorageKeys(storage: EvidenceQueueStorage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null && key.startsWith(EVIDENCE_QUEUE_STORAGE_KEY_PREFIX)) {
      keys.push(key);
    }
  }
  return keys;
}

function parsePersistedRecord(eventId: string, raw: string | null): PersistedEvidenceRecord | null {
  if (raw === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || typeof parsed.enqueued_at !== "number" || !Number.isFinite(parsed.enqueued_at)) {
    return null;
  }
  return { eventId, enqueuedAt: parsed.enqueued_at, event: parsed.event };
}

function loadPersistedRecords(storage: EvidenceQueueStorage): PersistedEvidenceRecord[] {
  const records: PersistedEvidenceRecord[] = [];
  for (const key of queueStorageKeys(storage)) {
    const eventId = key.slice(EVIDENCE_QUEUE_STORAGE_KEY_PREFIX.length);
    const record = parsePersistedRecord(eventId, storage.getItem(key));
    if (record === null) {
      storage.removeItem(key);
    } else {
      records.push(record);
    }
  }
  return records;
}

// Browser storage failures (quota, privacy mode, revoked access) must never reach the product
// workflow; the in-memory queue stays bounded and the event simply loses durability.
export function createWebStorageEvidenceQueueStore(storage: EvidenceQueueStorage): EvidenceQueueStore {
  return {
    load() {
      try {
        return loadPersistedRecords(storage);
      } catch {
        return [];
      }
    },
    put(eventId, enqueuedAt, serializedEvent) {
      try {
        storage.setItem(
          EVIDENCE_QUEUE_STORAGE_KEY_PREFIX + eventId,
          `{"enqueued_at":${enqueuedAt},"event":${serializedEvent}}`
        );
      } catch {
        return;
      }
    },
    remove(eventId) {
      try {
        storage.removeItem(EVIDENCE_QUEUE_STORAGE_KEY_PREFIX + eventId);
      } catch {
        return;
      }
    }
  };
}

export function resolveBrowserEvidenceQueueStore(): EvidenceQueueStore {
  try {
    const storage: Storage | undefined = globalThis.localStorage;
    return storage === undefined
      ? NON_DURABLE_EVIDENCE_QUEUE_STORE
      : createWebStorageEvidenceQueueStore(storage);
  } catch {
    return NON_DURABLE_EVIDENCE_QUEUE_STORE;
  }
}
