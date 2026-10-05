import {
  reportQueueDrops,
  type EvidenceQueueDrop,
  type EvidenceQueueDropCode,
  type EvidenceQueueObserver
} from "./evidence-observability.js";
import {
  isExpired,
  planQueueAdmission,
  type EvidenceCollectionClass,
  type EvidenceEnqueueOutcome,
  type EvidenceQueueEntry
} from "./evidence-queue-policy.js";

export const EVIDENCE_QUEUE_DATABASE = Object.freeze({
  name: "appf2.evidence.queue",
  version: 1,
  entryStore: "entries",
  payloadStore: "payloads"
});

export interface DurableEvidenceRecord {
  readonly entry: EvidenceQueueEntry;
  readonly serialized: string;
}

export interface DurableEvidenceAdmission {
  readonly outcome: EvidenceEnqueueOutcome;
  readonly liveIds: ReadonlySet<string>;
}

// A policy removal requested by a collector: entries still live in the shared queue are deleted
// and reported as dropped with this code.
export interface EvidenceQueueDropRequest {
  readonly code: EvidenceQueueDropCode;
  readonly now: number;
}

// Every operation is one atomic unit over the queue shared by all collectors on the origin, and
// every operation that reads entries purges expired entries first. A rejected promise means
// durable storage failed. remove() without a drop request is a delivery / integrity removal.
export interface EvidenceQueueStore {
  admit(record: DurableEvidenceRecord, now: number): Promise<DurableEvidenceAdmission>;
  liveIds(now: number): Promise<ReadonlySet<string>>;
  load(now: number): Promise<readonly DurableEvidenceRecord[]>;
  remove(eventIds: readonly string[], drop?: EvidenceQueueDropRequest): Promise<void>;
}

// Handler slots accept any DOM IndexedDB handler signature; this module only assigns them.
type IdbHandler = ((this: never, event: never) => unknown) | null;

export interface EvidenceIdbRequest<T> {
  readonly result: T;
  readonly error: DOMException | null;
  onsuccess: IdbHandler;
  onerror: IdbHandler;
}

export interface EvidenceIdbObjectStore {
  getAll(): EvidenceIdbRequest<unknown[]>;
  put(value: unknown): EvidenceIdbRequest<unknown>;
  delete(key: string): EvidenceIdbRequest<unknown>;
}

export interface EvidenceIdbTransaction {
  readonly error: DOMException | null;
  objectStore(name: string): EvidenceIdbObjectStore;
  oncomplete: IdbHandler;
  onabort: IdbHandler;
}

export interface EvidenceIdbDatabase {
  readonly objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string, options: { keyPath: string }): unknown;
  transaction(storeNames: string | string[], mode: "readonly" | "readwrite"): EvidenceIdbTransaction;
  close(): void;
  onversionchange: IdbHandler;
}

export interface EvidenceIdbOpenRequest extends EvidenceIdbRequest<EvidenceIdbDatabase> {
  onupgradeneeded: IdbHandler;
  onblocked: IdbHandler;
}

export interface EvidenceIdbFactory {
  open(name: string, version: number): EvidenceIdbOpenRequest;
}

interface QueueStores {
  readonly entries: EvidenceIdbObjectStore;
  readonly payloads: EvidenceIdbObjectStore;
  readonly drops: EvidenceQueueDrop[];
}

