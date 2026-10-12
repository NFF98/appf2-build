import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, test, vi } from "vitest";

import registryDocument from "../../build-spec/baselines/BS-P1-013/registries/evidence-event-registry.json" with { type: "json" };
import type { Appf2WorkerEnv } from "../../src/edge/worker-composition.js";
import { createWorkerFetch } from "../../src/edge/worker-entry.js";
import { NO_REQUEST_DB_CONTEXT, WorkerPostgresExecutor } from "../../src/platform/blueprint/worker-postgres-executor.js";
import { EvidenceIngestionService } from "../../src/platform/evidence/evidence-ingestion-service.js";
import { createEvidenceRegistry, type EvidenceRegistryDocument } from "../../src/platform/evidence/evidence-registry.js";
import { F07EventExecutor } from "../../src/platform/evidence/f07-event-executor.js";
import {
  POSTGRES_INSERT_EVIDENCE_SQL,
  PostgresAnonymousIdentityRepository,
  PostgresEvidenceRepository
} from "../../src/platform/evidence/postgres-evidence-repository.js";
import { adminUrl, ORIGIN, realPgHarness } from "./pg001-real-pg-harness.js";

/**
 * F07-EVENT-001 (Human-approved): /api/v1/events/batch writes anonymous_identity + product_event only through the
 * dedicated F07 Event login (member of appf2_f07_event only). A browser anonymous_id is correlation only.
 */
const harness = realPgHarness("f07");
const { logins, sql, sqlStateAs } = harness;
const send = createWorkerFetch();
const EVENT_TYPE = "F05-EVT-007";

interface BatchData {
  readonly accepted?: number;
  readonly duplicates?: number;
  readonly rejected?: number;
  readonly rejections?: readonly { readonly event_id?: string | null; readonly code?: string }[];
}

