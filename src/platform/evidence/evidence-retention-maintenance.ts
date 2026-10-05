// F07-POL-009 / INFRA §11.1: raw product_event retention = 90 days from first durable received_at.
export const EVIDENCE_RAW_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export const EVIDENCE_AGGREGATE_POLICY_VERSION = "1.0.0";

// DATA-MODEL §6.11 rule 3: event count plus the F07 §42 Evidence quality counters/rates.
export const EVIDENCE_AGGREGATE_METRIC_KEYS = Object.freeze([
  "event_count",
  "event_batch_accept_rate",
  "event_rejection_rate",
  "duplicate_retry_rate",
  "local_queue_drop_count",
  "offline_expired_event_count",
  "unknown_event_type_count",
  "clock_invalid_rate"
] as const);

export type EvidenceAggregateMetricKey = typeof EVIDENCE_AGGREGATE_METRIC_KEYS[number];

// The aggregates derivable from raw product_event rows; every one must cover a raw row's
// (bucket_date, function_id, event_type) before that row may be deleted.
export const EVIDENCE_RAW_DERIVED_METRIC_KEYS: readonly EvidenceAggregateMetricKey[] = Object.freeze([
  "event_count",
  "clock_invalid_rate"
]);

export interface EvidenceRetentionWindow {
  readonly cutoffReceivedAt: string;
  readonly maintenanceNow: string;
  readonly policyVersion: string;
}

// Each step is one atomic, idempotent unit. materialize must never add a raw row to an aggregate
// whose watermark already covers that row's received_at; delete must only remove rows with
// received_at < cutoff that every raw-derived aggregate covers.
export interface EvidenceRetentionRepository {
  materializeEligibleAggregates(window: EvidenceRetentionWindow): Promise<void>;
  verifyAggregateWatermark(window: EvidenceRetentionWindow): Promise<boolean>;
  deleteEligibleRawEvents(window: EvidenceRetentionWindow): Promise<number>;
}

export type EvidenceRetentionStage = "MATERIALIZE" | "VERIFY" | "DELETE";

export interface EvidenceRetentionFailure {
  readonly stage: EvidenceRetentionStage;
  readonly cutoff_received_at: string;
  readonly error: unknown;
}

// Operational alert / retry path; a failed run never blocks Consumer product flow.
export interface EvidenceRetentionDiagnostics {
  reportMaintenanceFailure(failure: EvidenceRetentionFailure): void;
}

export interface EvidenceRetentionMaintenanceDependencies {
  readonly repository: EvidenceRetentionRepository;
  readonly diagnostics: EvidenceRetentionDiagnostics;
  readonly now: () => Date;
}

export type EvidenceRetentionRunResult =
  | {
      readonly status: "COMPLETED";
      readonly maintenance_now: string;
      readonly cutoff_received_at: string;
      readonly deleted_raw_events: number;
    }
  | {
      readonly status: "FAILED_CLOSED";
      readonly maintenance_now: string;
      readonly cutoff_received_at: string;
      readonly stage: EvidenceRetentionStage;
      readonly deleted_raw_events: 0;
    };

export class AggregateWatermarkNotCoveredError extends Error {
  public constructor(cutoffReceivedAt: string) {
    super(`evidence_daily_aggregate watermark does not cover raw retention cutoff ${cutoffReceivedAt}`);
    this.name = "AggregateWatermarkNotCoveredError";
  }
}

export function rawRetentionCutoff(maintenanceNow: Date): Date {
  return new Date(maintenanceNow.getTime() - EVIDENCE_RAW_RETENTION_DAYS * DAY_MS);
}

// Semantic owner of raw retention. A provider scheduler only decides when run() is called.
export class EvidenceRetentionMaintenance {
  public constructor(private readonly dependencies: EvidenceRetentionMaintenanceDependencies) {}

  public async run(): Promise<EvidenceRetentionRunResult> {
    const now = this.dependencies.now();
    const window: EvidenceRetentionWindow = {
      cutoffReceivedAt: rawRetentionCutoff(now).toISOString(),
      maintenanceNow: now.toISOString(),
      policyVersion: EVIDENCE_AGGREGATE_POLICY_VERSION
    };
    const { repository } = this.dependencies;
    let stage: EvidenceRetentionStage = "MATERIALIZE";
    try {
      await repository.materializeEligibleAggregates(window);
      stage = "VERIFY";
      if (!(await repository.verifyAggregateWatermark(window))) {
        throw new AggregateWatermarkNotCoveredError(window.cutoffReceivedAt);
      }
      stage = "DELETE";
      const deleted = await repository.deleteEligibleRawEvents(window);
      return {
        status: "COMPLETED",
        maintenance_now: window.maintenanceNow,
        cutoff_received_at: window.cutoffReceivedAt,
        deleted_raw_events: deleted
      };
    } catch (error: unknown) {
      this.reportFailure({ stage, cutoff_received_at: window.cutoffReceivedAt, error });
      return {
        status: "FAILED_CLOSED",
        maintenance_now: window.maintenanceNow,
        cutoff_received_at: window.cutoffReceivedAt,
        stage,
        deleted_raw_events: 0
      };
    }
  }

  private reportFailure(failure: EvidenceRetentionFailure): void {
    try {
      this.dependencies.diagnostics.reportMaintenanceFailure(failure);
    } catch {
      return;
    }
  }
}
