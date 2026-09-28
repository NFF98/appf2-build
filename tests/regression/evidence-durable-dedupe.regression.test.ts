import { readFile } from "node:fs/promises";

import { expect, test } from "vitest";

import {
  POSTGRES_INSERT_EVIDENCE_SQL,
  PostgresEvidenceRepository,
  type PostgresExecutor,
  type PostgresQueryResult
} from "../../src/platform/evidence/postgres-evidence-repository.js";
import type { EvidenceEventInput } from "../../src/platform/evidence/evidence-types.js";

const EVENT_ID = "223e4567-e89b-42d3-a456-426614174000";

class StatefulDedupeExecutor implements PostgresExecutor {
  public readonly durableEventIds = new Set<string>();
  public readonly calls: Array<{
    readonly statement: string;
    readonly parameters: readonly unknown[];
  }> = [];

  public async query<Row>(
    statement: string,
    parameters: readonly unknown[]
  ): Promise<PostgresQueryResult<Row>> {
    if (statement !== POSTGRES_INSERT_EVIDENCE_SQL) {
      throw new Error("Unexpected PostgreSQL statement");
    }
    this.calls.push({ statement, parameters });
    const eventId = parameters[0];
    if (typeof eventId !== "string") {
      throw new Error("Evidence insert requires an event_id");
    }
    const outcome = this.durableEventIds.has(eventId) ? "DUPLICATE" : "INSERTED";
    this.durableEventIds.add(eventId);
    return {
      rows: [{ outcome }] as unknown as readonly Row[]
    };
  }
}

function evidenceEvent(): EvidenceEventInput {
  return {
    event_id: EVENT_ID,
    event_type: "F05-EVT-007",
    schema_version: "1.0.0",
    occurred_at: "2026-09-27T01:23:45.000Z",
    anonymous_id: "123e4567-e89b-42d3-a456-426614174000",
    session_id: "323e4567-e89b-42d3-a456-426614174000",
    function_id: "F05",
    share_id: "423e4567-e89b-42d3-a456-426614174000",
    properties: { share_mode: "DURABLE_REFERENCE" }
  };
}

test("TEST-F07-010 deduplicates the same event_id at the PostgreSQL executor boundary", async () => {
  const executor = new StatefulDedupeExecutor();
  const repository = new PostgresEvidenceRepository(executor);
  const event = evidenceEvent();
  const migration = await readFile(
    new URL(
      "../../supabase/migrations/20260927123000_t006_evidence_intake.sql",
      import.meta.url
    ),
    "utf8"
  );

  const first = await repository.insert(event, "2026-09-27T02:00:00.000Z");
  const retry = await repository.insert(event, "2026-09-27T02:00:01.000Z");

  expect(first).toBe("INSERTED");
  expect(retry).toBe("DUPLICATE");
  expect(executor.durableEventIds).toEqual(new Set([EVENT_ID]));
  expect(executor.calls).toHaveLength(2);
  expect(executor.calls.map(call => call.parameters[0])).toEqual([
    EVENT_ID,
    EVENT_ID
  ]);
  expect(POSTGRES_INSERT_EVIDENCE_SQL).toContain(
    "ON CONFLICT (event_id) DO NOTHING"
  );
  expect(migration).toMatch(/event_id uuid PRIMARY KEY/);
});
