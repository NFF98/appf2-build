import {
  createBrowserEvidenceBatchTransport,
  createBrowserEvidenceBeaconTransport,
  EVIDENCE_BEACON_BUDGET_BYTES,
  type EvidenceBatchPayload,
  type EvidenceBatchTransport,
  type EvidenceBatchTransportResult,
  type EvidenceBeaconTransport
} from "./evidence-batch-transport.js";
import {
  admitEvidenceEvent,
  beaconBoundedBatches,
  EvidenceClientQueue,
  type QueuedEvidenceRecord
} from "./evidence-client-queue.js";
import type { EvidenceQueueObserver } from "./evidence-observability.js";
import {
  resolveBrowserEvidenceQueueStore,
  type EvidenceQueueStore
} from "./evidence-queue-store.js";
import type { EvidenceEventInput } from "./evidence-types.js";

export const EVIDENCE_QUEUE_FLUSH_THRESHOLD = 20;
export const EVIDENCE_TIMER_FLUSH_MS = 10_000;
export const EVIDENCE_MAX_SEND_ATTEMPTS = 3;
export const EVIDENCE_FIRST_RETRY_DELAY_MS = 1_000;
export const EVIDENCE_SECOND_RETRY_DELAY_MS = 5_000;

export interface EvidenceCollectorScheduler {
  schedule(delayMs: number, callback: () => void): unknown;
  cancel(handle: unknown): void;
}

export interface EvidenceCollectorDependencies {
  readonly transport: EvidenceBatchTransport;
  readonly beaconTransport: EvidenceBeaconTransport;
  readonly queueStore: EvidenceQueueStore | null;
  readonly randomUUID: () => string;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly jitter: () => number;
  readonly scheduler: EvidenceCollectorScheduler;
  readonly observer?: EvidenceQueueObserver | null;
}

export interface BrowserEvidenceCollectorOptions {
  readonly fetch?: typeof fetch;
  readonly transport?: EvidenceBatchTransport;
  readonly beaconTransport?: EvidenceBeaconTransport;
  readonly queueStore?: EvidenceQueueStore | null;
  readonly randomUUID?: () => string;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly jitter?: () => number;
  readonly scheduler?: EvidenceCollectorScheduler;
  // Also attached to the default browser queue store; an injected queueStore carries its own.
  readonly observer?: EvidenceQueueObserver | null;
}

export function retryDelayMs(baseMs: number, unitJitter: number): number {
  const bounded = Math.min(1, Math.max(0, unitJitter));
  return Math.round(baseMs * (0.75 + 0.5 * bounded));
}

