import { expect, test } from "vitest";

import { EvidenceIngestionService } from "../../src/platform/evidence/evidence-ingestion-service.js";
import {
  POSTGRES_SELECT_EVENT_TIMES_SQL,
  PostgresEvidenceEventTimeQuery
} from "../../src/platform/evidence/postgres-evidence-event-time-query.js";
import {
  POSTGRES_ENSURE_ANONYMOUS_IDENTITY_SQL,
  POSTGRES_INSERT_EVIDENCE_SQL,
  POSTGRES_REFRESH_LAST_SEEN_SQL,
  PostgresAnonymousIdentityRepository,
  PostgresEvidenceRepository,
  type PostgresExecutor,
  type PostgresQueryResult
} from "../../src/platform/evidence/postgres-evidence-repository.js";
import type { EvidenceIngestionDiagnostics } from "../../src/platform/evidence/evidence-repository.js";

const RECEIVED_AT = "2026-09-27T02:00:00.000Z";
const RETRY_RECEIVED_AT = "2026-09-27T03:00:00.000Z";
const EXACTLY_TEN_MINUTES = "2026-09-27T02:10:00.000Z";
const ELEVEN_MINUTES = "2026-09-27T02:11:00.000Z";
const NORMAL_OCCURRED_AT = "2026-09-27T01:23:45.000Z";
const SOURCE_ERROR = "F05-ERR-001";

interface DurableEventTime {
  readonly occurredAt: string;
  readonly receivedAt: string;
  readonly errorCode: string | null;
}

class DurableProductEventExecutor implements PostgresExecutor {
  public readonly events = new Map<string, DurableEventTime>();

  public async query<Row>(
    statement: string,
    parameters: readonly unknown[]
  ): Promise<PostgresQueryResult<Row>> {
    if (statement === POSTGRES_ENSURE_ANONYMOUS_IDENTITY_SQL) {
      return { rows: [{ status: "ACTIVE" }] as unknown as readonly Row[] };
    }
    if (statement === POSTGRES_REFRESH_LAST_SEEN_SQL) {
      return { rows: [] };
    }
    if (statement === POSTGRES_INSERT_EVIDENCE_SQL) {
      const eventId = parameters[0];
      const occurredAt = parameters[2];
      const receivedAt = parameters[3];
      const errorCode = parameters[11];
      if (typeof eventId !== "string" || typeof occurredAt !== "string" ||
        typeof receivedAt !== "string") {
        throw new Error("Evidence insert requires durable timestamps");
      }
      if (this.events.has(eventId)) {
        return { rows: [{ outcome: "DUPLICATE" }] as unknown as readonly Row[] };
      }
      this.events.set(eventId, {
        occurredAt,
        receivedAt,
        errorCode: typeof errorCode === "string" ? errorCode : null
      });
      return { rows: [{ outcome: "INSERTED" }] as unknown as readonly Row[] };
    }
    if (statement === POSTGRES_SELECT_EVENT_TIMES_SQL) {
      const eventIds = parameters[0];
      if (!Array.isArray(eventIds) || eventIds.some(id => typeof id !== "string")) {
        throw new Error("Event-time query requires bounded event_id array");
      }
      return {
        rows: eventIds.flatMap(eventId => {
          const row = this.events.get(eventId);
          return row === undefined
            ? []
            : [{
              event_id: eventId,
              occurred_at: row.occurredAt,
              received_at: row.receivedAt
            }];
        }) as unknown as readonly Row[]
      };
    }
    throw new Error("Unexpected PostgreSQL statement");
  }
}

function envelope(index: number, occurredAt: string): Record<string, unknown> {
  return {
    event_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    event_type: "F05-EVT-007",
    schema_version: "1.0.0",
    occurred_at: occurredAt,
    anonymous_id: "423e4567-e89b-42d3-a456-426614174000",
    session_id: "623e4567-e89b-42d3-a456-426614174000",
    function_id: "F05",
    share_id: "723e4567-e89b-42d3-a456-426614174000",
    error_code: SOURCE_ERROR,
    properties: { share_mode: "DURABLE_REFERENCE" }
  };
}

