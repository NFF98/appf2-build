import { effectiveEventAt, isClockInvalid } from "../../src/platform/evidence/evidence-clock.js";
import {
  POSTGRES_INSERT_EVIDENCE_SQL,
  type PostgresExecutor,
  type PostgresQueryResult
} from "../../src/platform/evidence/postgres-evidence-repository.js";
import {
  POSTGRES_DELETE_RETAINED_RAW_EVIDENCE_SQL,
  POSTGRES_MATERIALIZE_EVIDENCE_AGGREGATES_SQL,
  POSTGRES_VERIFY_EVIDENCE_AGGREGATE_WATERMARK_SQL
} from "../../src/platform/evidence/postgres-evidence-retention-repository.js";

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

// Exactly the evidence_daily_aggregate columns created by the T008 migration.
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

interface RawGroup {
  readonly bucket_date: string;
  readonly function_id: string;
  readonly event_type: string;
  event_count: number;
  clock_invalid_count: number;
}

function epoch(value: string): number {
  return Date.parse(value);
}

export function bucketDateOf(row: Pick<StoredProductEvent, "occurred_at" | "received_at">): string {
  return new Date(effectiveEventAt(row.occurred_at, row.received_at)).toISOString().slice(0, 10);
}

function logicalKey(
  bucketDate: string,
  metricKey: string,
  functionId: string | null,
  eventType: string | null,
  policyVersion: string
): string {
  return [bucketDate, metricKey, functionId ?? "", eventType ?? "", "", policyVersion].join("|");
}

// Mirrors the T008 SQL: product_event first-insert-wins intake plus the retention statements.
// Anonymous identity eligibility is owned by the identity repository and treated as ACTIVE here.
export class FakeEvidenceRetentionPostgres implements PostgresExecutor {
  public readonly events = new Map<string, StoredProductEvent>();
  public readonly aggregates = new Map<string, StoredDailyAggregate>();
  public readonly statements: string[] = [];
  public failNext: string | undefined;
  private aggregateSequence = 0;

  public async query<Row>(statement: string, parameters: readonly unknown[]): Promise<PostgresQueryResult<Row>> {
    this.statements.push(statement);
    if (this.failNext === statement) {
      this.failNext = undefined;
      throw new Error("simulated database failure");
    }
    if (statement === POSTGRES_INSERT_EVIDENCE_SQL) {
      return { rows: [{ outcome: this.insert(parameters) } as Row] };
    }
    if (statement === POSTGRES_MATERIALIZE_EVIDENCE_AGGREGATES_SQL) {
      const [cutoff, policyVersion, now] = parameters as [string, string, string];
      this.materialize(cutoff, policyVersion, now);
      return { rows: [] };
    }
    if (statement === POSTGRES_VERIFY_EVIDENCE_AGGREGATE_WATERMARK_SQL) {
      const [cutoff, policyVersion, metricKeys] = parameters as [string, string, string[]];
      return { rows: [{ covered: this.uncovered(cutoff, policyVersion, metricKeys).length === 0 } as Row] };
    }
    if (statement === POSTGRES_DELETE_RETAINED_RAW_EVIDENCE_SQL) {
      const [cutoff, policyVersion, metricKeys] = parameters as [string, string, string[]];
      return { rows: [{ deleted_count: String(this.deleteCovered(cutoff, policyVersion, metricKeys)) } as Row] };
    }
    throw new Error("Unexpected SQL statement.");
  }

  public aggregateRows(): StoredDailyAggregate[] {
    return [...this.aggregates.values()];
  }