export function createBrowserEvidenceCollectorScheduler(): EvidenceCollectorScheduler {
  return {
    schedule(delayMs, callback) {
      return setTimeout(callback, delayMs);
    },
    cancel(handle) {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    }
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

async function sendSafely(
  transport: EvidenceBatchTransport,
  payload: EvidenceBatchPayload
): Promise<EvidenceBatchTransportResult> {
  try {
    return await transport.send(payload);
  } catch {
    return { ok: false, retryable: true };
  }
}

function retryDelayForAttempt(
  attempt: number,
  jitter: number
): number {
  const baseMs = attempt === 1
    ? EVIDENCE_FIRST_RETRY_DELAY_MS
    : EVIDENCE_SECOND_RETRY_DELAY_MS;
  return retryDelayMs(baseMs, jitter);
}

function batchEvents(batch: readonly QueuedEvidenceRecord[]): EvidenceEventInput[] {
  return batch.map(record => record.event);
}

async function deliverChunk(
  dependencies: EvidenceCollectorDependencies,
  queue: EvidenceClientQueue,
  batch: readonly QueuedEvidenceRecord[]
): Promise<"dequeue" | "retain"> {
  const batchId = dependencies.randomUUID();
  let pending: readonly QueuedEvidenceRecord[] = batch;
  for (let attempt = 1; attempt <= EVIDENCE_MAX_SEND_ATTEMPTS; attempt += 1) {
    const sendable = await queue.sendable(pending);
    if (sendable === null) {
      return "retain";
    }
    pending = sendable;
    if (pending.length === 0) {
      return "dequeue";
    }
    const outcome = await sendSafely(dependencies.transport, {
      batch_id: batchId,
      events: batchEvents(pending)
    });
    if (outcome.ok || !outcome.retryable) {
      return "dequeue";
    }
    if (attempt === EVIDENCE_MAX_SEND_ATTEMPTS) {
      return "retain";
    }
    await dependencies.sleep(retryDelayForAttempt(attempt, dependencies.jitter()));
  }
  return "retain";
}

export class EvidenceCollector {
  private readonly queue: EvidenceClientQueue;
  private timer: unknown = null;
  private tail: Promise<void> = Promise.resolve();

  public constructor(private readonly dependencies: EvidenceCollectorDependencies) {
    this.queue = new EvidenceClientQueue(dependencies.queueStore, dependencies.now, dependencies.observer ?? null);
    void this.queue.restore().then(() => this.armFlushTriggers());
  }

  public queuedCount(): number {
    return this.queue.size();
  }

  public queuedEvents(): readonly EvidenceEventInput[] {
    return this.queue.events();
  }

  // Resolves once durable queue work issued so far (restore, admissions and removals) has settled.
  // Network delivery is not awaited.
  public settled(): Promise<void> {
    return this.queue.settled();
  }

  public emit(event: EvidenceEventInput): void {
    const admitted = admitEvidenceEvent(event);
    if (admitted === null || this.queue.enqueue(admitted) !== "QUEUED") {
      return;
    }
    this.armFlushTriggers();
  }

  public flush(): Promise<void> {
    const run = this.tail.then(() => this.flushOwnedQueue());
    this.tail = run.then(() => undefined, () => undefined);
    return this.tail;
  }

  // Best-effort, no retries, fully synchronous inside pagehide: every locally held live snapshot,
  // DURABLE ones included, is handed to sendBeacon without first re-verifying shared durable
  // membership, so a record another collector evicted after this one last reconciled may still be
  // handed off (the server dedupes by event_id). Everything handed off in one pagehide shares the
  // 64 KiB beacon budget; records beyond it, or in a batch the user agent refuses, stay queued.
  public flushOnPageHide(): void {
    try {
      const batches = beaconBoundedBatches(this.queue.terminalHandoffRecords(), EVIDENCE_BEACON_BUDGET_BYTES);
      for (const batch of batches) {
        const accepted = this.dependencies.beaconTransport.dispatch({
          batch_id: this.dependencies.randomUUID(),
          events: batchEvents(batch)
        });
        if (!accepted) {
          return;
        }
        this.queue.remove(batch);
      }
    } catch {
      return;
    }
  }

  private armFlushTriggers(): void {
    this.ensureTimer();
    if (this.queue.size() >= EVIDENCE_QUEUE_FLUSH_THRESHOLD) {
      void this.flush();
    }
  }

  private ensureTimer(): void {
    if (this.timer !== null || this.queue.size() === 0) {
      return;
    }
    this.timer = this.dependencies.scheduler.schedule(
      EVIDENCE_TIMER_FLUSH_MS,
      () => {
        this.timer = null;
        void this.flush();
      }
    );
  }

  private clearTimer(): void {
    if (this.timer === null) {
      return;
    }
    this.dependencies.scheduler.cancel(this.timer);
    this.timer = null;
  }

  private async flushOwnedQueue(): Promise<void> {
    this.clearTimer();
    await this.queue.settled();
    for (let batch = this.queue.nextBatch(); batch.length > 0; batch = this.queue.nextBatch()) {
      const result = await deliverChunk(this.dependencies, this.queue, batch);
      if (result === "retain") {
        this.ensureTimer();
        return;
      }
      this.queue.remove(batch);
    }
  }
}

export function createBrowserEvidenceCollector(
  options: BrowserEvidenceCollectorOptions = {}
): EvidenceCollector {
  const observer = options.observer ?? null;
  return new EvidenceCollector({
    transport: options.transport ?? createBrowserEvidenceBatchTransport(options.fetch),
    beaconTransport: options.beaconTransport ?? createBrowserEvidenceBeaconTransport(),
    queueStore: options.queueStore === undefined ? resolveBrowserEvidenceQueueStore(observer) : options.queueStore,
    randomUUID: options.randomUUID ?? (() => globalThis.crypto.randomUUID()),
    now: options.now ?? (() => Date.now()),
    sleep: options.sleep ?? defaultSleep,
    jitter: options.jitter ?? (() => Math.random()),
    scheduler: options.scheduler ?? createBrowserEvidenceCollectorScheduler(),
    observer
  });
}
