import {
  createBrowserEvidenceBatchTransport,
  createBrowserEvidenceBeaconTransport,
  EVIDENCE_BEACON_BUDGET_BYTES,
  isServerAcknowledged,
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
import { fanOutQueueObservers, type EvidenceQueueObserver } from "./evidence-observability.js";
import {
  EvidenceQualityReportLedger,
  qualityOnlyRequestBytes,
  qualityReportRequestBytes,
  type EvidenceQualityReport,
  type EvidenceQualityReportStore
} from "./evidence-quality-report.js";
import { resolveBrowserEvidenceQualityReportStore } from "./evidence-quality-report-store.js";
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
  // Always present at runtime: when omitted the collector owns a fresh ledger. Pass the ledger the
  // queue store reports to so durable drops reach the same quality_report.
  readonly qualityReports?: EvidenceQualityReportLedger;
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
  // The default browser queue store always reports to this ledger; an injected queueStore must be
  // created with it to contribute durable drops.
  readonly qualityReports?: EvidenceQualityReportLedger;
  // Durable copy of unacknowledged quality counts and reports for the default ledger; defaults to
  // the browser IndexedDB store.
  readonly qualityReportStore?: EvidenceQualityReportStore | null;
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

function batchPayload(
  batchId: string,
  events: readonly EvidenceEventInput[],
  report: EvidenceQualityReport | null
): EvidenceBatchPayload {
  return report === null
    ? { batch_id: batchId, events }
    : { batch_id: batchId, events, quality_report: report };
}

// Quality observation must never change event delivery, so a failure to seal a report only means
// this request (or handoff) carries none.
function currentQualityReport(reports: EvidenceQualityReportLedger): EvidenceQualityReport | null {
  try {
    return reports.current();
  } catch {
    return null;
  }
}

function handoffQualityReports(reports: EvidenceQualityReportLedger): readonly EvidenceQualityReport[] {
  try {
    return reports.handoffReports();
  } catch {
    return [];
  }
}

// An empty batch is a quality-only request. The report is captured once, so every retry of the
// chunk resends the identical report_id and counts. Only a confirmed HTTP 2xx acknowledges it; a
// non-retryable refusal ends delivery of the chunk's events but leaves the report pending.
async function deliverChunk(
  dependencies: EvidenceCollectorDependencies,
  queue: EvidenceClientQueue,
  batch: readonly QueuedEvidenceRecord[],
  reports: EvidenceQualityReportLedger
): Promise<"dequeue" | "retain"> {
  const batchId = dependencies.randomUUID();
  let report = currentQualityReport(reports);
  let pending: readonly QueuedEvidenceRecord[] = batch;
  for (let attempt = 1; attempt <= EVIDENCE_MAX_SEND_ATTEMPTS; attempt += 1) {
    if (batch.length > 0) {
      const sendable = await queue.sendable(pending);
      if (sendable === null) {
        return "retain";
      }
      pending = sendable;
      if (pending.length === 0) {
        return "dequeue";
      }
    } else if (report === null) {
      return "dequeue";
    }
    const outcome = await sendSafely(
      dependencies.transport,
      batchPayload(batchId, batchEvents(pending), report)
    );
    if (report !== null && isServerAcknowledged(outcome)) {
      reports.acknowledge(report);
      report = null;
    }
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
  private readonly qualityReports: EvidenceQualityReportLedger;
  private timer: unknown = null;
  private tail: Promise<void> = Promise.resolve();

  public constructor(private readonly dependencies: EvidenceCollectorDependencies) {
    this.qualityReports = dependencies.qualityReports ?? new EvidenceQualityReportLedger(dependencies.randomUUID);
    this.queue = new EvidenceClientQueue(
      dependencies.queueStore,
      dependencies.now,
      fanOutQueueObservers([this.qualityReports, dependencies.observer ?? null])
    );
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
  // Quality reports are handed off as already held (see EvidenceQualityReportLedger.handoffReports);
  // no storage work starts here. The oldest pending quality_report rides on the first beacon and
  // every other pending report follows alone, all inside the same budget. No handoff acknowledges a
  // report, so a later normal flush (of this or a later page) resends the same report_id.
  public flushOnPageHide(): void {
    try {
      const records = this.queue.terminalHandoffRecords();
      const [first = null, ...others] = handoffQualityReports(this.qualityReports);
      const reservedBytes = (first === null ? 0 : qualityReportRequestBytes(first)) +
        others.reduce((sum, report) => sum + qualityOnlyRequestBytes(report), 0);
      let carried = first;
      for (const batch of beaconBoundedBatches(records, EVIDENCE_BEACON_BUDGET_BYTES - reservedBytes)) {
        if (!this.dispatchBeacon(batchEvents(batch), carried)) {
          return;
        }
        carried = null;
        this.queue.remove(batch);
      }
      for (const report of carried === null ? others : [carried, ...others]) {
        if (!this.dispatchBeacon([], report)) {
          return;
        }
      }
    } catch {
      return;
    }
  }

  private dispatchBeacon(events: readonly EvidenceEventInput[], report: EvidenceQualityReport | null): boolean {
    return this.dependencies.beaconTransport.dispatch(batchPayload(this.dependencies.randomUUID(), events, report));
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

  private reservedReportBytes(): number {
    const report = currentQualityReport(this.qualityReports);
    return report === null ? 0 : qualityReportRequestBytes(report);
  }

  // nextBatch purges expired records first, which can seal a new report the chunk must leave room for.
  private nextChunk(): QueuedEvidenceRecord[] {
    const reserved = this.reservedReportBytes();
    const batch = this.queue.nextBatch(reserved);
    const resealed = this.reservedReportBytes();
    return resealed === reserved ? batch : this.queue.nextBatch(resealed);
  }

  // The oldest pending quality_report rides on each event chunk until one acknowledges it; reports
  // still pending once every event chunk is delivered are sent alone.
  private async flushOwnedQueue(): Promise<void> {
    this.clearTimer();
    await this.queue.settled();
    for (;;) {
      await this.qualityReports.prepare();
      const batch = this.nextChunk();
      if (batch.length === 0) {
        break;
      }
      const result = await deliverChunk(this.dependencies, this.queue, batch, this.qualityReports);
      if (result === "retain") {
        this.ensureTimer();
        return;
      }
      this.queue.remove(batch);
    }
    await this.flushQualityReports();
  }

  // Oldest first; stops at the first report left unacknowledged, which waits for a later flush.
  private async flushQualityReports(): Promise<void> {
    await this.qualityReports.prepare();
    for (let report = currentQualityReport(this.qualityReports); report !== null;) {
      await deliverChunk(this.dependencies, this.queue, [], this.qualityReports);
      await this.qualityReports.prepare();
      const next = currentQualityReport(this.qualityReports);
      if (next === report) {
        return;
      }
      report = next;
    }
  }
}

export function createBrowserEvidenceCollector(
  options: BrowserEvidenceCollectorOptions = {}
): EvidenceCollector {
  const observer = options.observer ?? null;
  const randomUUID = options.randomUUID ?? (() => globalThis.crypto.randomUUID());
  const now = options.now ?? (() => Date.now());
  const qualityReports = options.qualityReports ?? new EvidenceQualityReportLedger(
    randomUUID,
    options.qualityReportStore === undefined ? resolveBrowserEvidenceQualityReportStore() : options.qualityReportStore,
    now
  );
  return new EvidenceCollector({
    transport: options.transport ?? createBrowserEvidenceBatchTransport(options.fetch),
    beaconTransport: options.beaconTransport ?? createBrowserEvidenceBeaconTransport(),
    queueStore: options.queueStore === undefined
      ? resolveBrowserEvidenceQueueStore(fanOutQueueObservers([qualityReports, observer]))
      : options.queueStore,
    randomUUID,
    now,
    sleep: options.sleep ?? defaultSleep,
    jitter: options.jitter ?? (() => Math.random()),
    scheduler: options.scheduler ?? createBrowserEvidenceCollectorScheduler(),
    observer,
    qualityReports
  });
}
