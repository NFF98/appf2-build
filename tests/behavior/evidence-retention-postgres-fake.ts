import { effectiveEventAt, isClockInvalid } from "../../src/platform/evidence/evidence-clock.js";
import {
  POSTGRES_INSERT_CLIENT_QUALITY_REPORT_SQL,
  POSTGRES_INSERT_INTAKE_OBSERVATION_SQL
} from "../../src/platform/evidence/postgres-evidence-quality-repository.js";
import {
  POSTGRES_ENSURE_ANONYMOUS_IDENTITY_SQL,
  POSTGRES_INSERT_EVIDENCE_SQL,
  POSTGRES_READ_ANONYMOUS_IDENTITY_STATUS_SQL,
  POSTGRES_REFRESH_LAST_SEEN_SQL,
  type PostgresExecutor,
  type PostgresQueryResult
} from "../../src/platform/evidence/postgres-evidence-repository.js";
import {
  POSTGRES_EVIDENCE_RETENTION_STATEMENTS
} from "../../src/platform/evidence/postgres-evidence-retention-repository.js";
import type { EvidenceRetentionSourceClass } from "../../src/platform/evidence/evidence-retention-maintenance.js";

export interface StoredProductEvent {
  readonly event_id: string;
  readonly event_type: string;
  readonly function_id: string;
  readonly occurred_at: string;
  readonly received_at: string;
  readonly anonymous_id: string | null;
  readonly session_id: string | null;
  readonly intent_id: string | null;
  readonly share_id: string | null;
  readonly trace_id: string | null;
  readonly properties: unknown;
}

// Exactly the evidence_intake_observation columns created by the T008 quality-source migration.
export interface StoredIntakeObservation {
  readonly observation_id: string;
  readonly received_at: string;
  readonly batch_accepted: boolean;
  readonly event_received_count: number;
  readonly accepted_count: number;
  readonly duplicate_count: number;
  readonly rejected_count: number;
  readonly unknown_event_type_count: number;
  readonly route_rejection_code: string | null;
}

// Exactly the evidence_client_quality_report columns created by the T008 quality-source migration.
export interface StoredClientQualityReport {
  readonly report_id: string;
  readonly received_at: string;
  readonly local_queue_drop_count: number;
  readonly offline_expired_event_count: number;
}

// Exactly the evidence_daily_aggregate columns created by the T008 retention migration.
export interface StoredDailyAggregate {
  readonly aggregate_id: string;
  readonly bucket_date: string;
  readonly metric_key: string;
  readonly function_id: string | null;
  readonly event_type: string | null;
  readonly collection_class: string | null;
  numerator_count: number;
  denominator_count: number | null;
  readonly policy_version: string;
  materialized_through_received_at: string;
  updated_at: string;
}

interface AggregateDimensions {
  readonly bucket_date: string;
  readonly function_id: string | null;
  readonly event_type: string | null;
}

interface MetricDefinition<Row> {
  readonly metricKey: string;
  readonly numerator: (row: Row) => number;
  readonly denominator: ((row: Row) => number) | null;
}

interface SourceDefinition<Row extends { readonly received_at: string }> {
  readonly rows: () => Iterable<Row>;
  readonly remove: (row: Row) => void;
  readonly dimensions: (row: Row) => AggregateDimensions;
  readonly metrics: readonly MetricDefinition<Row>[];
}

interface MaterializeWindow {
  readonly cutoff: string;
  readonly policyVersion: string;
  readonly now: string;
}

interface SourceHandler {
  materialize(window: MaterializeWindow): void;
  uncoveredCount(cutoff: string, policyVersion: string, metricKeys: readonly string[]): number;
  deleteCovered(cutoff: string, policyVersion: string, metricKeys: readonly string[]): number;
}

function epoch(value: string): number {
  return Date.parse(value);
}

export function bucketDateOf(row: Pick<StoredProductEvent, "occurred_at" | "received_at">): string {
  return new Date(effectiveEventAt(row.occurred_at, row.received_at)).toISOString().slice(0, 10);
}

export function receivedBucketDateOf(row: { readonly received_at: string }): string {
  return new Date(row.received_at).toISOString().slice(0, 10);
}