async function postBatch(
  events: readonly unknown[],
  env: Appf2WorkerEnv = harness.env()
): Promise<{ status: number; data: BatchData | undefined; code: string | null; cookie: string | null }> {
  const response = await send(new Request(`${ORIGIN}/api/v1/events/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ batch_id: randomUUID(), events })
  }), env);
  const body = (await response.json().catch(() => null)) as { data?: BatchData; error?: { code?: string } } | null;
  return { status: response.status, data: body?.data, code: body?.error?.code ?? null, cookie: response.headers.get("set-cookie") };
}

const event = (anonymousId: string | null, overrides: Readonly<Record<string, unknown>> = {}) => ({
  event_id: randomUUID(),
  event_type: EVENT_TYPE,
  schema_version: "2.0.0",
  occurred_at: new Date().toISOString(),
  anonymous_id: anonymousId,
  session_id: randomUUID(),
  function_id: "F05",
  share_id: randomUUID(),
  properties: { share_mode: "DURABLE_REFERENCE" },
  ...overrides
});

const count = async (table: string, where = "true", parameters: readonly unknown[] = []) =>
  (await sql<{ n: number }>(`SELECT count(*)::int AS n FROM public.${table} WHERE ${where}`, parameters))[0]?.n ?? -1;

const identityOf = async (anonymousId: string) =>
  sql<{ status: string; last_seen_at: Date }>("SELECT status, last_seen_at FROM public.anonymous_identity WHERE anonymous_id = $1", [anonymousId]);

/** One statement on the F07 login as appf2_f07_event with an explicit per-statement context; always rolled back. */
async function asF07(context: { anonymousId?: string; eventId?: string }, statement: string, parameters: readonly unknown[] = []) {
  const client = new Client({ connectionString: logins.events.url });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.f07_event_anonymous_id', $1, true), set_config('app.f07_event_id', $2, true)", [
      context.anonymousId ?? "",
      context.eventId ?? ""
    ]);
    await client.query("SET LOCAL ROLE appf2_f07_event");
    const result = await client.query(statement, [...parameters]);
    return { rows: result.rows as Record<string, unknown>[], code: null };
  } catch (error) {
    return { rows: [], code: String((error as { code?: unknown }).code) };
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

describe.skipIf(adminUrl === undefined)("PG-001 F07 Event-only channel on real PostgreSQL", () => {
  test("mixed batch: each event stored with its own anonymous_id, one identity per UUID, replay deduped, last_seen bounded", async () => {
    const [a, b] = [randomUUID(), randomUUID()];
    const events = [event(a), event(b), event(null), event(a), event(a.toUpperCase())];
    const first = await postBatch(events);
    expect(first).toMatchObject({ status: 200, data: { accepted: 5, duplicates: 0, rejected: 0 }, cookie: null });
    expect(await count("product_event", "anonymous_id = $1", [a])).toBe(3);
    expect(await count("product_event", "anonymous_id = $1", [b])).toBe(1);
    expect(await count("product_event", "event_id = $1 AND anonymous_id IS NULL", [events[2]?.event_id])).toBe(1);
    expect(await count("anonymous_identity", "anonymous_id = ANY($1::uuid[])", [[a, b]])).toBe(2);
    const seenBefore = (await identityOf(a))[0]?.last_seen_at.getTime();

    const replay = await postBatch(events);
    expect(replay).toMatchObject({ status: 200, data: { accepted: 0, duplicates: 5, rejected: 0 } });
    expect(await count("product_event", "anonymous_id = ANY($1::uuid[])", [[a, b]])).toBe(4);
    expect((await identityOf(a))[0]?.last_seen_at.getTime()).toBe(seenBefore);
    console.info(JSON.stringify({ mixed: first.data, replay: replay.data }));
  });

  test("DISABLED identity: event refused (F07-ERR-002) with no product_event; the F07 role cannot re-enable it", async () => {
    const disabled = randomUUID();
    await sql("INSERT INTO public.anonymous_identity (anonymous_id, status) VALUES ($1, 'DISABLED')", [disabled]);
    const before = await identityOf(disabled);
    const outcome = await postBatch([event(disabled)]);
    expect(outcome).toMatchObject({ status: 200, data: { accepted: 0, rejections: [{ code: "F07-ERR-002" }] } });
    expect(await count("product_event", "anonymous_id = $1", [disabled])).toBe(0);
    expect(await identityOf(disabled)).toEqual(before);
    expect((await asF07({ anonymousId: disabled }, "UPDATE public.anonymous_identity SET status = 'ACTIVE' WHERE anonymous_id = $1", [disabled])).code).toBe("42501");
    expect((await asF07({ anonymousId: disabled }, "UPDATE public.anonymous_identity SET last_seen_at = now() WHERE anonymous_id = $1 RETURNING 1", [disabled])).rows).toEqual([]);
  });

  test("invalid UUID, undeclared property, oversize batch: refused before identity ensure, zero rows", async () => {
    const fresh = randomUUID();
    const before = { events: await count("product_event"), identities: await count("anonymous_identity") };
    const invalid = await postBatch([event("not-a-uuid"), event(fresh, { properties: { email: "user@example.com" } })]);
    expect(invalid.status).toBe(200);
    expect(invalid.data?.accepted).toBe(0);
    expect(invalid.data?.rejected).toBe(2);
    const oversize = await postBatch(Array.from({ length: 51 }, () => event(fresh)));
    expect(oversize).toMatchObject({ status: 400, code: "F07-ERR-007" });
    expect({ events: await count("product_event"), identities: await count("anonymous_identity") }).toEqual(before);
    console.info(JSON.stringify({ invalid: invalid.data?.rejections?.map((rejection) => rejection.code), oversize: oversize.code }));
  });

  test("DEBUG_ONLY event is rejected before identity ensure on the real F07 channel (F07-RQ-009 step 13)", async () => {
    const document = registryDocument as EvidenceRegistryDocument;
    const registry = createEvidenceRegistry({
      ...document,
      entries: document.entries.map((entry) => (entry.event_type === EVENT_TYPE ? { ...entry, collection_class: "DEBUG_ONLY" } : entry))
    });
    const executor = new F07EventExecutor({ connectionString: logins.events.url });
    const anonymousId = randomUUID();
    try {
      const service = new EvidenceIngestionService({
        anonymousIdentities: new PostgresAnonymousIdentityRepository(executor),
        evidence: new PostgresEvidenceRepository(executor),
        diagnostics: { reportNonBlockingFailure: () => undefined },
        now: () => new Date(),
        registry
      });
      const result = await service.ingest([event(anonymousId)]);
      expect(result).toMatchObject({ accepted: 0, rejections: [{ code: "F07-ERR-016" }] });
    } finally {
      await executor.close();
    }
    expect(await count("anonymous_identity", "anonymous_id = $1", [anonymousId])).toBe(0);
    expect(await count("product_event", "anonymous_id = $1", [anonymousId])).toBe(0);
  });

  test("spoofed victim UUID is correlation only: no cookie, no F01 access, no read of the victim's rows", async () => {
    const victim = await harness.createIntent();
    const spoof = await postBatch([event(victim.anonymousId)]);
    expect(spoof).toMatchObject({ status: 200, data: { accepted: 1 }, cookie: null });
    expect(JSON.stringify(spoof.data)).not.toContain(victim.intentId);
    const attacker = await harness.popKey();
    const takeover = await harness.readOutcome(await harness.signedPost(attacker, `/api/v1/intents/${victim.intentId}/compile`, { intent_version: victim.intentVersion }, "compile-spoof", { cookie: null }));
    expect(takeover).toMatchObject({ status: 400, code: "F01-ERR-001" });
    const bound = { anonymousId: victim.anonymousId };
    for (const table of ["intent_record", "idempotency_operation", "compiler_run", "validation_run", "blueprint_content"]) {
      expect((await asF07(bound, `SELECT 1 FROM public.${table} LIMIT 1`)).code, table).toBe("42501");
    }
    expect((await asF07(bound, "SELECT event_id FROM public.product_event WHERE anonymous_id = $1", [victim.anonymousId])).code).toBe("42501");
    expect((await asF07(bound, "SELECT event_id FROM public.product_event")).rows).toEqual([]);
    expect(await count("intent_record", "anonymous_id = $1", [victim.anonymousId])).toBe(1);
  });

  test("role boundary: per-statement binding, no foreign rows, no evidence sources, no role escalation, closed statement set", async () => {
    const [a, b] = [randomUUID(), randomUUID()];
    expect((await postBatch([event(a), event(b)])).data?.accepted).toBe(2);
    expect((await asF07({ anonymousId: a }, "SELECT anonymous_id FROM public.anonymous_identity")).rows).toEqual([{ anonymous_id: a }]);
    expect((await asF07({}, "SELECT anonymous_id FROM public.anonymous_identity")).rows).toEqual([]);
    expect((await asF07({ anonymousId: a }, "SELECT created_at FROM public.anonymous_identity")).code).toBe("42501");
    const foreignEvent = { eventId: randomUUID(), anonymousId: a };
    const insert = (anonymousId: string | null) =>
      asF07(foreignEvent, "INSERT INTO public.product_event (event_id, event_type, occurred_at, anonymous_id, function_id, schema_version) VALUES ($1, $2, now(), $3, 'F05', '2.0.0')", [foreignEvent.eventId, EVENT_TYPE, anonymousId]);
    expect((await insert(b)).code).toBe("42501");
    expect((await insert(null)).code).toBe("42501");
    expect((await insert(a)).code).toBeNull();
    expect((await asF07({ anonymousId: b }, "INSERT INTO public.anonymous_identity (anonymous_id) VALUES ($1)", [randomUUID()])).code).toBe("42501");
    expect((await asF07({ anonymousId: a }, "DELETE FROM public.product_event")).code).toBe("42501");
    for (const table of ["evidence_intake_observation", "evidence_client_quality_report", "evidence_daily_aggregate"]) {
      expect((await asF07({}, `INSERT INTO public.${table} DEFAULT VALUES`)).code, table).toBe("42501");
    }
    for (const role of ["appf2_worker", "appf2_f02_admission", "appf2_f02_trust", "appf2_retention"]) {
      expect(await sqlStateAs(logins.events.url, [`SET ROLE ${role}`]), role).toBe("42501");
    }
    expect(await sqlStateAs(logins.events.url, ["SET LOCAL ROLE appf2_f07_event", "SELECT public.appf2_create_key_available('appf2-create-v1.x', gen_random_uuid())"])).toBe("42501");
    const executor = new F07EventExecutor({ connectionString: logins.events.url });
    try {
      await expect(executor.query("SELECT 1", [])).rejects.toThrow(/only the locked/u);
      await expect(executor.query(POSTGRES_INSERT_EVIDENCE_SQL, ["not-a-uuid"])).rejects.toThrow(/canonical uuid/u);
    } finally {
      await executor.close();
    }
  });

  test("regression: the general Worker channel (no verified identity) cannot store an anonymous_id event", async () => {
    const executor = new WorkerPostgresExecutor({ connectionString: logins.worker.url }, NO_REQUEST_DB_CONTEXT);
    const anonymousId = randomUUID();
    try {
      await expect(new PostgresAnonymousIdentityRepository(executor).ensure(anonymousId, new Date().toISOString())).rejects.toMatchObject({ code: "42501" });
    } finally {
      await executor.close();
    }
    expect(await count("anonymous_identity", "anonymous_id = $1", [anonymousId])).toBe(0);
  });
});

describe.skipIf(adminUrl === undefined)("PG-001 F07 channel: no clock gate, mandatory dedicated binding", () => {
  test("no Worker/DB clock gate: skewed Worker clocks still ensure + insert; 24 h last_seen throttle and DISABLED unchanged", async () => {
    const policies = await sql<{ name: string; text: string }>(
      "SELECT policyname AS name, coalesce(qual, '') || ' ' || coalesce(with_check, '') AS text FROM pg_policies WHERE 'appf2_f07_event' = ANY(roles)"
    );
    expect(policies).toHaveLength(5);
    expect(policies.filter((policy) => /now\(\)|interval/iu.test(policy.text))).toEqual([]);
    const HOUR = 3_600_000;
    const realNow = Date.now();
    const seenOf = async (anonymousId: string) => (await identityOf(anonymousId))[0]?.last_seen_at.getTime();
    vi.useFakeTimers({ toFake: ["Date"] });
    const at = (offsetMs: number, events: readonly unknown[]) => {
      vi.setSystemTime(realNow + offsetMs);
      return postBatch(events);
    };
    try {
      for (const skew of [-2 * HOUR, -10 * 60_000, 10 * 60_000, 2 * HOUR]) {
        const anonymousId = randomUUID();
        expect((await at(skew, [event(anonymousId)])).data, `skew ${skew}`).toMatchObject({ accepted: 1, rejected: 0 });
        expect(await seenOf(anonymousId)).toBe(realNow + skew);
        expect(await count("product_event", "anonymous_id = $1", [anonymousId])).toBe(1);
      }
      const throttled = randomUUID();
      await at(0, [event(throttled)]);
      for (const offset of [23 * HOUR, -2 * HOUR]) {
        expect((await at(offset, [event(throttled)])).data?.accepted).toBe(1);
        expect(await seenOf(throttled), `offset ${offset}`).toBe(realNow);
      }
      await at(25 * HOUR, [event(throttled)]);
      expect(await seenOf(throttled)).toBe(realNow + 25 * HOUR);
      await at(26 * HOUR, [event(throttled)]);
      expect(await seenOf(throttled)).toBe(realNow + 25 * HOUR);

      const disabled = randomUUID();
      await sql("INSERT INTO public.anonymous_identity (anonymous_id, status) VALUES ($1, 'DISABLED')", [disabled]);
      expect((await at(2 * HOUR, [event(disabled)])).data).toMatchObject({ accepted: 0, rejections: [{ code: "F07-ERR-002" }] });
      expect(await count("product_event", "anonymous_id = $1", [disabled])).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("missing or misbound HYPERDRIVE_F07_EVENTS fails closed with no write and never uses the general Worker channel", async () => {
    const before = await count("product_event");
    const withoutF07 = Object.fromEntries(Object.entries(harness.env()).filter(([name]) => name !== "HYPERDRIVE_F07_EVENTS")) as unknown as Appf2WorkerEnv;
    for (const env of [withoutF07, { ...harness.env(), HYPERDRIVE_F07_EVENTS: { connectionString: "" } }]) {
      expect(await postBatch([event(null), event(randomUUID())], env)).toMatchObject({ status: 503, code: "API-SERVICE-UNAVAILABLE" });
    }
    const misbound = await postBatch([event(null), event(randomUUID())], { ...harness.env(), HYPERDRIVE_F07_EVENTS: { connectionString: logins.worker.url } });
    expect(misbound).toMatchObject({ status: 200, data: { accepted: 0, rejections: [{ code: "F07-ERR-010" }, { code: "F07-ERR-010" }] } });
    expect(await count("product_event")).toBe(before);
    expect(await postBatch([event(null)])).toMatchObject({ status: 200, data: { accepted: 1 } });
  });
});
