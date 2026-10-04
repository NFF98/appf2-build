import {
  createBrowserEvidenceBatchTransport,
  createBrowserEvidenceBeaconTransport,
  type EvidenceBatchPayload,
  type EvidenceBatchTransport,
  type EvidenceBatchTransportResult,
  type EvidenceBeaconTransport
} from "./evidence-batch-transport.js";
import {
  admitEvidenceEvent,
  EvidenceClientQueue,
  type QueuedEvidenceRecord
} from "./evidence-client-queue.js";
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
  readonly queueStore: EvidenceQueueStore;
  readonly randomUUID: () => string;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly jitter: () => number;
  readonly scheduler: EvidenceCollectorScheduler;
}

export interface BrowserEvidenceCollectorOptions {
  readonly fetch?: typeof fetch;
  readonly transport?: EvidenceBatchTransport;
  readonly beaconTransport?: EvidenceBeaconTransport;
  readonly queueStore?: EvidenceQueueStore;
  readonly randomUUID?: () => string;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly jitter?: () => number;
  readonly scheduler?: EvidenceCollectorScheduler;
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
  let pending = batch;
  for (let attempt = 1; attempt <= EVIDENCE_MAX_SEND_ATTEMPTS; attempt += 1) {
    pending = queue.retainLive(pending);
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
    this.queue = new EvidenceClientQueue(dependencies.queueStore, dependencies.now);
    this.queue.restore();
    this.ensureTimer();
  }

  public queuedCount(): number {
    return this.queue.size();
  }

  public queuedEvents(): readonly EvidenceEventInput[] {
    return this.queue.events();
  }

  public emit(event: EvidenceEventInput): void {
    const admitted = admitEvidenceEvent(event);
    if (admitted === null || this.queue.enqueue(admitted) !== "QUEUED") {
      return;
    }
    this.ensureTimer();
    if (this.queue.size() >= EVIDENCE_QUEUE_FLUSH_THRESHOLD) {
      void this.flush();
    }
  }

  public flush(): Promise<void> {
    const run = this.tail.then(() => this.flushOwnedQueue());
    this.tail = run.then(() => undefined, () => undefined);
    return this.tail;
  }

  // Runs synchronously inside pagehide: no awaiting, no retries. Batches the user agent refuses
  // stay in the durable queue for the next session.
  public flushOnPageHide(): void {
    try {
      for (const batch of this.queue.batches()) {
        const handedOff = this.dependencies.beaconTransport.dispatch({
          batch_id: this.dependencies.randomUUID(),
          events: batchEvents(batch)
        });
        if (!handedOff) {
          return;
        }
        this.queue.remove(batch);
      }
    } catch {
      return;
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
  return new EvidenceCollector({
    transport: options.transport ?? createBrowserEvidenceBatchTransport(options.fetch),
    beaconTransport: options.beaconTransport ?? createBrowserEvidenceBeaconTransport(),
    queueStore: options.queueStore ?? resolveBrowserEvidenceQueueStore(),
    randomUUID: options.randomUUID ?? (() => globalThis.crypto.randomUUID()),
    now: options.now ?? (() => Date.now()),
    sleep: options.sleep ?? defaultSleep,
    jitter: options.jitter ?? (() => Math.random()),
    scheduler: options.scheduler ?? createBrowserEvidenceCollectorScheduler()
  });
}