function logicalKey(dimensions: AggregateDimensions, metricKey: string, policyVersion: string): string {
  return [
    dimensions.bucket_date,
    metricKey,
    dimensions.function_id ?? "",
    dimensions.event_type ?? "",
    "",
    policyVersion
  ].join("|");
}

function operationalDimensions(row: { readonly received_at: string }): AggregateDimensions {
  return { bucket_date: receivedBucketDateOf(row), function_id: null, event_type: null };
}

// Mirrors the T008 SQL: identity ensure, product_event first-insert-wins intake, the two quality
// source inserts and every source class's materialize / verify / delete retention statement.
export class FakeEvidenceRetentionPostgres implements PostgresExecutor {
  public readonly events = new Map<string, StoredProductEvent>();
  public readonly intakeObservations = new Map<string, StoredIntakeObservation>();
  public readonly clientQualityReports = new Map<string, StoredClientQualityReport>();
  public readonly identities = new Map<string, string>();
  public readonly aggregates = new Map<string, StoredDailyAggregate>();
  public readonly statements: string[] = [];
  public failNext: string | undefined;
  private aggregateSequence = 0;

  private readonly sources: Readonly<Record<EvidenceRetentionSourceClass, SourceHandler>>;

  public constructor() {
    const productEvent: SourceDefinition<StoredProductEvent> = {
      rows: () => this.events.values(),
      remove: row => { this.events.delete(row.event_id); },
      dimensions: row => ({ bucket_date: bucketDateOf(row), function_id: row.function_id, event_type: row.event_type }),
      metrics: [
        { metricKey: "event_count", numerator: () => 1, denominator: null },
        {
          metricKey: "clock_invalid_rate",
          numerator: row => isClockInvalid(row.occurred_at, row.received_at) ? 1 : 0,
          denominator: () => 1
        }
      ]
    };
    const intake: SourceDefinition<StoredIntakeObservation> = {
      rows: () => this.intakeObservations.values(),
      remove: row => { this.intakeObservations.delete(row.observation_id); },
      dimensions: operationalDimensions,
      metrics: [
        { metricKey: "event_batch_accept_rate", numerator: row => row.batch_accepted ? 1 : 0, denominator: () => 1 },
        { metricKey: "event_rejection_rate", numerator: row => row.rejected_count, denominator: row => row.event_received_count },
        { metricKey: "duplicate_retry_rate", numerator: row => row.duplicate_count, denominator: row => row.event_received_count },
        { metricKey: "unknown_event_type_count", numerator: row => row.unknown_event_type_count, denominator: null }
      ]
    };
    const reports: SourceDefinition<StoredClientQualityReport> = {
      rows: () => this.clientQualityReports.values(),
      remove: row => { this.clientQualityReports.delete(row.report_id); },
      dimensions: operationalDimensions,
      metrics: [
        { metricKey: "local_queue_drop_count", numerator: row => row.local_queue_drop_count, denominator: null },
        { metricKey: "offline_expired_event_count", numerator: row => row.offline_expired_event_count, denominator: null }
      ]
    };
    this.sources = {
      product_event: this.handler(productEvent),
      evidence_intake_observation: this.handler(intake),
      evidence_client_quality_report: this.handler(reports)
    };
  }

  private handler<Row extends { readonly received_at: string }>(source: SourceDefinition<Row>): SourceHandler {
    return {
      materialize: window => { this.materialize(source, window); },
      uncoveredCount: (cutoff, policyVersion, metricKeys) =>
        this.uncovered(source, cutoff, policyVersion, metricKeys).length,
      deleteCovered: (cutoff, policyVersion, metricKeys) =>
        this.deleteCovered(source, cutoff, policyVersion, metricKeys)
    };
  }

  public async query<Row>(statement: string, parameters: readonly unknown[]): Promise<PostgresQueryResult<Row>> {
    this.statements.push(statement);
    if (this.failNext === statement) {
      this.failNext = undefined;
      throw new Error("simulated database failure");
    }
    return { rows: this.execute(statement, parameters) as Row[] };
  }

  public aggregateRows(): StoredDailyAggregate[] {
    return [...this.aggregates.values()];
  }

  public executed(statement: string): number {
    return this.statements.filter(executed => executed === statement).length;
  }

