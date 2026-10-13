import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";

import { createWorkerFetch } from "../../src/edge/worker-entry.js";
import { NO_REQUEST_DB_CONTEXT, WorkerPostgresExecutor } from "../../src/platform/blueprint/worker-postgres-executor.js";
import {
  POSTGRES_INSERT_CLIENT_QUALITY_REPORT_SQL,
  POSTGRES_INSERT_INTAKE_OBSERVATION_SQL
} from "../../src/platform/evidence/postgres-evidence-quality-repository.js";
import { adminUrl, ORIGIN, realPgHarness } from "./pg001-real-pg-harness.js";

/**
 * PG-001 `/api/v1/events/batch` evidence sources on real PostgreSQL through the general Worker login: the executor binds
 * `app.evidence_source_row_id` to the single row each locked evidence INSERT writes, and to nothing else.
 */
const harness = realPgHarness("evt");
const { logins, sql, sqlStateAs } = harness;
const send = createWorkerFetch();

async function postBatch(payload: unknown): Promise<{ status: number; body: unknown }> {
  const response = await send(new Request(`${ORIGIN}/api/v1/events/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }), harness.env());
  return { status: response.status, body: await response.json().catch(() => null) };
}

const qualityOnly = (reportId: string) => ({
  batch_id: randomUUID(),
  events: [],
  quality_report: { report_id: reportId, local_queue_drop_count: 2, offline_expired_event_count: 1 }
});

async function workerRows(statement: string, parameters: readonly unknown[] = []): Promise<number> {
  const executor = new WorkerPostgresExecutor({ connectionString: logins.worker.url }, NO_REQUEST_DB_CONTEXT);
  try {
    return (await executor.query(statement, parameters)).rows.length;
  } finally {
    await executor.close();
  }
}

const count = async (table: string, where = "true", parameters: readonly unknown[] = []) =>
  (await sql<{ n: number }>(`SELECT count(*)::int AS n FROM public.${table} WHERE ${where}`, parameters))[0]?.n ?? -1;

describe.skipIf(adminUrl === undefined)("PG-001 events/batch evidence sources on real PostgreSQL", () => {
  test("regression: with an empty app.evidence_source_row_id the quality report RETURNING is refused by RLS", async () => {
    expect(await sqlStateAs(logins.worker.url, [
      "SET LOCAL ROLE appf2_worker",
      `PREPARE q(uuid, timestamptz, bigint, bigint) AS ${POSTGRES_INSERT_CLIENT_QUALITY_REPORT_SQL}`,
      `EXECUTE q('${randomUUID()}', now(), 1, 0)`
    ])).toBe("42501");
  });

  test("quality-only batch is durably written (report + observation); a replay is DUPLICATE without double counting", async () => {
    const reportId = randomUUID();
    const before = await count("evidence_intake_observation");
    const first = await postBatch(qualityOnly(reportId));
    expect(first.status).toBe(200);
    expect(await sql("SELECT local_queue_drop_count::int AS drops, offline_expired_event_count::int AS expired FROM public.evidence_client_quality_report WHERE report_id = $1", [reportId]))
      .toEqual([{ drops: 2, expired: 1 }]);
    const replay = await postBatch(qualityOnly(reportId));
    expect(replay.status).toBe(200);
    expect(await count("evidence_client_quality_report", "report_id = $1", [reportId])).toBe(1);
    expect(await count("evidence_intake_observation", "batch_accepted")).toBe(before + 2);
    console.info(JSON.stringify({ quality_only: [first.status, replay.status], observations_added: (await count("evidence_intake_observation")) - before }));
  });

  test("route rejection is still observed durably (F07 §44)", async () => {
    const before = await count("evidence_intake_observation", "route_rejection_code = 'F07-ERR-003'");
    expect((await postBatch({ batch_id: "not-a-uuid", events: [] })).status).toBe(400);
    expect(await count("evidence_intake_observation", "route_rejection_code = 'F07-ERR-003'")).toBe(before + 1);
  });

  test("the Worker cannot read other evidence rows: no binding outside the locked INSERTs, no non-key columns", async () => {
    const [known] = await sql<{ report_id: string }>("SELECT report_id FROM public.evidence_client_quality_report LIMIT 1");
    const [observed] = await sql<{ observation_id: string }>("SELECT observation_id FROM public.evidence_intake_observation LIMIT 1");
    expect(known).toBeDefined();
    expect(observed).toBeDefined();
    expect(await workerRows("SELECT report_id FROM public.evidence_client_quality_report")).toBe(0);
    expect(await workerRows("SELECT report_id FROM public.evidence_client_quality_report WHERE report_id = $1", [known?.report_id])).toBe(0);
    expect(await workerRows("SELECT observation_id FROM public.evidence_intake_observation WHERE observation_id = $1", [observed?.observation_id])).toBe(0);
    await expect(workerRows("SELECT local_queue_drop_count FROM public.evidence_client_quality_report")).rejects.toMatchObject({ code: "42501" });
    await expect(workerRows("SELECT batch_accepted FROM public.evidence_intake_observation")).rejects.toMatchObject({ code: "42501" });
    await expect(workerRows("DELETE FROM public.evidence_intake_observation")).rejects.toMatchObject({ code: "42501" });
    await expect(workerRows(POSTGRES_INSERT_INTAKE_OBSERVATION_SQL, ["not-a-uuid"])).rejects.toThrow(/uuid row id/u);
  });

  // F07-EVENT-001: anonymous_id events go through the F07 Event-only channel (see f07-event-channel.integration.test.ts).
  test("product events: identity-free and anonymous_id events are both stored; the browser UUID gets an identity row only", async () => {
    const now = new Date().toISOString();
    const event = (anonymousId: string | null) => ({
      event_id: randomUUID(),
      event_type: "F05-EVT-007",
      schema_version: "2.0.0",
      occurred_at: now,
      anonymous_id: anonymousId,
      session_id: randomUUID(),
      function_id: "F05",
      share_id: randomUUID(),
      properties: { share_mode: "DURABLE_REFERENCE" }
    });
    const anonymousId = randomUUID();
    const before = await count("product_event");
    const withoutIdentity = await postBatch({ batch_id: randomUUID(), events: [event(null)] });
    const withIdentity = await postBatch({ batch_id: randomUUID(), events: [event(anonymousId)] });
    const data = (outcome: { body: unknown }) => (outcome.body as { data?: { accepted?: number; rejections?: { code?: string }[] } } | null)?.data;
    expect(withoutIdentity.status).toBe(200);
    expect(data(withoutIdentity)?.accepted).toBe(1);
    expect(withIdentity.status).toBe(200);
    expect(data(withIdentity)).toMatchObject({ accepted: 1, rejected: 0 });
    expect(await count("product_event")).toBe(before + 2);
    expect(await count("product_event", "anonymous_id = $1", [anonymousId])).toBe(1);
    expect(await count("anonymous_identity", "anonymous_id = $1", [anonymousId])).toBe(1);
    expect(await count("intent_record", "anonymous_id = $1", [anonymousId])).toBe(0);
    console.info(JSON.stringify({ product_events: { without_identity: data(withoutIdentity), with_identity: data(withIdentity) } }));
  });
});
