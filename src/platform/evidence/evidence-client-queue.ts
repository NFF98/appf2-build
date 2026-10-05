import type { EvidenceEventInput } from "./evidence-types.js";
import {
  isExpired,
  planQueueAdmission,
  type EvidenceCollectionClass,
  type EvidenceEnqueueOutcome,
  type EvidenceQueueEntry
} from "./evidence-queue-policy.js";
import type {
  DurableEvidenceAdmission,
  DurableEvidenceRecord,
  EvidenceQueueStore
} from "./evidence-queue-store.js";
import { lockedEvidenceRegistry } from "./evidence-registry.js";
import { EVIDENCE_LIMITS, validateEvidenceEvent } from "./evidence-validator.js";

export {
  EVIDENCE_QUEUE_LIMITS,
  type EvidenceCollectionClass,
  type EvidenceEnqueueOutcome
} from "./evidence-queue-policy.js";

export interface AdmittedEvidenceEvent {
  readonly event: EvidenceEventInput;
  readonly collectionClass: EvidenceCollectionClass;
  readonly serialized: string;
  readonly bytes: number;
}

export interface QueuedEvidenceRecord extends EvidenceQueueEntry {
  readonly event: EvidenceEventInput;
  readonly serialized: string;
}

// PENDING: queued locally, durable admission not started, so no other collector can evict it.
// ADMITTING: durable admission transaction in flight. DURABLE: admitted to the shared queue, so
// another collector may evict it. MEMORY_ONLY: durable storage failed; held in memory only.
type RecordDurability = "PENDING" | "ADMITTING" | "DURABLE" | "MEMORY_ONLY";

interface HeldRecord {
  readonly record: QueuedEvidenceRecord;
  durability: RecordDurability;
}

export interface PageHideCandidates {
  readonly unshared: readonly QueuedEvidenceRecord[];
  readonly shared: readonly QueuedEvidenceRecord[];
}

const byteEncoder = new TextEncoder();

const BATCH_ENVELOPE_BYTES = byteEncoder.encode(
  JSON.stringify({ batch_id: "00000000-0000-4000-8000-000000000000", events: [] })
).byteLength;

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function ignoreStorageFailure(): void {
  return;
}

function isShared(durability: RecordDurability): boolean {
  return durability === "ADMITTING" || durability === "DURABLE";
}

// The queued copy is a detached, deep-frozen JSON snapshot validated against the exact bytes that
// are persisted and sent, so neither the caller's input nor anything read back out of the queue
// can be mutated past the privacy contract.
export function admitEvidenceEvent(input: unknown): AdmittedEvidenceEvent | null {
  try {
    const serialized = JSON.stringify(input);
    const snapshot: unknown = JSON.parse(serialized);
    const result = validateEvidenceEvent(snapshot, serialized);
    if (!result.accepted) {
      return null;
    }
    const entry = lockedEvidenceRegistry.find(result.event.event_type);
    if (entry === undefined) {
      return null;
    }
    return Object.freeze({
      event: deepFreeze(result.event),
      collectionClass: entry.collectionClass,
      serialized,
      bytes: byteEncoder.encode(serialized).byteLength
    });
  } catch {
    return null;
  }
}

function admitPersistedEvent(serialized: string): AdmittedEvidenceEvent | null {
  try {
    return admitEvidenceEvent(JSON.parse(serialized));
  } catch {
    return null;
  }
}

function toQueuedRecord(admitted: AdmittedEvidenceEvent, enqueuedAt: number): QueuedEvidenceRecord {
  return Object.freeze({
    eventId: admitted.event.event_id,
    event: admitted.event,
    serialized: admitted.serialized,
    collectionClass: admitted.collectionClass,
    bytes: admitted.bytes,
    enqueuedAt
  });
}

function toDurableEntry(record: QueuedEvidenceRecord): EvidenceQueueEntry {
  return {
    eventId: record.eventId,
    enqueuedAt: record.enqueuedAt,
    collectionClass: record.collectionClass,
    bytes: record.bytes
  };
}

function matchesPersistedEntry(admitted: AdmittedEvidenceEvent, entry: EvidenceQueueEntry): boolean {
  return admitted.event.event_id === entry.eventId &&
    admitted.collectionClass === entry.collectionClass &&
    admitted.bytes === entry.bytes;
}

export function batchRequestBytes(batch: readonly QueuedEvidenceRecord[]): number {
  return batch.reduce((sum, record) => sum + record.bytes, BATCH_ENVELOPE_BYTES + batch.length - 1);
}