  private insert(parameters: readonly unknown[]): string {
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

  private groupEligible(cutoff: string): RawGroup[] {
    const groups = new Map<string, RawGroup>();
    for (const row of this.events.values()) {
      if (epoch(row.received_at) >= epoch(cutoff)) {
        continue;
      }
      const bucket = bucketDateOf(row);
      const key = [bucket, row.function_id, row.event_type].join("|");
      const group = groups.get(key) ?? {
        bucket_date: bucket,
        function_id: row.function_id,
        event_type: row.event_type,
        event_count: 0,
        clock_invalid_count: 0
      };
      group.event_count += 1;
      group.clock_invalid_count += isClockInvalid(row.occurred_at, row.received_at) ? 1 : 0;
      groups.set(key, group);
    }
    return [...groups.values()];
  }

  private windowCounts(aggregate: StoredDailyAggregate, cutoff: string): { events: number; clockInvalid: number } {
    let events = 0;
    let clockInvalid = 0;
    for (const row of this.events.values()) {
      const received = epoch(row.received_at);
      if (
        received >= epoch(aggregate.materialized_through_received_at) &&
        received < epoch(cutoff) &&
        row.function_id === aggregate.function_id &&
        row.event_type === aggregate.event_type &&
        bucketDateOf(row) === aggregate.bucket_date
      ) {
        events += 1;
        clockInvalid += isClockInvalid(row.occurred_at, row.received_at) ? 1 : 0;
      }
    }
    return { events, clockInvalid };
  }

  private upsert(
    group: RawGroup,
    metricKey: "event_count" | "clock_invalid_rate",
    window: { readonly cutoff: string; readonly policyVersion: string; readonly now: string }
  ): void {
    const key = logicalKey(group.bucket_date, metricKey, group.function_id, group.event_type, window.policyVersion);
    const existing = this.aggregates.get(key);
    if (existing === undefined) {
      this.aggregateSequence += 1;
      this.aggregates.set(key, {
        aggregate_id: `00000000-0000-4000-8000-${String(this.aggregateSequence).padStart(12, "0")}`,
        bucket_date: group.bucket_date,
        metric_key: metricKey,
        function_id: group.function_id,
        event_type: group.event_type,
        collection_class: null,
        numerator_count: metricKey === "event_count" ? group.event_count : group.clock_invalid_count,
        denominator_count: metricKey === "event_count" ? null : group.event_count,
        policy_version: window.policyVersion,
        materialized_through_received_at: window.cutoff,
        updated_at: window.now
      });
      return;
    }
    if (epoch(existing.materialized_through_received_at) >= epoch(window.cutoff)) {
      return;
    }
    const counts = this.windowCounts(existing, window.cutoff);
    existing.numerator_count += metricKey === "event_count" ? counts.events : counts.clockInvalid;
    existing.denominator_count = existing.denominator_count === null ? null : existing.denominator_count + counts.events;
    existing.materialized_through_received_at = window.cutoff;
    existing.updated_at = window.now;
  }

  private materialize(cutoff: string, policyVersion: string, now: string): void {
    for (const group of this.groupEligible(cutoff)) {
      this.upsert(group, "event_count", { cutoff, policyVersion, now });
      this.upsert(group, "clock_invalid_rate", { cutoff, policyVersion, now });
    }
  }

  private covered(row: StoredProductEvent, cutoff: string, policyVersion: string, metricKey: string): boolean {
    const aggregate = this.aggregates.get(
      logicalKey(bucketDateOf(row), metricKey, row.function_id, row.event_type, policyVersion)
    );
    return aggregate !== undefined && epoch(aggregate.materialized_through_received_at) >= epoch(cutoff);
  }

  private uncovered(cutoff: string, policyVersion: string, metricKeys: readonly string[]): StoredProductEvent[] {
    return [...this.events.values()].filter(row =>
      epoch(row.received_at) < epoch(cutoff) &&
      metricKeys.some(metricKey => !this.covered(row, cutoff, policyVersion, metricKey))
    );
  }

  private deleteCovered(cutoff: string, policyVersion: string, metricKeys: readonly string[]): number {
    let deleted = 0;
    for (const row of [...this.events.values()]) {
      if (
        epoch(row.received_at) < epoch(cutoff) &&
        metricKeys.every(metricKey => this.covered(row, cutoff, policyVersion, metricKey))
      ) {
        this.events.delete(row.event_id);
        deleted += 1;
      }
    }
    return deleted;
  }
}
