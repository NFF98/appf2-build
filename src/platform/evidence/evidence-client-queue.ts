import type { EvidenceEventInput } from "./evidence-types.js";
import type { EvidenceQueueStore } from "./evidence-queue-store.js";
import { lockedEvidenceRegistry, type EvidenceRegistryEntry } from "./evidence-registry.js";
import { EVIDENCE_LIMITS, validateEvidenceEvent } from "./evidence-validator.js";

export const EVIDENCE_QUEUE_LIMITS = Object.freeze({
  ttlMs: 24 * 60 * 60 * 1000,
  maxEvents: 200,
  maxBytes: 1024 * 1024
});

export type EvidenceCollectionClass = EvidenceRegistryEntry["collectionClass"];

export type EvidenceEnqueueOutcome = "QUEUED" | "DUPLICATE" | "EXPIRED" | "QUEUE_FULL";

export interface AdmittedEvidenceEvent {
  readonly event: EvidenceEventInput;
  readonly collectionClass: EvidenceCollectionClass;
  readonly serialized: string;
  readonly bytes: number;
}

export interface QueuedEvidenceRecord {
  readonly event: EvidenceEventInput;
  readonly collectionClass: EvidenceCollectionClass;
  readonly bytes: number;
  readonly enqueuedAt: number;
  readonly expiresAt: number;
}

const byteEncoder = new TextEncoder();

const BATCH_ENVELOPE_BYTES = byteEncoder.encode(
  JSON.stringify({ batch_id: "00000000-0000-4000-8000-000000000000", events: [] })
).byteLength;

function isRetainedOnOverflow(collectionClass: EvidenceCollectionClass): boolean {
  return collectionClass === "CORE_OUTCOME" || collectionClass === "RELIABILITY";
}

// The queued copy is a detached JSON snapshot validated against the exact bytes that are
// persisted and sent, so later caller mutation cannot bypass the privacy contract.
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
    return {
      event: result.event,
      collectionClass: entry.collectionClass,
      serialized,
      bytes: byteEncoder.encode(serialized).byteLength
    };
  } catch {
    return null;
  }
}

function toQueuedRecord(admitted: AdmittedEvidenceEvent, enqueuedAt: number): QueuedEvidenceRecord {
  return {
    event: admitted.event,
    collectionClass: admitted.collectionClass,
    bytes: admitted.bytes,
    enqueuedAt,
    expiresAt: enqueuedAt + EVIDENCE_QUEUE_LIMITS.ttlMs
  };
}

function isExpired(record: QueuedEvidenceRecord, now: number): boolean {
  return now > record.expiresAt;
}

function withinQueueLimits(count: number, bytes: number): boolean {
  return count <= EVIDENCE_QUEUE_LIMITS.maxEvents && bytes <= EVIDENCE_QUEUE_LIMITS.maxBytes;
}

function* requestBoundedBatches(
  records: Iterable<QueuedEvidenceRecord>
): Generator<QueuedEvidenceRecord[]> {
  let batch: QueuedEvidenceRecord[] = [];
  let requestBytes = BATCH_ENVELOPE_BYTES;
  for (const record of records) {
    const full = batch.length > 0 && (
      batch.length === EVIDENCE_LIMITS.batchEvents ||
      requestBytes + 1 + record.bytes > EVIDENCE_LIMITS.requestBytes
    );
    if (full) {
      yield batch;
      batch = [];
      requestBytes = BATCH_ENVELOPE_BYTES;
    }
    requestBytes += (batch.length === 0 ? 0 : 1) + record.bytes;
    batch.push(record);
  }
  if (batch.length > 0) {
    yield batch;
  }
}

export class EvidenceClientQueue {
  private readonly records = new Map<string, QueuedEvidenceRecord>();
  private totalBytes = 0;

  public constructor(
    private readonly store: EvidenceQueueStore,
    private readonly now: () => number
  ) {}

  public size(): number {
    return this.records.size;
  }

  public queuedBytes(): number {
    return this.totalBytes;
  }

  public events(): EvidenceEventInput[] {
    return Array.from(this.records.values(), record => record.event);
  }

