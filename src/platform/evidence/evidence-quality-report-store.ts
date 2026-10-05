import { isRecord } from "./evidence-field-schema.js";
import {
  addQualityCounts,
  compareSealOrder,
  parseEvidenceQualityReport,
  type EvidenceQualityReport,
  type EvidenceQualityReportStore,
  type SealedEvidenceQualityReport
} from "./evidence-quality-report.js";
import {
  evidenceIdbConnection,
  type EvidenceIdbDatabase,
  type EvidenceIdbFactory,
  type EvidenceIdbObjectStore,
  type EvidenceIdbSchema
} from "./evidence-queue-store.js";

// Separate from the event queue database so the queue schema and its upgrade path stay untouched.
export const EVIDENCE_QUALITY_REPORT_DATABASE = Object.freeze({
  name: "appf2.evidence.quality",
  version: 2,
  reportStore: "reports",
  unsealedStore: "unsealed"
});

// Bound on sealed reports. While every slot is taken new counts keep accumulating in the single
// unsealed report, which is sealed once an acknowledge frees a slot, so storage never exceeds this
// many sealed records plus one unsealed record.
export const EVIDENCE_QUALITY_REPORT_STORE_LIMIT = 32;

const QUALITY_REPORT_SCHEMA: EvidenceIdbSchema = Object.freeze({
  name: EVIDENCE_QUALITY_REPORT_DATABASE.name,
  version: EVIDENCE_QUALITY_REPORT_DATABASE.version,
  storeNames: Object.freeze([EVIDENCE_QUALITY_REPORT_DATABASE.reportStore, EVIDENCE_QUALITY_REPORT_DATABASE.unsealedStore]),
  keyPath: "report_id"
});

// Exactly the non-identifying report fields plus the local seal-order metadata.
interface StoredQualityReport {
  readonly report_id: string;
  readonly local_queue_drop_count: number;
  readonly offline_expired_event_count: number;
  readonly sealed_at: number;
}

interface QualityStores {
  readonly reports: EvidenceIdbObjectStore;
  readonly unsealed: EvidenceIdbObjectStore;
}

function toStored({ report, sealedAt }: SealedEvidenceQualityReport): StoredQualityReport {
  return {
    report_id: report.report_id,
    local_queue_drop_count: report.local_queue_drop_count,
    offline_expired_event_count: report.offline_expired_event_count,
    sealed_at: sealedAt
  };
}

function toUnsealed(report: EvidenceQualityReport): EvidenceQualityReport {
  return {
    report_id: report.report_id,
    local_queue_drop_count: report.local_queue_drop_count,
    offline_expired_event_count: report.offline_expired_event_count
  };
}

function parseStored(value: unknown): SealedEvidenceQualityReport | null {
  if (!isRecord(value)) {
    return null;
  }
  const { sealed_at: sealedAt, ...fields } = value;
  const report = parseEvidenceQualityReport(fields);
  return report !== null && typeof sealedAt === "number" && Number.isFinite(sealedAt)
    ? Object.freeze({ report, sealedAt })
    : null;
}

function storedKey(value: unknown): string | null {
  return isRecord(value) && typeof value.report_id === "string" ? value.report_id : null;
}

function transact<T>(
  database: EvidenceIdbDatabase,
  work: (stores: QualityStores, finish: (value: T) => void) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    let outcome: { readonly value: T } | null = null;
    const transaction = database.transaction(
      [EVIDENCE_QUALITY_REPORT_DATABASE.reportStore, EVIDENCE_QUALITY_REPORT_DATABASE.unsealedStore],
      "readwrite"
    );
    transaction.oncomplete = () => {
      if (outcome === null) {
        reject(new Error("Evidence quality report transaction completed without a result."));
      } else {
        resolve(outcome.value);
      }
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new DOMException("Evidence quality report transaction aborted.", "AbortError"));
    };
    work(
      {
        reports: transaction.objectStore(EVIDENCE_QUALITY_REPORT_DATABASE.reportStore),
        unsealed: transaction.objectStore(EVIDENCE_QUALITY_REPORT_DATABASE.unsealedStore)
      },
      value => {
        outcome = { value };
      }
    );
  });
}

