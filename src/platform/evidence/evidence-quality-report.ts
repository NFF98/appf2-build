import { isRecord, isUuid } from "./evidence-field-schema.js";
import type { EvidenceQueueDrop, EvidenceQueueObserver } from "./evidence-observability.js";

export interface EvidenceQualityCounts {
  readonly local_queue_drop_count: number;
  readonly offline_expired_event_count: number;
}

// F07-API-001 quality_report: a bounded, non-identifying queue-quality delta. It is not a Product
// Event, never enters the Evidence Registry and never creates an F07-EVT-*.
export interface EvidenceQualityReport extends EvidenceQualityCounts {
  readonly report_id: string;
}

const QUALITY_REPORT_KEYS: ReadonlySet<string> = new Set([
  "report_id",
  "local_queue_drop_count",
  "offline_expired_event_count"
]);

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

// Exactly the three canonical fields; both counts non-negative safe integers and at least one > 0.
export function parseEvidenceQualityReport(value: unknown): EvidenceQualityReport | null {
  if (!isRecord(value) || Object.keys(value).some(key => !QUALITY_REPORT_KEYS.has(key))) {
    return null;
  }
  const { report_id: reportId, local_queue_drop_count: drops, offline_expired_event_count: expired } = value;
  if (!isUuid(reportId) || !isNonNegativeSafeInteger(drops) || !isNonNegativeSafeInteger(expired)) {
    return null;
  }
  if (drops === 0 && expired === 0) {
    return null;
  }
  return Object.freeze({
    report_id: reportId,
    local_queue_drop_count: drops,
    offline_expired_event_count: expired
  });
}

const QUALITY_ONLY_ENVELOPE_BYTES = new TextEncoder().encode(
  JSON.stringify({ batch_id: "00000000-0000-4000-8000-000000000000", events: [] })
).byteLength;

// Bytes the report adds to a serialized batch request: `,"quality_report":{...}`.
export function qualityReportRequestBytes(report: EvidenceQualityReport): number {
  return new TextEncoder().encode(`,"quality_report":${JSON.stringify(report)}`).byteLength;
}

// Bytes of a serialized quality-only request (`events: []`) carrying the report.
export function qualityOnlyRequestBytes(report: EvidenceQualityReport): number {
  return QUALITY_ONLY_ENVELOPE_BYTES + qualityReportRequestBytes(report);
}

// sealedAt is local storage metadata used only to order pending reports; it is never transmitted.
export interface SealedEvidenceQualityReport {
  readonly report: EvidenceQualityReport;
  readonly sealedAt: number;
}

// Durable browser copy of not yet acknowledged quality counts, shared by every page on the origin:
// at most one unsealed report, never transmitted, whose counts may still grow, plus a bounded set
// of sealed reports whose report_id and counts never change. Each operation is atomic; a rejected
// promise means durable storage failed and nothing was changed.
export interface EvidenceQualityReportStore {
  // Valid sealed reports in deterministic seal order.
  load(): Promise<readonly SealedEvidenceQualityReport[]>;
  // Adds the counts to the unsealed report, created under newReportId() when there is none.
  accumulate(counts: EvidenceQualityCounts, newReportId: () => string): Promise<void>;
  // Moves the unsealed report, report_id and counts unchanged, into a sealed slot when one is free;
  // otherwise it stays unsealed. Returns every sealed report in seal order.
  seal(sealedAt: number): Promise<readonly SealedEvidenceQualityReport[]>;
  remove(reportId: string): Promise<void>;
}

export function compareSealOrder(left: SealedEvidenceQualityReport, right: SealedEvidenceQualityReport): number {
  if (left.sealedAt !== right.sealedAt) {
    return left.sealedAt - right.sealedAt;
  }
  if (left.report.report_id === right.report.report_id) {
    return 0;
  }
  return left.report.report_id < right.report.report_id ? -1 : 1;
}

export function addQualityCounts<T extends EvidenceQualityCounts>(base: T, added: EvidenceQualityCounts): T {
  return {
    ...base,
    local_queue_drop_count: Math.min(base.local_queue_drop_count + added.local_queue_drop_count, Number.MAX_SAFE_INTEGER),
    offline_expired_event_count: Math.min(
      base.offline_expired_event_count + added.offline_expired_event_count,
      Number.MAX_SAFE_INTEGER
    )
  };
}

function saturatingIncrement(count: number): number {
  return Math.min(count + 1, Number.MAX_SAFE_INTEGER);
}

// Browser-side accumulation of F07-ERR-011 (local queue drop) and F07-ERR-012 (offline expiry)
// since the last confirmed HTTP 2xx acknowledge. A sealed report keeps its report_id and counts
// until a confirmed 2xx acknowledges it; a sendBeacon handoff or a non-2xx response never does.
// Drops observed after sealing go into the next delta.
//
// Durable mode (a working store): every observed drop is committed to the store's unsealed report
// as soon as it is observed, and sealing is an atomic move inside the store during a normal flush,
// so a terminal handoff starts no storage work and never holds the only copy of any count. Pages
// sharing the store may send the same sealed report, which the server dedupes by report_id.
// Memory mode (no store, or after a storage failure): counts and sealed reports live in this page.
export class EvidenceQualityReportLedger implements EvidenceQueueObserver {
  private pending: SealedEvidenceQualityReport[] = [];
  // Durable mode: observed but not yet committed to the store. Memory mode: not yet sealed.
  private localQueueDrops = 0;
  private offlineExpired = 0;
  private durable: EvidenceQualityReportStore | null;
  private commitScheduled = false;
  private storageWork: Promise<void> = Promise.resolve();
  private readonly restoration: Promise<void>;

