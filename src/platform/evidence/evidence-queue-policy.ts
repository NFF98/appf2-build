import type { EvidenceRegistryEntry } from "./evidence-registry.js";

export const EVIDENCE_QUEUE_LIMITS = Object.freeze({
  ttlMs: 24 * 60 * 60 * 1000,
  maxEvents: 200,
  maxBytes: 1024 * 1024
});

export type EvidenceCollectionClass = EvidenceRegistryEntry["collectionClass"];

export type EvidenceEnqueueOutcome = "QUEUED" | "DUPLICATE" | "EXPIRED" | "QUEUE_FULL";

export interface EvidenceQueueEntry {
  readonly eventId: string;
  readonly enqueuedAt: number;
  readonly collectionClass: EvidenceCollectionClass;
  readonly bytes: number;
}

export interface EvidenceAdmissionPlan {
  readonly outcome: EvidenceEnqueueOutcome;
  readonly expired: readonly EvidenceQueueEntry[];
  readonly evicted: readonly EvidenceQueueEntry[];
}

export function isExpired(entry: EvidenceQueueEntry, now: number): boolean {
  return now > entry.enqueuedAt + EVIDENCE_QUEUE_LIMITS.ttlMs;
}

function isRetainedOnOverflow(collectionClass: EvidenceCollectionClass): boolean {
  return collectionClass === "CORE_OUTCOME" || collectionClass === "RELIABILITY";
}

function withinQueueLimits(count: number, bytes: number): boolean {
  return count <= EVIDENCE_QUEUE_LIMITS.maxEvents && bytes <= EVIDENCE_QUEUE_LIMITS.maxBytes;
}

// Victims are taken oldest-first from DEBUG_ONLY / PRODUCT_SAMPLE; CORE_OUTCOME / RELIABILITY are
// only displaced to admit another CORE_OUTCOME / RELIABILITY record.
function overflowVictims(
  live: readonly EvidenceQueueEntry[],
  incoming: EvidenceQueueEntry
): EvidenceQueueEntry[] | null {
  let count = live.length + 1;
  let bytes = live.reduce((sum, entry) => sum + entry.bytes, incoming.bytes);
  if (withinQueueLimits(count, bytes)) {
    return [];
  }
  const oldestFirst = [...live].sort((left, right) => left.enqueuedAt - right.enqueuedAt);
  const lowPriority = oldestFirst.filter(entry => !isRetainedOnOverflow(entry.collectionClass));
  const candidates = isRetainedOnOverflow(incoming.collectionClass)
    ? lowPriority.concat(oldestFirst.filter(entry => isRetainedOnOverflow(entry.collectionClass)))
    : lowPriority;
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

// Expired entries are reported for removal on every admission, independent of capacity pressure,
// so an entry older than the TTL never survives merely because the queue is under its bounds.
export function planQueueAdmission(
  held: readonly EvidenceQueueEntry[],
  incoming: EvidenceQueueEntry,
  now: number
): EvidenceAdmissionPlan {
  const expired: EvidenceQueueEntry[] = [];
  const live: EvidenceQueueEntry[] = [];
  for (const entry of held) {
    (isExpired(entry, now) ? expired : live).push(entry);
  }
  if (live.some(entry => entry.eventId === incoming.eventId)) {
    return { outcome: "DUPLICATE", expired, evicted: [] };
  }
  if (isExpired(incoming, now)) {
    return { outcome: "EXPIRED", expired, evicted: [] };
  }
  const evicted = overflowVictims(live, incoming);
  return evicted === null
    ? { outcome: "QUEUE_FULL", expired, evicted: [] }
    : { outcome: "QUEUED", expired, evicted };
}