  private execute(statement: string, parameters: readonly unknown[]): readonly unknown[] {
    switch (statement) {
      case POSTGRES_ENSURE_ANONYMOUS_IDENTITY_SQL:
        return this.ensureIdentity(parameters[0] as string);
      case POSTGRES_READ_ANONYMOUS_IDENTITY_STATUS_SQL:
        return [{ status: this.identities.get(parameters[0] as string) }];
      case POSTGRES_REFRESH_LAST_SEEN_SQL:
        return [];
      case POSTGRES_INSERT_EVIDENCE_SQL:
        return [{ outcome: this.insertEvent(parameters) }];
      case POSTGRES_INSERT_INTAKE_OBSERVATION_SQL:
        this.insertIntakeObservation(parameters);
        return [];
      case POSTGRES_INSERT_CLIENT_QUALITY_REPORT_SQL:
        return [{ outcome: this.insertClientQualityReport(parameters) }];
      default:
        return this.executeRetention(statement, parameters);
    }
  }

  private executeRetention(statement: string, parameters: readonly unknown[]): readonly unknown[] {
    for (const [sourceClass, statements] of Object.entries(POSTGRES_EVIDENCE_RETENTION_STATEMENTS)) {
      const source = this.sources[sourceClass as EvidenceRetentionSourceClass];
      if (statement === statements.materialize) {
        const [cutoff, policyVersion, now] = parameters as [string, string, string];
        source.materialize({ cutoff, policyVersion, now });
        return [];
      }
      if (statement === statements.verify) {
        const [cutoff, policyVersion, metricKeys] = parameters as [string, string, string[]];
        return [{ covered: source.uncoveredCount(cutoff, policyVersion, metricKeys) === 0 }];
      }
      if (statement === statements.delete) {
        const [cutoff, policyVersion, metricKeys] = parameters as [string, string, string[]];
        return [{ deleted_count: String(source.deleteCovered(cutoff, policyVersion, metricKeys)) }];
      }
    }
    throw new Error("Unexpected SQL statement.");
  }

  private ensureIdentity(anonymousId: string): readonly unknown[] {
    if (this.identities.has(anonymousId)) {
      return [];
    }
    this.identities.set(anonymousId, "ACTIVE");
    return [{ status: "ACTIVE" }];
  }

  private insertEvent(parameters: readonly unknown[]): string {
    const eventId = parameters[0] as string;
    if (this.events.has(eventId)) {
      return "DUPLICATE";
    }
    this.events.set(eventId, {
      event_id: eventId,
      event_type: parameters[1] as string,
      occurred_at: parameters[2] as string,
      received_at: parameters[3] as string,
      anonymous_id: parameters[4] as string | null,
      session_id: parameters[5] as string | null,
      function_id: parameters[6] as string,
      intent_id: parameters[7] as string | null,
      share_id: parameters[9] as string | null,
      trace_id: parameters[13] as string | null,
      properties: parameters[14]
    });
    return "INSERTED";
  }

  // Mirrors the migration CHECK constraints so a malformed observation fails like PostgreSQL would.
  private insertIntakeObservation(parameters: readonly unknown[]): void {
    const row: StoredIntakeObservation = {
      observation_id: parameters[0] as string,
      received_at: parameters[1] as string,
      batch_accepted: parameters[2] as boolean,
      event_received_count: parameters[3] as number,
      accepted_count: parameters[4] as number,
      duplicate_count: parameters[5] as number,
      rejected_count: parameters[6] as number,
      unknown_event_type_count: parameters[7] as number,
      route_rejection_code: parameters[8] as string | null
    };
    const consistent = row.event_received_count === row.accepted_count + row.duplicate_count + row.rejected_count &&
      row.unknown_event_type_count <= row.rejected_count &&
      (row.route_rejection_code === null || (!row.batch_accepted && row.event_received_count === 0));
    if (!consistent) {
      throw new Error("evidence_intake_observation check constraint violated");
    }
    if (!this.intakeObservations.has(row.observation_id)) {
      this.intakeObservations.set(row.observation_id, row);
    }
  }

  private insertClientQualityReport(parameters: readonly unknown[]): string {
    const reportId = parameters[0] as string;
    if (this.clientQualityReports.has(reportId)) {
      return "DUPLICATE";
    }
    this.clientQualityReports.set(reportId, {
      report_id: reportId,
      received_at: parameters[1] as string,
      local_queue_drop_count: parameters[2] as number,
      offline_expired_event_count: parameters[3] as number
    });
    return "INSERTED";
  }