// Splits records in order into batches of at most 50 events and requestByteLimit bytes each, and
// stops before the first record that would push the combined bytes of every yielded batch past
// totalByteLimit. Each batch's bytes are charged only once the consumer resumes past it.
function* boundedBatches(
  records: Iterable<QueuedEvidenceRecord>,
  requestByteLimit: number,
  totalByteLimit: number
): Generator<QueuedEvidenceRecord[]> {
  let remaining = totalByteLimit;
  let batch: QueuedEvidenceRecord[] = [];
  let requestBytes = BATCH_ENVELOPE_BYTES;
  for (const record of records) {
    const full = batch.length > 0 && (
      batch.length === EVIDENCE_LIMITS.batchEvents ||
      requestBytes + 1 + record.bytes > requestByteLimit
    );
    if (full) {
      yield batch;
      remaining -= requestBytes;
      batch = [];
      requestBytes = BATCH_ENVELOPE_BYTES;
    }
    const added = (batch.length === 0 ? 0 : 1) + record.bytes;
    if (requestBytes + added > remaining) {
      break;
    }
    requestBytes += added;
    batch.push(record);
  }
  if (batch.length > 0) {
    yield batch;
  }
}

export function requestBoundedBatches(
  records: Iterable<QueuedEvidenceRecord>
): Generator<QueuedEvidenceRecord[]> {
  return boundedBatches(records, EVIDENCE_LIMITS.requestBytes, Number.POSITIVE_INFINITY);
}

export function beaconBoundedBatches(
  records: Iterable<QueuedEvidenceRecord>,
  budgetBytes: number
): Generator<QueuedEvidenceRecord[]> {
  return boundedBatches(records, Math.min(budgetBytes, EVIDENCE_LIMITS.requestBytes), budgetBytes);
}

// The shared 200-event / 1 MiB bound, TTL purge and overflow priority are decided atomically by
// the durable store across every collector on the origin. This collector's memory applies the same
// policy locally so it stays bounded, and it drops any DURABLE record the shared queue no longer
// holds so an evicted record is never transmitted from a stale in-memory copy.
export class EvidenceClientQueue {
  private held = new Map<string, HeldRecord>();
  private totalBytes = 0;
  private durableWork: Promise<void> = Promise.resolve();

  public constructor(
    private readonly store: EvidenceQueueStore | null,
    private readonly now: () => number
  ) {}

  public size(): number {
    return this.held.size;
  }

  public queuedBytes(): number {
    return this.totalBytes;
  }

  public events(): EvidenceEventInput[] {
    return Array.from(this.held.values(), holder => holder.record.event);
  }

  // Durable operations may schedule follow-up removals, so wait until no new work was appended.
  public async settled(): Promise<void> {
    let observed: Promise<void>;
    do {
      observed = this.durableWork;
      await observed;
    } while (observed !== this.durableWork);
  }

  public enqueue(admitted: AdmittedEvidenceEvent): EvidenceEnqueueOutcome {
    const record = toQueuedRecord(admitted, this.now());
    const outcome = this.admitLocally(record, this.store === null ? "MEMORY_ONLY" : "PENDING");
    if (outcome === "QUEUED" && this.store !== null) {
      const store = this.store;
      void this.serialize(() => this.persist(store, record));
    }
    return outcome;
  }

  public restore(): Promise<void> {
    const store = this.store;
    return store === null ? Promise.resolve() : this.serialize(() => this.restoreDurable(store));
  }

  public nextBatch(): QueuedEvidenceRecord[] {
    const first = requestBoundedBatches(this.liveRecords()).next();
    return first.done === true ? [] : first.value;
  }

  public batches(): QueuedEvidenceRecord[][] {
    return Array.from(requestBoundedBatches(this.liveRecords()));
  }

  public pageHideCandidates(): PageHideCandidates {
    const unshared: QueuedEvidenceRecord[] = [];
    const shared: QueuedEvidenceRecord[] = [];
    for (const record of this.liveRecords()) {
      (this.isSharedRecord(record) ? shared : unshared).push(record);
    }
    return { unshared, shared };
  }

  // Re-checked before every send attempt. Expired records are discarded; records in the shared
  // queue are confirmed in one durable transaction and dropped when another collector evicted,
  // expired or delivered them. Returns null when the shared queue cannot be read, in which case
  // shared records must not be sent this attempt.
  public async sendable(records: readonly QueuedEvidenceRecord[]): Promise<QueuedEvidenceRecord[] | null> {
    const live = this.retainLive(records);
    const store = this.store;
    if (store === null || !live.some(record => this.isSharedRecord(record))) {
      return live;
    }
    const liveIds = await this.serialize(() => store.liveIds(this.now()).catch(() => null));
    if (liveIds === null) {
      return null;
    }
    this.reconcile(liveIds);
    return live.filter(record => this.holds(record));
  }

  public remove(records: readonly QueuedEvidenceRecord[]): void {
    this.discardAll(records.filter(record => this.holds(record)));
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.durableWork.then(operation);
    this.durableWork = run.then(ignoreStorageFailure, ignoreStorageFailure);
    return run;
  }

