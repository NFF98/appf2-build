import type { EvidenceEventInput } from "./evidence-types.js";
import type { EvidenceQueueEntry, EvidenceQueueStore } from "./evidence-queue-store.js";
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

export interface QueuedEvidenceRecord extends EvidenceQueueEntry {
  readonly event: EvidenceEventInput;
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
    eventId: admitted.event.event_id,
    event: admitted.event,
    collectionClass: admitted.collectionClass,
    bytes: admitted.bytes,
    enqueuedAt
  };
}

function matchesPersistedEntry(admitted: AdmittedEvidenceEvent, entry: EvidenceQueueEntry): boolean {
  return admitted.event.event_id === entry.eventId &&
    admitted.collectionClass === entry.collectionClass &&
    admitted.bytes === entry.bytes;
}

function isExpired(entry: EvidenceQueueEntry, now: number): boolean {
  return now > entry.enqueuedAt + EVIDENCE_QUEUE_LIMITS.ttlMs;
}

function withinQueueLimits(count: number, bytes: number): boolean {
  return count <= EVIDENCE_QUEUE_LIMITS.maxEvents && bytes <= EVIDENCE_QUEUE_LIMITS.maxBytes;
}

function totalEntryBytes(entries: readonly EvidenceQueueEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.bytes, 0);
}

// Victims are taken oldest-first from DEBUG_ONLY / PRODUCT_SAMPLE; CORE_OUTCOME / RELIABILITY are
// only displaced to admit another CORE_OUTCOME / RELIABILITY record.
function overflowVictims(
  held: readonly EvidenceQueueEntry[],
  incoming: EvidenceQueueEntry
): EvidenceQueueEntry[] | null {
  const oldestFirst = [...held].sort((left, right) => left.enqueuedAt - right.enqueuedAt);
  const lowPriority = oldestFirst.filter(entry => !isRetainedOnOverflow(entry.collectionClass));
  const candidates = isRetainedOnOverflow(incoming.collectionClass)
    ? lowPriority.concat(oldestFirst.filter(entry => isRetainedOnOverflow(entry.collectionClass)))
    : lowPriority;
  let count = held.length + 1;
  let bytes = totalEntryBytes(held) + incoming.bytes;
  const victims: EvidenceQueueEntry[] = [];
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

// The queue bounds apply to everything this collector holds plus every durable entry other
// collectors on the same origin storage have written, so concurrent tabs cannot each fill the
// shared store to the limit.
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
    const record = toQueuedRecord(admitted, this.now());
    const outcome = this.admitRecord(record, this.sharedPeerEntries());
    if (outcome === "QUEUED") {
      this.store.put(record, admitted.serialized);
    }
    return outcome;
  }

  public restore(): void {
    const restorable: QueuedEvidenceRecord[] = [];
    for (const persisted of this.store.load()) {
      const admitted = admitEvidenceEvent(persisted.event);
      if (admitted === null || !matchesPersistedEntry(admitted, persisted.entry)) {
        this.store.remove(persisted.entry);
        continue;
      }
      restorable.push(toQueuedRecord(admitted, persisted.entry.enqueuedAt));
    }
    restorable.sort((left, right) => left.enqueuedAt - right.enqueuedAt);
    for (const record of restorable) {
      if (this.admitRecord(record, []) !== "QUEUED") {
        this.store.remove(record);
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

  // Re-checked before every send attempt: a record that crossed the TTL while a batch waited on
  // retry backoff is discarded instead of transmitted.
  public retainLive(records: readonly QueuedEvidenceRecord[]): QueuedEvidenceRecord[] {
    const now = this.now();
    const live: QueuedEvidenceRecord[] = [];
    for (const record of records) {
      if (isExpired(record, now)) {
        this.discard(record);
      } else {
        live.push(record);
      }
    }
    return live;
  }

  public remove(records: readonly QueuedEvidenceRecord[]): void {
    for (const record of records) {
      if (this.records.get(record.eventId) === record) {
        this.drop(record);
      }
    }
  }

  private sharedPeerEntries(): EvidenceQueueEntry[] {
    return this.store.entries().filter(entry => !this.records.has(entry.eventId));
  }

  private admitRecord(
    record: QueuedEvidenceRecord,
    peers: readonly EvidenceQueueEntry[]
  ): EvidenceEnqueueOutcome {
    const now = this.now();
    if (this.records.has(record.eventId) || peers.some(peer => peer.eventId === record.eventId)) {
      return "DUPLICATE";
    }
    if (isExpired(record, now)) {
      return "EXPIRED";
    }
    let livePeers = peers;
    if (!this.fits(record, livePeers)) {
      this.purgeExpired(now);
      livePeers = this.discardExpiredPeers(livePeers, now);
    }
    if (!this.fits(record, livePeers) && !this.evictFor(record, livePeers)) {
      return "QUEUE_FULL";
    }
    this.records.set(record.eventId, record);
    this.totalBytes += record.bytes;
    return "QUEUED";
  }

  private fits(record: QueuedEvidenceRecord, peers: readonly EvidenceQueueEntry[]): boolean {
    return withinQueueLimits(
      this.records.size + peers.length + 1,
      this.totalBytes + totalEntryBytes(peers) + record.bytes
    );
  }

  private evictFor(incoming: QueuedEvidenceRecord, peers: readonly EvidenceQueueEntry[]): boolean {
    const victims = overflowVictims([...this.records.values(), ...peers], incoming);
    if (victims === null) {
      return false;
    }
    victims.forEach(victim => this.discard(victim));
    return true;
  }

  private discardExpiredPeers(
    peers: readonly EvidenceQueueEntry[],
    now: number
  ): EvidenceQueueEntry[] {
    const live: EvidenceQueueEntry[] = [];
    for (const peer of peers) {
      if (isExpired(peer, now)) {
        this.store.remove(peer);
      } else {
        live.push(peer);
      }
    }
    return live;
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

  private discard(entry: EvidenceQueueEntry): void {
    const held = this.records.get(entry.eventId);
    if (held === entry) {
      this.drop(held);
    } else {
      this.store.remove(entry);
    }
  }

  private drop(record: QueuedEvidenceRecord): void {
    this.records.delete(record.eventId);
    this.totalBytes -= record.bytes;
    this.store.remove(record);
  }
}
