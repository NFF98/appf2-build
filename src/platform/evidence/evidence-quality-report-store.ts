import { isRecord } from "./evidence-field-schema.js";
import {
  compareSealOrder,
  parseEvidenceQualityReport,
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
  version: 1,
  reportStore: "reports"
});

// Pending reports are sealed only when nothing older is pending or at a terminal handoff, so a
// small fixed bound is never reached in normal operation; a report refused by it stays pending in
// memory and is still sent by its page.
export const EVIDENCE_QUALITY_REPORT_STORE_LIMIT = 32;

const QUALITY_REPORT_SCHEMA: EvidenceIdbSchema = Object.freeze({
  name: EVIDENCE_QUALITY_REPORT_DATABASE.name,
  version: EVIDENCE_QUALITY_REPORT_DATABASE.version,
  storeNames: Object.freeze([EVIDENCE_QUALITY_REPORT_DATABASE.reportStore]),
  keyPath: "report_id"
});

// Exactly the non-identifying report fields plus the local seal-order metadata.
interface StoredQualityReport {
  readonly report_id: string;
  readonly local_queue_drop_count: number;
  readonly offline_expired_event_count: number;
  readonly sealed_at: number;
}

function toStored({ report, sealedAt }: SealedEvidenceQualityReport): StoredQualityReport {
  return {
    report_id: report.report_id,
    local_queue_drop_count: report.local_queue_drop_count,
    offline_expired_event_count: report.offline_expired_event_count,
    sealed_at: sealedAt
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
  work: (reports: EvidenceIdbObjectStore, finish: (value: T) => void) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    let outcome: { readonly value: T } | null = null;
    const transaction = database.transaction(EVIDENCE_QUALITY_REPORT_DATABASE.reportStore, "readwrite");
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
    work(transaction.objectStore(EVIDENCE_QUALITY_REPORT_DATABASE.reportStore), value => {
      outcome = { value };
    });
  });
}

// Malformed records are deleted inside the caller's transaction before it decides.
function readValid(
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

export function createIndexedDbEvidenceQualityReportStore(factory: EvidenceIdbFactory): EvidenceQualityReportStore {
  const database = evidenceIdbConnection(factory, QUALITY_REPORT_SCHEMA);
  return {
    async load() {
      return transact<readonly SealedEvidenceQualityReport[]>(await database(), (reports, finish) => {
        readValid(reports, valid => {
          finish(valid.sort(compareSealOrder).slice(0, EVIDENCE_QUALITY_REPORT_STORE_LIMIT));
        });
      });
    },
    async save(sealed) {
      await transact<void>(await database(), (reports, finish) => {
        readValid(reports, valid => {
          const present = valid.some(stored => stored.report.report_id === sealed.report.report_id);
          if (!present && valid.length < EVIDENCE_QUALITY_REPORT_STORE_LIMIT) {
            reports.put(toStored(sealed));
          }
          finish(undefined);
        });
      });
    },
    async remove(reportId) {
      await transact<void>(await database(), (reports, finish) => {
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