  private holds(record: QueuedEvidenceRecord): boolean {
    return this.held.get(record.eventId)?.record === record;
  }

  private isSharedRecord(record: QueuedEvidenceRecord): boolean {
    const holder = this.held.get(record.eventId);
    return holder?.record === record && isShared(holder.durability);
  }

  private setDurability(record: QueuedEvidenceRecord, durability: RecordDurability): void {
    const holder = this.held.get(record.eventId);
    if (holder?.record === record) {
      holder.durability = durability;
    }
  }

  private admitLocally(record: QueuedEvidenceRecord, durability: RecordDurability): EvidenceEnqueueOutcome {
    const plan = planQueueAdmission(
      Array.from(this.held.values(), holder => holder.record),
      record,
      this.now()
    );
    this.discardAll(plan.expired);
    if (plan.outcome !== "QUEUED") {
      return plan.outcome;
    }
    this.discardAll(plan.evicted);
    this.held.set(record.eventId, { record, durability });
    this.totalBytes += record.bytes;
    return "QUEUED";
  }

  private async persist(store: EvidenceQueueStore, record: QueuedEvidenceRecord): Promise<void> {
    if (!this.holds(record)) {
      return;
    }
    this.setDurability(record, "ADMITTING");
    let admission: DurableEvidenceAdmission;
    try {
      admission = await store.admit({ entry: toDurableEntry(record), serialized: record.serialized }, this.now());
    } catch {
      this.setDurability(record, "MEMORY_ONLY");
      return;
    }
    this.reconcile(admission.liveIds);
    if (!this.holds(record)) {
      if (admission.outcome === "QUEUED") {
        await store.remove([record.eventId]).catch(ignoreStorageFailure);
      }
      return;
    }
    if (admission.outcome === "QUEUED") {
      this.setDurability(record, "DURABLE");
    } else {
      this.forget(record);
    }
  }

  private async restoreDurable(store: EvidenceQueueStore): Promise<void> {
    let persisted: readonly DurableEvidenceRecord[];
    try {
      persisted = await store.load(this.now());
    } catch {
      return;
    }
    const rejected: string[] = [];
    const restorable: QueuedEvidenceRecord[] = [];
    for (const { entry, serialized } of persisted) {
      const admitted = admitPersistedEvent(serialized);
      if (admitted === null || !matchesPersistedEntry(admitted, entry)) {
        rejected.push(entry.eventId);
      } else {
        restorable.push(toQueuedRecord(admitted, entry.enqueuedAt));
      }
    }
    restorable.sort((left, right) => left.enqueuedAt - right.enqueuedAt);
    for (const record of restorable) {
      const local = this.held.get(record.eventId);
      if (local !== undefined) {
        this.forget(local.record);
      }
      if (this.admitLocally(record, "DURABLE") !== "QUEUED") {
        rejected.push(record.eventId);
      }
    }
    this.held = new Map(
      [...this.held].sort(([, left], [, right]) => left.record.enqueuedAt - right.record.enqueuedAt)
    );
    await store.remove(rejected).catch(ignoreStorageFailure);
  }

  private reconcile(liveIds: ReadonlySet<string>): void {
    for (const holder of this.held.values()) {
      if (holder.durability === "DURABLE" && !liveIds.has(holder.record.eventId)) {
        this.forget(holder.record);
      }
    }
  }

  private retainLive(records: readonly QueuedEvidenceRecord[]): QueuedEvidenceRecord[] {
    const now = this.now();
    const live: QueuedEvidenceRecord[] = [];
    const expired: QueuedEvidenceRecord[] = [];
    for (const record of records) {
      if (!this.holds(record)) {
        continue;
      }
      (isExpired(record, now) ? expired : live).push(record);
    }
    this.discardAll(expired);
    return live;
  }

  private liveRecords(): QueuedEvidenceRecord[] {
    return this.retainLive(Array.from(this.held.values(), holder => holder.record));
  }

  private forget(record: QueuedEvidenceRecord): void {
    if (this.held.delete(record.eventId)) {
      this.totalBytes -= record.bytes;
    }
  }

  // Removes records from memory and DURABLE ones from the shared queue in one durable transaction.
  // A record whose admission is still in flight is removed by persist() once it commits.
  private discardAll(entries: readonly EvidenceQueueEntry[]): void {
    const durableIds: string[] = [];
    for (const entry of entries) {
      const holder = this.held.get(entry.eventId);
      if (holder === undefined) {
        continue;
      }
      this.forget(holder.record);
      if (holder.durability === "DURABLE") {
        durableIds.push(entry.eventId);
      }
    }
    const store = this.store;
    if (store !== null && durableIds.length > 0) {
      void this.serialize(() => store.remove(durableIds).catch(ignoreStorageFailure));
    }
  }
}
