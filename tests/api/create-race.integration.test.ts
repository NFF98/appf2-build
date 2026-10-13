import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, test } from "vitest";

import { WorkerPostgresExecutor } from "../../src/platform/blueprint/worker-postgres-executor.js";
import { adminUrl, CREATE_PATH, realPgHarness, type PopKey } from "./pg001-real-pg-harness.js";

/**
 * F01-RACE-001 (Human-approved): a PoP-valid CREATE that loses the same-key race to another anonymous_id may leave only
 * a bounded F07 anonymous_identity row. Zero Intent / idempotency operation / compiler run / Blueprint, no cookie, no
 * grant, no foreign access. Real PostgreSQL, real single-holder index; model = deterministic fixture.
 */
const harness = realPgHarness("race");
const { sql } = harness;

interface CreateOutcome {
  readonly anonymousId: string;
  readonly status: number;
  readonly code: string | null;
  readonly reason: string | null;
  readonly intentId: string | null;
  readonly cookie: string | null;
}

async function create(key: PopKey, anonymousId: string): Promise<CreateOutcome> {
  const body = { anonymous_id: anonymousId, intent_kind: "CREATE", raw_intent: "Split a dinner bill between friends" };
  const response = await harness.signedPost(key, CREATE_PATH, body, key.createKey, { cookie: null });
  const json = (await response.json()) as { data?: { intent_id?: string }; error?: { code?: string; details?: { violations?: { reason?: string }[] } } };
  return {
    anonymousId,
    status: response.status,
    code: json.error?.code ?? null,
    reason: json.error?.details?.violations?.[0]?.reason ?? null,
    intentId: json.data?.intent_id ?? null,
    cookie: response.headers.get("set-cookie")
  };
}

async function footprint(anonymousId: string) {
  const [row] = await sql<Record<string, number>>(`SELECT
    (SELECT count(*)::int FROM public.intent_record WHERE anonymous_id = $1) AS intents,
    (SELECT count(*)::int FROM public.idempotency_operation WHERE anonymous_id = $1) AS operations,
    (SELECT count(*)::int FROM public.compiler_run c JOIN public.intent_record i ON i.intent_id = c.intent_id
       WHERE i.anonymous_id = $1) AS compiler_runs,
    (SELECT count(*)::int FROM public.validation_run v JOIN public.compiler_run c ON c.compiler_run_id = v.compiler_run_id
       JOIN public.intent_record i ON i.intent_id = c.intent_id WHERE i.anonymous_id = $1) AS validation_runs,
    (SELECT count(*)::int FROM public.product_event WHERE anonymous_id = $1) AS product_events,
    (SELECT count(*)::int FROM public.anonymous_identity WHERE anonymous_id = $1) AS identities`, [anonymousId]);
  return row;
}

const holders = async (key: PopKey) => sql<{ anonymous_id: string }>("SELECT anonymous_id FROM public.idempotency_operation WHERE idempotency_key = $1", [key.createKey]);
const blueprints = async () => (await sql<{ n: number }>("SELECT count(*)::int AS n FROM public.blueprint_content"))[0]?.n;