const COLLECTION_CLASSES: ReadonlySet<string> = new Set<EvidenceCollectionClass>([
  "CORE_OUTCOME",
  "RELIABILITY",
  "PRODUCT_SAMPLE",
  "DEBUG_ONLY"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCollectionClass(value: unknown): value is EvidenceCollectionClass {
  return typeof value === "string" && COLLECTION_CLASSES.has(value);
}

function storedKey(value: unknown): string | null {
  return isRecord(value) && typeof value.eventId === "string" && value.eventId !== ""
    ? value.eventId
    : null;
}

function parseStoredEntry(value: unknown): EvidenceQueueEntry | null {
  const eventId = storedKey(value);
  if (eventId === null || !isRecord(value)) {
    return null;
  }
  const { enqueuedAt, collectionClass, bytes } = value;
  if (
    typeof enqueuedAt !== "number" ||
    !Number.isFinite(enqueuedAt) ||
    typeof bytes !== "number" ||
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    !isCollectionClass(collectionClass)
  ) {
    return null;
  }
  return { eventId, enqueuedAt, collectionClass, bytes };
}

function deleteRecord(stores: QueueStores, eventId: string): void {
  stores.entries.delete(eventId);
  stores.payloads.delete(eventId);
}

function dropRecord(stores: QueueStores, entry: EvidenceQueueEntry, code: EvidenceQueueDropCode): void {
  deleteRecord(stores, entry.eventId);
  stores.drops.push({ code, collection_class: entry.collectionClass });
}

// Malformed and expired entries are deleted inside the caller's transaction before it decides;
// expired entries are reported as F07-ERR-012 drops once the transaction commits.
function readLiveEntries(
  stores: QueueStores,
  now: number,
  then: (live: EvidenceQueueEntry[]) => void
): void {
  const request = stores.entries.getAll();
  request.onsuccess = () => {
    const live: EvidenceQueueEntry[] = [];
    for (const value of request.result) {
      const entry = parseStoredEntry(value);
      const key = storedKey(value);
      if (entry !== null && !isExpired(entry, now)) {
        live.push(entry);
      } else if (entry !== null) {
        dropRecord(stores, entry, "F07-ERR-012");
      } else if (key !== null) {
        deleteRecord(stores, key);
      }
    }
    then(live);
  };
}

function transact<T>(
  database: EvidenceIdbDatabase,
  observer: EvidenceQueueObserver | null,
  work: (stores: QueueStores, finish: (value: T) => void) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    let outcome: { readonly value: T } | null = null;
    const drops: EvidenceQueueDrop[] = [];
    const transaction = database.transaction(
      [EVIDENCE_QUEUE_DATABASE.entryStore, EVIDENCE_QUEUE_DATABASE.payloadStore],
      "readwrite"
    );
    transaction.oncomplete = () => {
      if (outcome === null) {
        reject(new Error("Evidence queue transaction completed without a result."));
      } else {
        reportQueueDrops(observer, drops);
        resolve(outcome.value);
      }
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new DOMException("Evidence queue transaction aborted.", "AbortError"));
    };
    work(
      {
        entries: transaction.objectStore(EVIDENCE_QUEUE_DATABASE.entryStore),
        payloads: transaction.objectStore(EVIDENCE_QUEUE_DATABASE.payloadStore),
        drops
      },
      value => {
        outcome = { value };
      }
    );
  });
}

// An incoming record the shared queue refuses is reported by the admitting collector, which alone
// knows whether it still held that record.
function admitInTransaction(
  database: EvidenceIdbDatabase,
  observer: EvidenceQueueObserver | null,
  record: DurableEvidenceRecord,
  now: number
): Promise<DurableEvidenceAdmission> {
  return transact(database, observer, (stores, finish) => {
    readLiveEntries(stores, now, live => {
      const plan = planQueueAdmission(live, record.entry, now);
      const liveIds = new Set(live.map(entry => entry.eventId));
      for (const victim of plan.evicted) {
        dropRecord(stores, victim, "F07-ERR-011");
        liveIds.delete(victim.eventId);
      }
      if (plan.outcome === "QUEUED") {
        stores.entries.put(record.entry);
        stores.payloads.put({ eventId: record.entry.eventId, serialized: record.serialized });
        liveIds.add(record.entry.eventId);
      }
      finish({ outcome: plan.outcome, liveIds });
    });
  });
}

function liveIdsInTransaction(
  database: EvidenceIdbDatabase,
  observer: EvidenceQueueObserver | null,
  now: number
): Promise<ReadonlySet<string>> {
  return transact(database, observer, (stores, finish) => {
    readLiveEntries(stores, now, live => {
      finish(new Set(live.map(entry => entry.eventId)));
    });
  });
}

