// F07-POL-009 / INFRA §11.1: every Evidence source row is retained 90 days from first durable
// received_at.
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

export const EVIDENCE_RETENTION_SOURCE_CLASSES = Object.freeze([
  "product_event",
  "evidence_intake_observation",
  "evidence_client_quality_report"
] as const);

export type EvidenceRetentionSourceClass = typeof EVIDENCE_RETENTION_SOURCE_CLASSES[number];

// DATA-MODEL §6.11 rule 8: each source class owns exactly these metrics; a source row may only be
// deleted once every metric its own class owns covers the row's bucket.
export const EVIDENCE_SOURCE_OWNED_METRIC_KEYS: Readonly<
  Record<EvidenceRetentionSourceClass, readonly EvidenceAggregateMetricKey[]>
> = Object.freeze({
  product_event: Object.freeze(["event_count", "clock_invalid_rate"] as const),
  evidence_intake_observation: Object.freeze([
    "event_batch_accept_rate",
    "event_rejection_rate",
    "duplicate_retry_rate",
    "unknown_event_type_count"
  ] as const),
  evidence_client_quality_report: Object.freeze([
    "local_queue_drop_count",
    "offline_expired_event_count"
  ] as const)
});

export const EVIDENCE_RAW_DERIVED_METRIC_KEYS = EVIDENCE_SOURCE_OWNED_METRIC_KEYS.product_event;

// DATA-MODEL §6.11 rule 4: rate = numerator / denominator; a count metric (NULL denominator) or a
// zero denominator never yields a percentage.
export function evidenceAggregateRate(numeratorCount: number, denominatorCount: number | null): number | null {
  return denominatorCount === null || denominatorCount === 0 ? null : numeratorCount / denominatorCount;
}

export interface EvidenceRetentionWindow {
  readonly cutoffReceivedAt: string;
  readonly maintenanceNow: string;
  readonly policyVersion: string;
}

// Each step is one atomic, idempotent unit over a single source class. materialize must never add
// a source row to an aggregate whose watermark already covers that row's received_at; delete must
// only remove rows with received_at < cutoff that every metric owned by this source class covers.
export interface EvidenceRetentionSourceRepository {
  readonly sourceClass: EvidenceRetentionSourceClass;
  materializeEligibleAggregates(window: EvidenceRetentionWindow): Promise<void>;
  verifyAggregateWatermark(window: EvidenceRetentionWindow): Promise<boolean>;
  deleteEligibleSourceRows(window: EvidenceRetentionWindow): Promise<number>;
}

export type EvidenceRetentionStage = "MATERIALIZE" | "VERIFY" | "DELETE";

export interface EvidenceRetentionFailure {
  readonly source_class: EvidenceRetentionSourceClass;
  readonly stage: EvidenceRetentionStage;
  readonly cutoff_received_at: string;
  readonly error: unknown;
}

// Operational alert / retry path; a failed run never blocks Consumer product flow.
export interface EvidenceRetentionDiagnostics {
  reportMaintenanceFailure(failure: EvidenceRetentionFailure): void;
}

export interface EvidenceRetentionMaintenanceDependencies {
  readonly sources: readonly EvidenceRetentionSourceRepository[];
  readonly diagnostics: EvidenceRetentionDiagnostics;
  readonly now: () => Date;
}

export type EvidenceRetentionSourceResult =
  | {
      readonly source_class: EvidenceRetentionSourceClass;
      readonly status: "COMPLETED";
      readonly deleted_rows: number;
    }
  | {
      readonly source_class: EvidenceRetentionSourceClass;
      readonly status: "FAILED_CLOSED";
      readonly stage: EvidenceRetentionStage;
      readonly deleted_rows: 0;
    };

export interface EvidenceRetentionRunResult {
  readonly status: "COMPLETED" | "FAILED_CLOSED";
  readonly maintenance_now: string;
  readonly cutoff_received_at: string;
  readonly sources: readonly EvidenceRetentionSourceResult[];
}