async function waitForBlockedClaims(expected: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [row] = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM pg_locks
      WHERE database = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND relation = 'public.idempotency_operation'::regclass AND NOT granted`);
    if (row?.n === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`expected ${expected} CREATE claims blocked on idempotency_operation`);
}

/** Both CREATEs pass the pre-write check and identity ensure, then race the single-holder index on release. */
async function lockedRace(key: PopKey, anonymousIds: readonly string[]): Promise<CreateOutcome[]> {
  const lock = new Client({ connectionString: harness.scratchUrl() });
  await lock.connect();
  try {
    await lock.query("BEGIN");
    await lock.query("LOCK TABLE public.idempotency_operation IN SHARE MODE");
    const racing = anonymousIds.map((anonymousId) => create(key, anonymousId));
    await waitForBlockedClaims(anonymousIds.length);
    await lock.query("COMMIT");
    return await Promise.all(racing);
  } finally {
    await lock.end();
  }
}

async function workerSeesIntent(anonymousId: string, intentId: string): Promise<number> {
  const executor = new WorkerPostgresExecutor({ connectionString: harness.logins.worker.url }, { anonymousId, intentId });
  try {
    return (await executor.query("SELECT intent_id FROM public.intent_record WHERE intent_id = $1", [intentId])).rows.length;
  } finally {
    await executor.close();
  }
}

describe.skipIf(adminUrl === undefined)("PG-001 CREATE same-key race loser on real PostgreSQL", () => {
  test("locked race: loser leaves only an anonymous_identity row; no Intent, operation, run, Blueprint, cookie or access", async () => {
    const key = await harness.popKey();
    const blueprintsBefore = await blueprints();
    const outcomes = await lockedRace(key, [randomUUID(), randomUUID()]);
    const winner = outcomes.find((outcome) => outcome.status === 200);
    const loser = outcomes.find((outcome) => outcome.status !== 200);
    if (winner === undefined || loser === undefined || winner.intentId === null) throw new Error(JSON.stringify(outcomes));
    expect(winner.cookie).not.toBeNull();
    expect(loser).toMatchObject({ status: 400, code: "F01-ERR-001", reason: "PROOF_INVALID", intentId: null, cookie: null });
    expect(await holders(key)).toEqual([{ anonymous_id: winner.anonymousId }]);
    const loserFootprint = { intents: 0, operations: 0, compiler_runs: 0, validation_runs: 0, product_events: 0, identities: 1 };
    expect(await footprint(loser.anonymousId)).toEqual(loserFootprint);
    expect(await footprint(winner.anonymousId)).toMatchObject({ intents: 1, operations: 1, identities: 1 });

    const retries = [await create(key, loser.anonymousId), await create(key, loser.anonymousId)];
    for (const retry of retries) expect(retry).toMatchObject({ status: 400, code: "F01-ERR-001", reason: "PROOF_INVALID", cookie: null });
    expect(await footprint(loser.anonymousId)).toEqual(loserFootprint);
    expect(await create(key, winner.anonymousId)).toMatchObject({ status: 200, intentId: winner.intentId });
    expect(await holders(key)).toEqual([{ anonymous_id: winner.anonymousId }]);

    const takeover = await harness.readOutcome(await harness.signedPost(key, `${CREATE_PATH}/${winner.intentId}/compile`, { intent_version: 1 }, "compile-takeover", { cookie: null }));
    expect(takeover).toMatchObject({ status: 400, code: "F01-ERR-001" });
    expect(await workerSeesIntent(loser.anonymousId, winner.intentId)).toBe(0);
    expect(await workerSeesIntent(winner.anonymousId, winner.intentId)).toBe(1);
    expect(await blueprints()).toBe(blueprintsBefore);
    console.info(JSON.stringify({ locked_race: outcomes.map(({ status, code, reason }) => ({ status, code, reason })), loser: await footprint(loser.anonymousId) }));
  });

  test("unsynchronised 6-way race, 3 rounds: exactly one holder and one Intent per key; every loser has zero F01 rows", async () => {
    const rounds: string[] = [];
    for (let round = 0; round < 3; round += 1) {
      const key = await harness.popKey();
      const outcomes = await Promise.all(Array.from({ length: 6 }, () => create(key, randomUUID())));
      const winners = outcomes.filter((outcome) => outcome.status === 200);
      expect(winners).toHaveLength(1);
      expect(await holders(key)).toEqual([{ anonymous_id: winners[0]?.anonymousId }]);
      for (const loser of outcomes.filter((outcome) => outcome.status !== 200)) {
        expect(loser).toMatchObject({ status: 400, code: "F01-ERR-001", reason: "PROOF_INVALID", cookie: null });
        const left = await footprint(loser.anonymousId);
        expect(left).toMatchObject({ intents: 0, operations: 0, compiler_runs: 0, validation_runs: 0, product_events: 0 });
        expect(left?.identities).toBeLessThanOrEqual(1);
      }
      rounds.push(outcomes.map((outcome) => outcome.status).sort().join(","));
    }
    console.info(JSON.stringify({ unsynchronised_rounds: rounds }));
  });
});
