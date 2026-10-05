import type { EvidenceQualityReport } from "./evidence-quality-report.js";
import type { EvidenceIngestionDiagnostics } from "./evidence-repository.js";
import type { EvidenceBatchResult } from "./evidence-types.js";

// DATA-MODEL §6.11A: the only bounded pre-service codes an intake observation may carry.
export type EvidenceRouteRejectionCode = "API-REQUEST-TOO-LARGE" | "F07-ERR-003" | "F07-ERR-007";

// One /api/v1/events/batch request attempt. Never carries batch_id, event/user/session/intent/
// share/trace identity, event properties or the raw request body.
export interface EvidenceIntakeObservationRow {
  readonly observation_id: string;
  readonly received_at: string;
  readonly batch_accepted: boolean;
  readonly event_received_count: number;
  readonly accepted_count: number;
  readonly duplicate_count: number;
  readonly rejected_count: number;
  readonly unknown_event_type_count: number;
  readonly route_rejection_code: EvidenceRouteRejectionCode | null;
}

export interface EvidenceClientQualityReportRow extends EvidenceQualityReport {
  readonly received_at: string;
}

export type EvidenceQualityReportWriteResult = "INSERTED" | "DUPLICATE";

// insertIntakeObservation is idempotent on observation_id. insertClientQualityReport is
// first-durable-receipt-wins on report_id: a duplicate never double counts or rewrites received_at.
export interface EvidenceQualitySourceRepository {
  insertIntakeObservation(row: EvidenceIntakeObservationRow): Promise<void>;
  insertClientQualityReport(row: EvidenceClientQualityReportRow): Promise<EvidenceQualityReportWriteResult>;
}

export interface EvidenceQualityRecorderDependencies {
  readonly repository: EvidenceQualitySourceRepository;
  readonly diagnostics: EvidenceIngestionDiagnostics;
  readonly now: () => Date;
  readonly randomUUID: () => string;
}

export interface EvidenceIngestionObservation {
  readonly batchAccepted: boolean;
  readonly eventReceivedCount: number;
  readonly result: EvidenceBatchResult;
}

const OBSERVATION_PERSIST_ATTEMPTS = 2;

function unknownEventTypeCount(result: EvidenceBatchResult): number {
  return result.rejections.filter(rejection => rejection.code === "F07-ERR-004").length;
}

// F07 §44 appf2-owned mandatory production dependency of the batch handler.
export class EvidenceQualityRecorder {
  public constructor(private readonly dependencies: EvidenceQualityRecorderDependencies) {}

  // Pre-service rejection: no canonical event candidates exist, so every event-level count is 0.
  public recordRouteRejection(code: EvidenceRouteRejectionCode): Promise<void> {
    return this.recordObservation({
      batch_accepted: false,
      event_received_count: 0,
      accepted_count: 0,
      duplicate_count: 0,
      rejected_count: 0,
      unknown_event_type_count: 0,
      route_rejection_code: code
    });
  }

  public recordIngestion(observation: EvidenceIngestionObservation): Promise<void> {
    const { result } = observation;
    return this.recordObservation({
      batch_accepted: observation.batchAccepted,
      event_received_count: observation.eventReceivedCount,
      accepted_count: result.accepted,
      duplicate_count: result.duplicates,
      rejected_count: result.rejected,
      unknown_event_type_count: unknownEventTypeCount(result),
      route_rejection_code: null
    });
  }

  // Rejects when the report could not be made durable; the caller must not confirm it with 2xx.
  public async recordClientQualityReport(report: EvidenceQualityReport): Promise<EvidenceQualityReportWriteResult> {
    try {
      return await this.dependencies.repository.insertClientQualityReport({
        report_id: report.report_id,
        local_queue_drop_count: report.local_queue_drop_count,
        offline_expired_event_count: report.offline_expired_event_count,
        received_at: this.dependencies.now().toISOString()
      });
    } catch (error: unknown) {
      this.dependencies.diagnostics.reportNonBlockingFailure(error);
      throw error;
    }
  }

  // Observation persistence never blocks intake. A retry inside this invocation reuses the same
  // observation_id so an infrastructure retry cannot double count the request attempt.
  private async recordObservation(
    counts: Omit<EvidenceIntakeObservationRow, "observation_id" | "received_at">
  ): Promise<void> {
    const row: EvidenceIntakeObservationRow = {
      observation_id: this.dependencies.randomUUID(),
      received_at: this.dependencies.now().toISOString(),
      ...counts
    };
    for (let attempt = 1; attempt <= OBSERVATION_PERSIST_ATTEMPTS; attempt += 1) {
      try {
        await this.dependencies.repository.insertIntakeObservation(row);
        return;
      } catch (error: unknown) {
        if (attempt === OBSERVATION_PERSIST_ATTEMPTS) {
          this.dependencies.diagnostics.reportNonBlockingFailure(error);
        }
      }
    }
  }
}
