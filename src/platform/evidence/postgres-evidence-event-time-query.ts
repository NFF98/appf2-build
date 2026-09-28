import { effectiveEventAt } from "./evidence-clock.js";
import type { EvidenceEventTimeQuery } from "./evidence-repository.js";
import type { EvidenceEventTimeProjection } from "./evidence-types.js";
import type { PostgresExecutor } from "./postgres-evidence-repository.js";

export const POSTGRES_SELECT_EVENT_TIMES_SQL = `
SELECT
  event_id::text AS event_id,
  occurred_at,
  received_at
FROM public.product_event
WHERE event_id = ANY($1::uuid[])
`.trim();

interface EventTimeRow {
  readonly event_id: string;
  readonly occurred_at: unknown;
  readonly received_at: unknown;
}

function timestampText(value: unknown, field: string): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  throw new Error(`Invalid durable product_event ${field}`);
}

export class PostgresEvidenceEventTimeQuery implements EvidenceEventTimeQuery {
  public constructor(private readonly executor: PostgresExecutor) {}

  public async lookupByEventIds(
    eventIds: readonly string[]
  ): Promise<readonly EvidenceEventTimeProjection[]> {
    if (eventIds.length === 0) {
      return [];
    }
    const uniqueIds = [...new Set(eventIds)];
    const result = await this.executor.query<EventTimeRow>(
      POSTGRES_SELECT_EVENT_TIMES_SQL,
      [uniqueIds]
    );
    const rowsById = new Map(
      result.rows.map(row => [row.event_id, row] as const)
    );
    const projections: EvidenceEventTimeProjection[] = [];
    for (const eventId of uniqueIds) {
      const row = rowsById.get(eventId);
      if (row === undefined) {
        continue;
      }
      const occurredAt = timestampText(row.occurred_at, "occurred_at");
      const receivedAt = timestampText(row.received_at, "received_at");
      projections.push({
        event_id: eventId,
        occurred_at: occurredAt,
        received_at: receivedAt,
        effective_event_at: effectiveEventAt(occurredAt, receivedAt)
      });
    }
    return projections;
  }
}
