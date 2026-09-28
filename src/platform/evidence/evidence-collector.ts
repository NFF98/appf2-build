import {
  createBrowserEvidenceBatchTransport,
  type EvidenceBatchPayload,
  type EvidenceBatchTransport,
  type EvidenceBatchTransportResult
} from "./evidence-batch-transport.js";
import type { EvidenceEventInput } from "./evidence-types.js";
import { EVIDENCE_LIMITS, validateEvidenceEvent } from "./evidence-validator.js";

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
  readonly randomUUID: () => string;
  readonly sleep: (ms: number) => Promise<void>;
  readonly jitter: () => number;
  readonly scheduler: EvidenceCollectorScheduler;
}

export interface BrowserEvidenceCollectorOptions {
  readonly fetch?: typeof fetch;
  readonly transport?: EvidenceBatchTransport;
  readonly randomUUID?: () => string;
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

function acceptedEvent(event: EvidenceEventInput): EvidenceEventInput | null {
  try {
    const result = validateEvidenceEvent(event, JSON.stringify(event));
    return result.accepted ? result.event : null;
  } catch {
    return null;
  }
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

async function deliverChunk(
  dependencies: EvidenceCollectorDependencies,
  events: readonly EvidenceEventInput[]
): Promise<"delivered" | "retain"> {
  const payload: EvidenceBatchPayload = {
    batch_id: dependencies.randomUUID(),
    events
  };
  for (let attempt = 1; attempt <= EVIDENCE_MAX_SEND_ATTEMPTS; attempt += 1) {
    const outcome = await sendSafely(dependencies.transport, payload);
    if (outcome.ok) {
      return "delivered";
    }
    if (!outcome.retryable) {
      return "delivered";
    }
    if (attempt === EVIDENCE_MAX_SEND_ATTEMPTS) {
      return "retain";
    }
    await dependencies.sleep(retryDelayForAttempt(attempt, dependencies.jitter()));
  }
  return "retain";
}

export class EvidenceCollector {
  private readonly queue: EvidenceEventInput[] = [];
  private timer: unknown = null;
  private tail: Promise<void> = Promise.resolve();

  public constructor(private readonly dependencies: EvidenceCollectorDependencies) {}

  public queuedCount(): number {
    return this.queue.length;
  }

  public queuedEvents(): readonly EvidenceEventInput[] {
    return this.queue;
  }

  public emit(event: EvidenceEventInput): void {
    const accepted = acceptedEvent(event);
    if (accepted === null) {
      return;
    }
    this.queue.push(accepted);
    this.ensureTimer();
    if (this.queue.length >= EVIDENCE_QUEUE_FLUSH_THRESHOLD) {
      void this.flush();
    }
  }

  public flush(): Promise<void> {
    const run = this.tail.then(() => this.flushOwnedQueue());
    this.tail = run.then(() => undefined, () => undefined);
    return this.tail;
  }

  private ensureTimer(): void {
    if (this.timer !== null || this.queue.length === 0) {
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
    while (this.queue.length > 0) {
      const chunk = this.queue.slice(0, EVIDENCE_LIMITS.batchEvents);
      const result = await deliverChunk(this.dependencies, chunk);
      if (result === "retain") {
        this.ensureTimer();
        return;
      }
      this.queue.splice(0, chunk.length);
    }
  }
}

export function createBrowserEvidenceCollector(
  options: BrowserEvidenceCollectorOptions = {}
): EvidenceCollector {
  return new EvidenceCollector({
    transport: options.transport ?? createBrowserEvidenceBatchTransport(options.fetch),
    randomUUID: options.randomUUID ?? (() => globalThis.crypto.randomUUID()),
    sleep: options.sleep ?? defaultSleep,
    jitter: options.jitter ?? (() => Math.random()),
    scheduler: options.scheduler ?? createBrowserEvidenceCollectorScheduler()
  });
}
