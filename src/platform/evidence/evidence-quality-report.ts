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

// Bytes the report adds to a serialized batch request: `,"quality_report":{...}`.
export function qualityReportRequestBytes(report: EvidenceQualityReport): number {
  return new TextEncoder().encode(`,"quality_report":${JSON.stringify(report)}`).byteLength;
}

function saturatingIncrement(count: number): number {
  return Math.min(count + 1, Number.MAX_SAFE_INTEGER);
}

// Browser-side accumulation of F07-ERR-011 (local queue drop) and F07-ERR-012 (offline expiry)
// since the last confirmed HTTP 2xx acknowledge. A sealed report is resent with the identical
// report_id and counts until it is settled; drops observed after sealing go into the next delta.
// A sendBeacon handoff never settles a report.
export class EvidenceQualityReportLedger implements EvidenceQueueObserver {
  private sealed: EvidenceQualityReport | null = null;
  private localQueueDrops = 0;
  private offlineExpired = 0;

  public constructor(private readonly randomUUID: () => string) {}

  public observeQueueDrop(drop: EvidenceQueueDrop): void {
    if (drop.code === "F07-ERR-011") {
      this.localQueueDrops = saturatingIncrement(this.localQueueDrops);
    } else {
      this.offlineExpired = saturatingIncrement(this.offlineExpired);
    }
  }

  public hasPending(): boolean {
    return this.sealed !== null || this.localQueueDrops > 0 || this.offlineExpired > 0;
  }

  // The report to attach to the next request, sealing the accumulated delta when none is sealed.
  public current(): EvidenceQualityReport | null {
    if (this.sealed === null && (this.localQueueDrops > 0 || this.offlineExpired > 0)) {
      this.sealed = Object.freeze({
        report_id: this.randomUUID(),
        local_queue_drop_count: this.localQueueDrops,
        offline_expired_event_count: this.offlineExpired
      });
      this.localQueueDrops = 0;
      this.offlineExpired = 0;
    }
    return this.sealed;
  }

  // Called once the server confirmed the report (HTTP 2xx canonical response) or definitively
  // refused the request carrying it (non-retryable); never after a beacon handoff.
  public settle(report: EvidenceQualityReport): void {
    if (this.sealed?.report_id === report.report_id) {
      this.sealed = null;
    }
  }
}