  public enqueue(admitted: AdmittedEvidenceEvent): EvidenceEnqueueOutcome {
    const enqueuedAt = this.now();
    const outcome = this.admitRecord(toQueuedRecord(admitted, enqueuedAt));
    if (outcome === "QUEUED") {
      this.store.put(admitted.event.event_id, enqueuedAt, admitted.serialized);
    }
    return outcome;
  }

  public restore(): void {
    const restorable: QueuedEvidenceRecord[] = [];
    for (const persisted of this.store.load()) {
      const admitted = admitEvidenceEvent(persisted.event);
      if (admitted === null || admitted.event.event_id !== persisted.eventId) {
        this.store.remove(persisted.eventId);
        continue;
      }
      restorable.push(toQueuedRecord(admitted, persisted.enqueuedAt));
    }
    restorable.sort((left, right) => left.enqueuedAt - right.enqueuedAt);
    for (const record of restorable) {
      const outcome = this.admitRecord(record);
      if (outcome === "EXPIRED" || outcome === "QUEUE_FULL") {
        this.store.remove(record.event.event_id);
      }
    }
  }

  public nextBatch(): QueuedEvidenceRecord[] {
    const first = requestBoundedBatches(this.liveRecords(this.now())).next();
    return first.done === true ? [] : first.value;
  }

  public batches(): QueuedEvidenceRecord[][] {
    return Array.from(requestBoundedBatches(this.liveRecords(this.now())));
  }

  public remove(records: readonly QueuedEvidenceRecord[]): void {
    for (const record of records) {
      if (this.records.get(record.event.event_id) === record) {
        this.drop(record);
      }
    }
  }

  private admitRecord(record: QueuedEvidenceRecord): EvidenceEnqueueOutcome {
    const now = this.now();
    if (this.records.has(record.event.event_id)) {
      return "DUPLICATE";
    }
    if (isExpired(record, now)) {
      return "EXPIRED";
    }
    if (!this.fits(record)) {
      this.purgeExpired(now);
    }
    if (!this.fits(record) && !this.evictFor(record)) {
      return "QUEUE_FULL";
    }
    this.records.set(record.event.event_id, record);
    this.totalBytes += record.bytes;
    return "QUEUED";
  }

  private fits(record: QueuedEvidenceRecord): boolean {
    return withinQueueLimits(this.records.size + 1, this.totalBytes + record.bytes);
  }

  private evictFor(incoming: QueuedEvidenceRecord): boolean {
    const victims = this.evictionPlan(incoming);
    if (victims === null) {
      return false;
    }
    for (const victim of victims) {
      this.drop(victim);
    }
    return true;
  }

  private evictionPlan(incoming: QueuedEvidenceRecord): QueuedEvidenceRecord[] | null {
    const lowPriority: QueuedEvidenceRecord[] = [];
    const highPriority: QueuedEvidenceRecord[] = [];
    for (const record of this.records.values()) {
      (isRetainedOnOverflow(record.collectionClass) ? highPriority : lowPriority).push(record);
    }
    const candidates = isRetainedOnOverflow(incoming.collectionClass)
      ? lowPriority.concat(highPriority)
      : lowPriority;
    let count = this.records.size + 1;
    let bytes = this.totalBytes + incoming.bytes;
    const victims: QueuedEvidenceRecord[] = [];
    for (const candidate of candidates) {
      if (withinQueueLimits(count, bytes)) {
        break;
      }
      victims.push(candidate);
      count -= 1;
      bytes -= candidate.bytes;
    }
    return withinQueueLimits(count, bytes) ? victims : null;
  }

  private *liveRecords(now: number): Generator<QueuedEvidenceRecord> {
    for (const record of this.records.values()) {
      if (isExpired(record, now)) {
        this.drop(record);
        continue;
      }
      yield record;
    }
  }

  private purgeExpired(now: number): void {
    for (const record of this.records.values()) {
      if (isExpired(record, now)) {
        this.drop(record);
      }
    }
  }

  private drop(record: QueuedEvidenceRecord): void {
    this.records.delete(record.event.event_id);
    this.totalBytes -= record.bytes;
    this.store.remove(record.event.event_id);
  }
}