export class AggregateWatermarkNotCoveredError extends Error {
  public constructor(sourceClass: EvidenceRetentionSourceClass, cutoffReceivedAt: string) {
    super(`evidence_daily_aggregate watermark for ${sourceClass} does not cover retention cutoff ${cutoffReceivedAt}`);
    this.name = "AggregateWatermarkNotCoveredError";
  }
}

export class EvidenceRetentionWiringError extends Error {
  public constructor(reason: string) {
    super(`EvidenceRetentionMaintenance wiring is incomplete: ${reason}`);
    this.name = "EvidenceRetentionWiringError";
  }
}

export function rawRetentionCutoff(maintenanceNow: Date): Date {
  return new Date(maintenanceNow.getTime() - EVIDENCE_RAW_RETENTION_DAYS * DAY_MS);
}

// Exactly one repository per canonical source class, in canonical order.
function orderedSources(
  sources: readonly EvidenceRetentionSourceRepository[]
): readonly EvidenceRetentionSourceRepository[] {
  return EVIDENCE_RETENTION_SOURCE_CLASSES.map(sourceClass => {
    const [only, ...extra] = sources.filter(source => source.sourceClass === sourceClass);
    if (only === undefined || extra.length > 0) {
      throw new EvidenceRetentionWiringError(`expected exactly one ${sourceClass} source`);
    }
    return only;
  });
}

// Semantic owner of Evidence retention. A provider scheduler only decides when run() is called.
// Source classes run independently: one class failing closed neither blocks nor vouches for another.
export class EvidenceRetentionMaintenance {
  private readonly sources: readonly EvidenceRetentionSourceRepository[];

  public constructor(private readonly dependencies: EvidenceRetentionMaintenanceDependencies) {
    if (dependencies.sources.length !== EVIDENCE_RETENTION_SOURCE_CLASSES.length) {
      throw new EvidenceRetentionWiringError(`expected ${EVIDENCE_RETENTION_SOURCE_CLASSES.length} sources`);
    }
    this.sources = orderedSources(dependencies.sources);
  }

  public async run(): Promise<EvidenceRetentionRunResult> {
    const now = this.dependencies.now();
    const window: EvidenceRetentionWindow = {
      cutoffReceivedAt: rawRetentionCutoff(now).toISOString(),
      maintenanceNow: now.toISOString(),
      policyVersion: EVIDENCE_AGGREGATE_POLICY_VERSION
    };
    const results: EvidenceRetentionSourceResult[] = [];
    for (const source of this.sources) {
      results.push(await this.runSource(source, window));
    }
    return {
      status: results.every(result => result.status === "COMPLETED") ? "COMPLETED" : "FAILED_CLOSED",
      maintenance_now: window.maintenanceNow,
      cutoff_received_at: window.cutoffReceivedAt,
      sources: results
    };
  }

  private async runSource(
    source: EvidenceRetentionSourceRepository,
    window: EvidenceRetentionWindow
  ): Promise<EvidenceRetentionSourceResult> {
    let stage: EvidenceRetentionStage = "MATERIALIZE";
    try {
      await source.materializeEligibleAggregates(window);
      stage = "VERIFY";
      if (!(await source.verifyAggregateWatermark(window))) {
        throw new AggregateWatermarkNotCoveredError(source.sourceClass, window.cutoffReceivedAt);
      }
      stage = "DELETE";
      const deleted = await source.deleteEligibleSourceRows(window);
      return { source_class: source.sourceClass, status: "COMPLETED", deleted_rows: deleted };
    } catch (error: unknown) {
      this.reportFailure({
        source_class: source.sourceClass,
        stage,
        cutoff_received_at: window.cutoffReceivedAt,
        error
      });
      return { source_class: source.sourceClass, status: "FAILED_CLOSED", stage, deleted_rows: 0 };
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
