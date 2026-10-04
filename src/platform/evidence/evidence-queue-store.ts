import type { EvidenceRegistryEntry } from "./evidence-registry.js";

export const EVIDENCE_QUEUE_STORAGE_KEY_PREFIX = "appf2.evidence.queue.v1:";

export type EvidenceQueueStorage = Pick<
  Storage,
  "length" | "key" | "getItem" | "setItem" | "removeItem"
>;

// Admission metadata lives in the storage key so every collector sharing the origin storage can
// enforce the shared queue bounds from a key scan without reading or parsing queued payloads.
export interface EvidenceQueueEntry {
  readonly eventId: string;
  readonly enqueuedAt: number;
  readonly collectionClass: EvidenceRegistryEntry["collectionClass"];
  readonly bytes: number;
}

export interface PersistedEvidenceRecord {
  readonly entry: EvidenceQueueEntry;
  readonly event: unknown;
}

export interface EvidenceQueueStore {
  entries(): readonly EvidenceQueueEntry[];
  load(): readonly PersistedEvidenceRecord[];
  put(entry: EvidenceQueueEntry, serializedEvent: string): void;
  remove(entry: EvidenceQueueEntry): void;
}

export const NON_DURABLE_EVIDENCE_QUEUE_STORE: EvidenceQueueStore = Object.freeze({
  entries: () => [],
  load: () => [],
  put: () => undefined,
  remove: () => undefined
});

const COLLECTION_CLASSES: ReadonlySet<string> = new Set<EvidenceQueueEntry["collectionClass"]>([
  "CORE_OUTCOME",
  "RELIABILITY",
  "PRODUCT_SAMPLE",
  "DEBUG_ONLY"
]);

export function evidenceQueueStorageKey(entry: EvidenceQueueEntry): string {
  return `${EVIDENCE_QUEUE_STORAGE_KEY_PREFIX}${entry.enqueuedAt}:${entry.collectionClass}:${entry.bytes}:${entry.eventId}`;
}

function isCollectionClass(value: string): value is EvidenceQueueEntry["collectionClass"] {
  return COLLECTION_CLASSES.has(value);
}

function parseCanonicalNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && String(parsed) === value ? parsed : null;
}

function parseEntryKey(key: string): EvidenceQueueEntry | null {
  const fields = key.slice(EVIDENCE_QUEUE_STORAGE_KEY_PREFIX.length).split(":");
  if (fields.length !== 4) {
    return null;
  }
  const [rawEnqueuedAt = "", collectionClass = "", rawBytes = "", eventId = ""] = fields;
  const enqueuedAt = parseCanonicalNumber(rawEnqueuedAt);
  const bytes = parseCanonicalNumber(rawBytes);
  if (
    enqueuedAt === null ||
    bytes === null ||
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    !isCollectionClass(collectionClass) ||
    eventId === ""
  ) {
    return null;
  }
  return { eventId, enqueuedAt, collectionClass, bytes };
}

interface KeyedEntry {
  readonly key: string;
  readonly entry: EvidenceQueueEntry;
}

function scanEntries(storage: EvidenceQueueStorage): KeyedEntry[] {
  const keyed: KeyedEntry[] = [];
  const malformed: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key === null || !key.startsWith(EVIDENCE_QUEUE_STORAGE_KEY_PREFIX)) {
      continue;
    }
    const entry = parseEntryKey(key);
    if (entry === null) {
      malformed.push(key);
    } else {
      keyed.push({ key, entry });
    }
  }
  malformed.forEach(key => storage.removeItem(key));
  return keyed;
}

function parseStoredEvent(raw: string | null): { readonly event: unknown } | null {
  if (raw === null) {
    return null;
  }
  try {
    return { event: JSON.parse(raw) as unknown };
  } catch {
    return null;
  }
}

function loadPersistedRecords(storage: EvidenceQueueStorage): PersistedEvidenceRecord[] {
  const records: PersistedEvidenceRecord[] = [];
  for (const { key, entry } of scanEntries(storage)) {
    const stored = parseStoredEvent(storage.getItem(key));
    if (stored === null) {
      storage.removeItem(key);
    } else {
      records.push({ entry, event: stored.event });
    }
  }
  return records;
}

// Browser storage failures (quota, privacy mode, revoked access) must never reach the product
// workflow; the in-memory queue stays bounded and the event simply loses durability.
export function createWebStorageEvidenceQueueStore(storage: EvidenceQueueStorage): EvidenceQueueStore {
  return {
    entries() {
      try {
        return scanEntries(storage).map(keyed => keyed.entry);
      } catch {
        return [];
      }
    },
    load() {
      try {
        return loadPersistedRecords(storage);
      } catch {
        return [];
      }
    },
    put(entry, serializedEvent) {
      try {
        storage.setItem(evidenceQueueStorageKey(entry), serializedEvent);
      } catch {
        return;
      }
    },
    remove(entry) {
      try {
        storage.removeItem(evidenceQueueStorageKey(entry));
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