  public constructor(
    private readonly randomUUID: () => string,
    private readonly store: EvidenceQualityReportStore | null = null,
    private readonly now: () => number = () => Date.now()
  ) {
    this.durable = store;
    this.restoration = store === null ? Promise.resolve() : this.serialize(() => this.restoreFrom(store));
  }

  public observeQueueDrop(drop: EvidenceQueueDrop): void {
    if (drop.code === "F07-ERR-011") {
      this.localQueueDrops = saturatingIncrement(this.localQueueDrops);
    } else {
      this.offlineExpired = saturatingIncrement(this.offlineExpired);
    }
    this.scheduleCommit();
  }

  // Resolves once reports persisted by earlier pages were merged (or could not be read).
  public restored(): Promise<void> {
    return this.restoration;
  }

  // Resolves once durable work issued so far has settled.
  public async settled(): Promise<void> {
    let observed: Promise<void>;
    do {
      observed = this.storageWork;
      await observed;
    } while (observed !== this.storageWork);
  }

  // The oldest pending report for the next request. Memory mode seals the accumulated delta here
  // when nothing is pending; durable mode seals only in prepare().
  public current(): EvidenceQualityReport | null {
    if (this.durable === null && this.pending.length === 0) {
      this.sealInMemory();
    }
    return this.pending[0]?.report ?? null;
  }

  // Durable mode, before a normal flush reads current(): when nothing is pending here, committed
  // counts are sealed in the store (if a sealed slot is free) and every report the store holds
  // sealed, including other pages', becomes pending here. Never rejects.
  public prepare(): Promise<void> {
    return this.serialize(async () => {
      const store = this.durable;
      if (store === null || this.pending.length > 0) {
        return;
      }
      await this.commit(store);
      this.pending = [...await store.seal(this.now())];
    });
  }

  // Terminal handoff, synchronous: every pending report, oldest first. Durable mode hands off only
  // reports already sealed in the store and starts no storage work; counts not yet sealed are
  // already in the store's unsealed report and are sealed by a later normal flush. Memory mode
  // seals the delta first, since this page holds its only copy.
  public handoffReports(): readonly EvidenceQualityReport[] {
    if (this.durable === null) {
      this.sealInMemory();
    }
    return this.pending.map(sealed => sealed.report);
  }

  // Only for a confirmed HTTP 2xx canonical response to a request that carried this report.
  public acknowledge(report: EvidenceQualityReport): void {
    const index = this.pending.findIndex(sealed => sealed.report.report_id === report.report_id);
    if (index === -1) {
      return;
    }
    this.pending.splice(index, 1);
    const store = this.store;
    if (store !== null) {
      void this.serialize(() => store.remove(report.report_id));
    }
  }

  private scheduleCommit(): void {
    if (this.durable === null || this.commitScheduled) {
      return;
    }
    this.commitScheduled = true;
    void this.serialize(async () => {
      this.commitScheduled = false;
      const store = this.durable;
      if (store !== null) {
        await this.commit(store);
      }
    });
  }

  // Counts leave memory only once the store has committed them.
  private async commit(store: EvidenceQualityReportStore): Promise<void> {
    const counts: EvidenceQualityCounts = {
      local_queue_drop_count: this.localQueueDrops,
      offline_expired_event_count: this.offlineExpired
    };
    if (counts.local_queue_drop_count === 0 && counts.offline_expired_event_count === 0) {
      return;
    }
    await store.accumulate(counts, () => this.randomUUID());
    this.localQueueDrops -= counts.local_queue_drop_count;
    this.offlineExpired -= counts.offline_expired_event_count;
  }

  private sealInMemory(): void {
    if (this.localQueueDrops === 0 && this.offlineExpired === 0) {
      return;
    }
    const report = parseEvidenceQualityReport({
      report_id: this.randomUUID(),
      local_queue_drop_count: this.localQueueDrops,
      offline_expired_event_count: this.offlineExpired
    });
    if (report === null) {
      return;
    }
    this.pending.push(Object.freeze({ report, sealedAt: this.now() }));
    this.localQueueDrops = 0;
    this.offlineExpired = 0;
  }

  private async restoreFrom(store: EvidenceQualityReportStore): Promise<void> {
    const persisted = await store.load();
    const known = new Set(this.pending.map(sealed => sealed.report.report_id));
    const restored = persisted.filter(sealed => !known.has(sealed.report.report_id));
    this.pending = [...restored, ...this.pending].sort(compareSealOrder);
  }

  // A storage failure switches this page to memory mode; counts the store never committed are
  // still in memory, so nothing is lost or counted twice.
  private serialize(operation: () => Promise<void>): Promise<void> {
    const run = this.storageWork.then(operation).then(undefined, () => {
      this.durable = null;
    });
    this.storageWork = run;
    return run;
  }
}