// Payloads that are malformed or belong to no live entry are deleted, so payload storage never
// holds data outside the bounded entry accounting.
function livePayloadsById(
  stores: QueueStores,
  values: readonly unknown[],
  liveIds: ReadonlySet<string>
): Map<string, string> {
  const payloads = new Map<string, string>();
  for (const value of values) {
    const key = storedKey(value);
    if (key === null) {
      continue;
    }
    if (liveIds.has(key) && isRecord(value) && typeof value.serialized === "string") {
      payloads.set(key, value.serialized);
    } else {
      stores.payloads.delete(key);
    }
  }
  return payloads;
}

function loadInTransaction(
  database: EvidenceIdbDatabase,
  observer: EvidenceQueueObserver | null,
  now: number
): Promise<readonly DurableEvidenceRecord[]> {
  return transact(database, observer, (stores, finish) => {
    readLiveEntries(stores, now, live => {
      const request = stores.payloads.getAll();
      request.onsuccess = () => {
        const payloads = livePayloadsById(stores, request.result, new Set(live.map(entry => entry.eventId)));
        const records: DurableEvidenceRecord[] = [];
        for (const entry of live) {
          const serialized = payloads.get(entry.eventId);
          if (serialized === undefined) {
            stores.entries.delete(entry.eventId);
          } else {
            records.push({ entry, serialized });
          }
        }
        finish(records);
      };
    });
  });
}

function removeInTransaction(
  database: EvidenceIdbDatabase,
  observer: EvidenceQueueObserver | null,
  eventIds: readonly string[],
  drop: EvidenceQueueDropRequest | undefined
): Promise<void> {
  return transact(database, observer, (stores, finish) => {
    if (drop === undefined) {
      eventIds.forEach(eventId => deleteRecord(stores, eventId));
      finish(undefined);
      return;
    }
    const requested = new Set(eventIds);
    readLiveEntries(stores, drop.now, live => {
      for (const entry of live) {
        if (requested.has(entry.eventId)) {
          dropRecord(stores, entry, drop.code);
        }
      }
      finish(undefined);
    });
  });
}

function openDatabase(factory: EvidenceIdbFactory): Promise<EvidenceIdbDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(EVIDENCE_QUEUE_DATABASE.name, EVIDENCE_QUEUE_DATABASE.version);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const name of [EVIDENCE_QUEUE_DATABASE.entryStore, EVIDENCE_QUEUE_DATABASE.payloadStore]) {
        if (!database.objectStoreNames.contains(name)) {
          database.createObjectStore(name, { keyPath: "eventId" });
        }
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new DOMException("Evidence queue database unavailable.", "UnknownError"));
    };
    request.onblocked = () => {
      reject(new DOMException("Evidence queue database upgrade blocked.", "UnknownError"));
    };
  });
}

// One connection per collector; a failed open is retried by the next operation rather than cached.
export function createIndexedDbEvidenceQueueStore(
  factory: EvidenceIdbFactory,
  observer: EvidenceQueueObserver | null = null
): EvidenceQueueStore {
  let connection: Promise<EvidenceIdbDatabase> | null = null;
  const database = (): Promise<EvidenceIdbDatabase> => {
    connection ??= openDatabase(factory).then(
      opened => {
        opened.onversionchange = () => {
          opened.close();
          connection = null;
        };
        return opened;
      },
      (error: unknown) => {
        connection = null;
        throw error;
      }
    );
    return connection;
  };
  return {
    async admit(record, now) {
      return admitInTransaction(await database(), observer, record, now);
    },
    async liveIds(now) {
      return liveIdsInTransaction(await database(), observer, now);
    },
    async load(now) {
      return loadInTransaction(await database(), observer, now);
    },
    async remove(eventIds, drop) {
      if (eventIds.length > 0) {
        await removeInTransaction(await database(), observer, eventIds, drop);
      }
    }
  };
}

export function resolveBrowserEvidenceQueueStore(
  observer: EvidenceQueueObserver | null = null
): EvidenceQueueStore | null {
  try {
    const factory: IDBFactory | undefined = globalThis.indexedDB;
    return factory === undefined ? null : createIndexedDbEvidenceQueueStore(factory, observer);
  } catch {
    return null;
  }
}