function projectionById(
  projections: readonly { readonly event_id: string }[],
  eventId: string
) {
  return projections.find(projection => projection.event_id === eventId);
}

test("TEST-F07-031 derives effective_event_at and keeps duplicate clock classification stable", async () => {
  const executor = new DurableProductEventExecutor();
  const clock = { current: new Date(RECEIVED_AT) };
  const ingestion = new EvidenceIngestionService({
    anonymousIdentities: new PostgresAnonymousIdentityRepository(executor),
    evidence: new PostgresEvidenceRepository(executor),
    diagnostics: {
      reportNonBlockingFailure() {
        return undefined;
      }
    } satisfies EvidenceIngestionDiagnostics,
    now: () => clock.current
  });
  const query = new PostgresEvidenceEventTimeQuery(executor);
  const clockInvalid = envelope(1, ELEVEN_MINUTES);
  const exactSkew = envelope(2, EXACTLY_TEN_MINUTES);
  const normal = envelope(3, NORMAL_OCCURRED_AT);
  const eventIds = [
    String(clockInvalid.event_id),
    String(exactSkew.event_id),
    String(normal.event_id)
  ];

  const first = await ingestion.ingest([clockInvalid, exactSkew, normal]);
  clock.current = new Date(RETRY_RECEIVED_AT);
  const retry = await ingestion.ingest([clockInvalid]);
  const times = await query.lookupByEventIds(eventIds);
  const invalidTime = projectionById(times, eventIds[0] ?? "");
  const exactTime = projectionById(times, eventIds[1] ?? "");
  const normalTime = projectionById(times, eventIds[2] ?? "");
  const storedInvalid = executor.events.get(eventIds[0] ?? "");

  expect(first).toMatchObject({
    accepted: 3,
    duplicates: 0,
    rejected: 0,
    rejections: [],
    diagnostics: [
      {
        event_id: clockInvalid.event_id,
        code: "F07-ERR-013",
        field: "occurred_at",
        action: "USE_RECEIVED_AT"
      }
    ]
  });
  expect(retry).toEqual({
    accepted: 0,
    duplicates: 1,
    rejected: 0,
    rejections: [],
    diagnostics: []
  });
  expect(storedInvalid?.receivedAt).toBe(RECEIVED_AT);
  expect(storedInvalid?.occurredAt).toBe(ELEVEN_MINUTES);
  expect(storedInvalid?.errorCode).toBe(SOURCE_ERROR);
  expect(storedInvalid?.errorCode).not.toBe("F07-ERR-013");
  expect(invalidTime).toMatchObject({
    occurred_at: ELEVEN_MINUTES,
    received_at: RECEIVED_AT,
    effective_event_at: RECEIVED_AT
  });
  expect(exactTime).toMatchObject({
    occurred_at: EXACTLY_TEN_MINUTES,
    received_at: RECEIVED_AT,
    effective_event_at: EXACTLY_TEN_MINUTES
  });
  expect(normalTime).toMatchObject({
    occurred_at: NORMAL_OCCURRED_AT,
    received_at: RECEIVED_AT,
    effective_event_at: NORMAL_OCCURRED_AT
  });
  expect(POSTGRES_INSERT_EVIDENCE_SQL).toContain("ON CONFLICT (event_id) DO NOTHING");
  expect(POSTGRES_INSERT_EVIDENCE_SQL).not.toContain("F07-ERR-013");
  expect(POSTGRES_SELECT_EVENT_TIMES_SQL).toContain("FROM public.product_event");
  expect(POSTGRES_SELECT_EVENT_TIMES_SQL).toContain("ANY($1::uuid[])");
  expect(POSTGRES_SELECT_EVENT_TIMES_SQL).not.toMatch(/\bnow\s*\(/i);
});