// Malformed records are deleted inside the caller's transaction before it decides.
function readSealed(
  reports: EvidenceIdbObjectStore,
  then: (valid: SealedEvidenceQualityReport[]) => void
): void {
  const request = reports.getAll();
  request.onsuccess = () => {
    const valid: SealedEvidenceQualityReport[] = [];
    for (const value of request.result) {
      const sealed = parseStored(value);
      const key = storedKey(value);
      if (sealed !== null) {
        valid.push(sealed);
      } else if (key !== null) {
        reports.delete(key);
      }
    }
    then(valid);
  };
}

// Malformed records are deleted; any further valid record is folded into the first one, so at most
// one unsealed record remains and no count is lost.
function readUnsealed(
  unsealed: EvidenceIdbObjectStore,
  then: (report: EvidenceQualityReport | null) => void
): void {
  const request = unsealed.getAll();
  request.onsuccess = () => {
    let report: EvidenceQualityReport | null = null;
    let folded = false;
    for (const value of request.result) {
      const parsed = parseEvidenceQualityReport(value);
      if (parsed !== null && report === null) {
        report = parsed;
        continue;
      }
      const key = storedKey(value);
      if (key !== null) {
        unsealed.delete(key);
      }
      if (parsed !== null && report !== null) {
        report = addQualityCounts(report, parsed);
        folded = true;
      }
    }
    if (folded && report !== null) {
      unsealed.put(toUnsealed(report));
    }
    then(report);
  };
}

function sealOrdered(valid: SealedEvidenceQualityReport[]): readonly SealedEvidenceQualityReport[] {
  return valid.sort(compareSealOrder).slice(0, EVIDENCE_QUALITY_REPORT_STORE_LIMIT);
}

export function createIndexedDbEvidenceQualityReportStore(factory: EvidenceIdbFactory): EvidenceQualityReportStore {
  const database = evidenceIdbConnection(factory, QUALITY_REPORT_SCHEMA);
  return {
    async load() {
      return transact<readonly SealedEvidenceQualityReport[]>(await database(), ({ reports }, finish) => {
        readSealed(reports, valid => {
          finish(sealOrdered(valid));
        });
      });
    },
    async accumulate(counts, newReportId) {
      await transact<void>(await database(), ({ unsealed }, finish) => {
        readUnsealed(unsealed, current => {
          const next = current === null
            ? parseEvidenceQualityReport({ report_id: newReportId(), ...counts })
            : addQualityCounts(current, counts);
          if (next === null) {
            // Throwing inside a request callback aborts the transaction, so the counts stay with the caller.
            throw new Error("Evidence quality report accumulation produced no valid report.");
          }
          unsealed.put(toUnsealed(next));
          finish(undefined);
        });
      });
    },
    async seal(sealedAt) {
      return transact<readonly SealedEvidenceQualityReport[]>(await database(), (stores, finish) => {
        readSealed(stores.reports, valid => {
          readUnsealed(stores.unsealed, report => {
            if (report !== null && valid.length < EVIDENCE_QUALITY_REPORT_STORE_LIMIT) {
              const sealed: SealedEvidenceQualityReport = Object.freeze({ report: Object.freeze(report), sealedAt });
              stores.reports.put(toStored(sealed));
              stores.unsealed.delete(report.report_id);
              valid.push(sealed);
            }
            finish(sealOrdered(valid));
          });
        });
      });
    },
    async remove(reportId) {
      await transact<void>(await database(), ({ reports }, finish) => {
        reports.delete(reportId);
        finish(undefined);
      });
    }
  };
}

export function resolveBrowserEvidenceQualityReportStore(): EvidenceQualityReportStore | null {
  try {
    const factory: IDBFactory | undefined = globalThis.indexedDB;
    return factory === undefined ? null : createIndexedDbEvidenceQualityReportStore(factory);
  } catch {
    return null;
  }
}
