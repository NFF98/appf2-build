import type {
  EvidenceQualityCounts,
  EvidenceQualityReportStore,
  SealedEvidenceQualityReport
} from "../../src/platform/evidence/evidence-quality-report.js";
import { EVIDENCE_QUALITY_REPORT_DATABASE } from "../../src/platform/evidence/evidence-quality-report-store.js";
import type { FakeIndexedDbFactory } from "./evidence-fake-indexeddb.js";

export function sealedQualityRecords(factory: FakeIndexedDbFactory): Map<string, unknown> {
  return factory.database(EVIDENCE_QUALITY_REPORT_DATABASE.name).records(EVIDENCE_QUALITY_REPORT_DATABASE.reportStore);
}

export function unsealedQualityRecords(factory: FakeIndexedDbFactory): Map<string, unknown> {
  return factory.database(EVIDENCE_QUALITY_REPORT_DATABASE.name).records(EVIDENCE_QUALITY_REPORT_DATABASE.unsealedStore);
}

// One page's view of the shared durable quality store. terminate() models the page being torn
// down: its later calls never reach storage and never settle, so only what it committed while it
// was alive survives for a later page.
export class PageQualityReportStore implements EvidenceQualityReportStore {
  public calls = 0;
  public inFlight = 0;
  private terminated = false;

  public constructor(private readonly shared: EvidenceQualityReportStore) {}

  public terminate(): void {
    this.terminated = true;
  }

  public load(): Promise<readonly SealedEvidenceQualityReport[]> {
    return this.track(() => this.shared.load());
  }

  public accumulate(counts: EvidenceQualityCounts, newReportId: () => string): Promise<void> {
    return this.track(() => this.shared.accumulate(counts, newReportId));
  }

  public seal(sealedAt: number): Promise<readonly SealedEvidenceQualityReport[]> {
    return this.track(() => this.shared.seal(sealedAt));
  }

  public remove(reportId: string): Promise<void> {
    return this.track(() => this.shared.remove(reportId));
  }

  private async track<T>(operation: () => Promise<T>): Promise<T> {
    this.calls += 1;
    if (this.terminated) {
      return new Promise<T>(() => undefined);
    }
    this.inFlight += 1;
    try {
      return await operation();
    } finally {
      this.inFlight -= 1;
    }
  }
}