  private eligible<Row extends { readonly received_at: string }>(
    source: SourceDefinition<Row>,
    cutoff: string
  ): Row[] {
    return [...source.rows()].filter(row => epoch(row.received_at) < epoch(cutoff));
  }

  private materialize<Row extends { readonly received_at: string }>(
    source: SourceDefinition<Row>,
    window: MaterializeWindow
  ): void {
    const eligible = this.eligible(source, window.cutoff);
    const groups = new Map<string, AggregateDimensions>();
    for (const row of eligible) {
      const dimensions = source.dimensions(row);
      groups.set(logicalKey(dimensions, "", ""), dimensions);
    }
    for (const dimensions of groups.values()) {
      for (const metric of source.metrics) {
        this.upsert(source, eligible, dimensions, metric, window);
      }
    }
  }

  private upsert<Row extends { readonly received_at: string }>(
    source: SourceDefinition<Row>,
    eligible: readonly Row[],
    dimensions: AggregateDimensions,
    metric: MetricDefinition<Row>,
    window: MaterializeWindow
  ): void {
    const key = logicalKey(dimensions, metric.metricKey, window.policyVersion);
    const sameKey = (row: Row) => logicalKey(source.dimensions(row), metric.metricKey, window.policyVersion) === key;
    const existing = this.aggregates.get(key);
    const from = existing === undefined ? Number.NEGATIVE_INFINITY : epoch(existing.materialized_through_received_at);
    if (from >= epoch(window.cutoff)) {
      return;
    }
    const contributing = eligible.filter(row => sameKey(row) && epoch(row.received_at) >= from);
    const numerator = contributing.reduce((sum, row) => sum + metric.numerator(row), 0);
    const denominatorOf = metric.denominator;
    const denominator = denominatorOf === null
      ? null
      : contributing.reduce((sum, row) => sum + denominatorOf(row), 0);
    if (existing === undefined) {
      this.aggregateSequence += 1;
      this.aggregates.set(key, {
        aggregate_id: `00000000-0000-4000-8000-${String(this.aggregateSequence).padStart(12, "0")}`,
        bucket_date: dimensions.bucket_date,
        metric_key: metric.metricKey,
        function_id: dimensions.function_id,
        event_type: dimensions.event_type,
        collection_class: null,
        numerator_count: numerator,
        denominator_count: denominator,
        policy_version: window.policyVersion,
        materialized_through_received_at: window.cutoff,
        updated_at: window.now
      });
      return;
    }
    existing.numerator_count += numerator;
    existing.denominator_count = existing.denominator_count === null || denominator === null
      ? null
      : existing.denominator_count + denominator;
    existing.materialized_through_received_at = window.cutoff;
    existing.updated_at = window.now;
  }

  private covered<Row extends { readonly received_at: string }>(
    source: SourceDefinition<Row>,
    row: Row,
    cutoff: string,
    policyVersion: string,
    metricKey: string
  ): boolean {
    const aggregate = this.aggregates.get(logicalKey(source.dimensions(row), metricKey, policyVersion));
    return aggregate !== undefined && epoch(aggregate.materialized_through_received_at) >= epoch(cutoff);
  }

  private uncovered<Row extends { readonly received_at: string }>(
    source: SourceDefinition<Row>,
    cutoff: string,
    policyVersion: string,
    metricKeys: readonly string[]
  ): Row[] {
    return this.eligible(source, cutoff).filter(row =>
      metricKeys.some(metricKey => !this.covered(source, row, cutoff, policyVersion, metricKey))
    );
  }

  private deleteCovered<Row extends { readonly received_at: string }>(
    source: SourceDefinition<Row>,
    cutoff: string,
    policyVersion: string,
    metricKeys: readonly string[]
  ): number {
    let deleted = 0;
    for (const row of this.eligible(source, cutoff)) {
      if (metricKeys.every(metricKey => this.covered(source, row, cutoff, policyVersion, metricKey))) {
        source.remove(row);
        deleted += 1;
      }
    }
    return deleted;
  }
}
