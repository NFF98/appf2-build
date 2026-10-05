import type { EvidenceCollectionClass } from "./evidence-queue-policy.js";

// F07-ERR-011 LOCAL_QUEUE_FULL (priority drop) / F07-ERR-012 LOCAL_QUEUE_EXPIRED (24h TTL drop).
export type EvidenceQueueDropCode = "F07-ERR-011" | "F07-ERR-012";

export interface EvidenceQueueDrop {
  readonly code: EvidenceQueueDropCode;
  readonly collection_class: EvidenceCollectionClass;
}

// Each queued record that leaves the local queue without being delivered is reported exactly once
// across every collector sharing the origin queue: by the shared durable store for records it
// holds, otherwise by the collector that held the record only in memory.
export interface EvidenceQueueObserver {
  observeQueueDrop(drop: EvidenceQueueDrop): void;
}

// Observation is operational telemetry; an observer fault must never change queue behavior.
export function reportQueueDrops(
  observer: EvidenceQueueObserver | null,
  drops: readonly EvidenceQueueDrop[]
): void {
  if (observer === null) {
    return;
  }
  for (const drop of drops) {
    try {
      observer.observeQueueDrop(drop);
    } catch {
      return;
    }
  }
}

// Delivers every drop to each observer independently, so one faulty observer cannot starve another.
export function fanOutQueueObservers(
  observers: readonly (EvidenceQueueObserver | null)[]
): EvidenceQueueObserver {
  const targets = observers.filter((observer): observer is EvidenceQueueObserver => observer !== null);
  return {
    observeQueueDrop(drop) {
      for (const target of targets) {
        reportQueueDrops(target, [drop]);
      }
    }
  };
}
