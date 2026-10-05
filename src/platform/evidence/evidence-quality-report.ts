import { isRecord, isUuid } from "./evidence-field-schema.js";
import type { EvidenceQueueDrop, EvidenceQueueObserver } from "./evidence-observability.js";

// F07-API-001 quality_report: a bounded, non-identifying queue-quality delta. It is not a Product
// Event, never enters the Evidence Registry and never creates an F07-EVT-*.
export interface EvidenceQualityReport {
  readonly report_id: string;
  readonly local_queue_drop_count: number;
  readonly offline_expired_event_count: number;
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

// Durable browser copy of sealed, not yet acknowledged reports, shared by every page on the origin.
// Each operation is atomic; a rejected promise means durable storage failed. save() is idempotent
// on report_id and bounded; load() returns valid reports in deterministic seal order.
export interface EvidenceQualityReportStore {
  load(): Promise<readonly SealedEvidenceQualityReport[]>;
  save(sealed: SealedEvidenceQualityReport): Promise<void>;
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

function saturatingIncrement(count: number): number {
  return Math.min(count + 1, Number.MAX_SAFE_INTEGER);
}

function ignoreStorageFailure(): void {
  return;
}

// Browser-side accumulation of F07-ERR-011 (local queue drop) and F07-ERR-012 (offline expiry)
// since the last confirmed HTTP 2xx acknowledge. A sealed report keeps its report_id and counts
// until a confirmed 2xx acknowledges it; a sendBeacon handoff or a non-2xx response never does.
// Drops observed after sealing go into the next delta. Sealed reports are mirrored to the durable
// store so a later page resends the same report_id and counts after this page terminates; pages
// sharing the store may send the same report, which the server dedupes by report_id.
export class EvidenceQualityReportLedger implements EvidenceQueueObserver {
  private pending: SealedEvidenceQualityReport[] = [];
  private localQueueDrops = 0;
  private offlineExpired = 0;
  private storageWork: Promise<void> = Promise.resolve();
  private readonly restoration: Promise<void>;

  public constructor(
    private readonly randomUUID: () => string,
    private readonly store: EvidenceQualityReportStore | null = null,
    private readonly now: () => number = () => Date.now()
  ) {
    this.restoration = store === null ? Promise.resolve() : this.serialize(() => this.restoreFrom(store));
  }

  public observeQueueDrop(drop: EvidenceQueueDrop): void {
    if (drop.code === "F07-ERR-011") {
      this.localQueueDrops = saturatingIncrement(this.localQueueDrops);
    } else {
      this.offlineExpired = saturatingIncrement(this.offlineExpired);
    }
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

  // The oldest pending report for the next request; the accumulated delta is sealed only when
  // nothing is pending.
  public current(): EvidenceQualityReport | null {
    if (this.pending.length === 0) {
      this.sealDelta();
    }
    return this.pending[0]?.report ?? null;
  }

  // Terminal handoff: the accumulated delta is sealed (and persisted) even behind older pending
  // reports so it does not die with the page. Every pending report, oldest first.
  public sealForHandoff(): readonly EvidenceQualityReport[] {
    this.sealDelta();
    return this.pending.map(sealed => sealed.report);
  }

  // Only for a confirmed HTTP 2xx canonical response to a request that carried this report.
  public acknowledge(report: EvidenceQualityReport): void {
    const index = this.pending.findIndex(sealed => sealed.report.report_id === report.report_id);
    if (index === -1) {
      return;
    }
    this.pending.splice(index, 1);
    this.persist(store => store.remove(report.report_id));
  }

  private sealDelta(): void {
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
    const sealed: SealedEvidenceQualityReport = Object.freeze({ report, sealedAt: this.now() });
    this.pending.push(sealed);
    this.localQueueDrops = 0;
    this.offlineExpired = 0;
    this.persist(store => store.save(sealed));
  }

  private async restoreFrom(store: EvidenceQualityReportStore): Promise<void> {
    const persisted = await store.load();
    const known = new Set(this.pending.map(sealed => sealed.report.report_id));
    const restored = persisted.filter(sealed => !known.has(sealed.report.report_id));
    this.pending = [...restored, ...this.pending].sort(compareSealOrder);
  }

  private persist(operation: (store: EvidenceQualityReportStore) => Promise<void>): void {
    const store = this.store;
    if (store !== null) {
      void this.serialize(() => operation(store));
    }
  }

  private serialize(operation: () => Promise<void>): Promise<void> {
    const run = this.storageWork.then(operation).then(undefined, ignoreStorageFailure);
    this.storageWork = run;
    return run;
  }
}
