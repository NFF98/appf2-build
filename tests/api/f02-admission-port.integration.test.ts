import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, test } from "vitest";

import { POP_SIGNATURE_HEADER } from "../../src/edge/create-proof.js";
import type { BlueprintContentRecord, ValidationRunRecord } from "../../src/platform/blueprint/blueprint-admission.js";
import { canonicalizeJson } from "../../src/platform/blueprint/canonical-json.js";
import { hashBlueprint } from "../../src/platform/blueprint/content-identity.js";
import { SplitBlueprintAdmissionRepository } from "../../src/platform/blueprint/f02-admission-port.js";
import { POSTGRES_COMPARE_AND_SET_TRUST_STATUS_SQL } from "../../src/platform/blueprint/postgres-blueprint-repository.js";
import { WorkerPostgresExecutor } from "../../src/platform/blueprint/worker-postgres-executor.js";
import { blueprintCandidate } from "./f01-harness.js";
import { adminUrl, CREATE_PATH, realPgHarness, type Outcome, type PostOptions, type Session } from "./pg001-real-pg-harness.js";

const UNREACHABLE_DB = "postgres://outage:outage@127.0.0.1:1/outage";
const OWNED_TABLES: readonly (readonly [string, string])[] = [
  ["anonymous_identity", "anonymous_id = $1 AND $2::uuid IS NOT NULL"],
  ["product_event", "anonymous_id = $1 AND $2::uuid IS NOT NULL"],
  ["intent_record", "anonymous_id = $1 AND intent_id = $2"],
  ["idempotency_operation", "anonymous_id = $1 AND $2::uuid IS NOT NULL"],
  ["compiler_run", "intent_id = $2 AND $1::uuid IS NOT NULL"],
  ["validation_run", "compiler_run_id IN (SELECT compiler_run_id FROM public.compiler_run WHERE intent_id = $2) AND $1::uuid IS NOT NULL"]
];

const harness = realPgHarness("f02");
const { logins, popKey, signedPost, readOutcome, createIntent, compile, sql, passedRunsFor, contents, sqlStateAs } = harness;

async function workerSees(context: { anonymousId: string; intentId: string }, hash: string): Promise<number> {
  const executor = new WorkerPostgresExecutor({ connectionString: logins.worker.url }, context);
  try {
    const rows = await executor.query<{ n: number }>("SELECT count(*)::int AS n FROM public.blueprint_content WHERE content_hash = $1", [hash]);
    return rows.rows[0]?.n ?? -1;
  } finally {
    await executor.close();
  }
}

let first: Session;
let firstHash = "";

describe.skipIf(adminUrl === undefined)("PG-001 F02 admission port on real PostgreSQL", () => {
  test("legitimate compile admits Blueprint + PASSED validation_run atomically via the F02 port; replay is stable", async () => {
    first = await createIntent();
    const compiled = await compile(first, "compile-1");
    expect(compiled).toMatchObject({ status: 200, code: null });
    expect(compiled.hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    firstHash = compiled.hash as string;

    const [row] = await contents();
    expect(row).toMatchObject({ content_hash: firstHash, trust_status: "VALIDATED" });
    const admittedBy = await sql<{ status: string; blueprint_hash: string; intent_id: string }>(
      `SELECT v.status, v.blueprint_hash, c.intent_id FROM public.validation_run v
       JOIN public.compiler_run c ON c.compiler_run_id = v.compiler_run_id WHERE v.validation_run_id = $1`,
      [row?.admitted_by_validation_run_id]
    );
    expect(admittedBy).toEqual([{ status: "PASSED", blueprint_hash: firstHash, intent_id: first.intentId }]);

    const replay = await compile(first, "compile-1");
    expect(replay).toMatchObject({ status: 200, hash: firstHash });
    expect(await contents()).toHaveLength(1);
    expect(await passedRunsFor(first.intentId)).toBe(1);
  });

  test("general Worker login cannot assume appf2_f02_admission nor write blueprint_content; misbound port fails closed", async () => {
    expect(await sqlStateAs(logins.worker.url, ["SET LOCAL ROLE appf2_f02_admission"])).toBe("42501");
    expect(await sqlStateAs(logins.worker.url, [
      "SET LOCAL ROLE appf2_worker",
      "INSERT INTO public.blueprint_content (content_hash) VALUES ('sha256:forged')"
    ])).toBe("42501");
    expect(await sqlStateAs(logins.admission.url, ["SET LOCAL ROLE appf2_f02_trust"])).toBe("42501");
    expect(await sqlStateAs(logins.admission.url, ["SET LOCAL ROLE appf2_retention"])).toBe("42501");

    const before = await contents();
    const session = await createIntent();
    const misbound = await compile(session, "compile-1", { HYPERDRIVE_F02_ADMISSION: { connectionString: logins.worker.url } });
    expect(misbound.status).not.toBe(200);
    expect(await passedRunsFor(session.intentId)).toBe(0);
    expect(await contents()).toEqual(before);
  });

  test("second legitimate intent with the same Blueprint reuses content with its own lineage; foreign intent cannot read", async () => {
    const second = await createIntent();
    const compiled = await compile(second, "compile-1");
    expect(compiled).toMatchObject({ status: 200, hash: firstHash });
    const rows = await contents();
    expect(rows).toHaveLength(1);
    expect(await passedRunsFor(second.intentId)).toBe(1);
    expect(await workerSees({ anonymousId: second.anonymousId, intentId: second.intentId }, firstHash)).toBe(1);
    expect(await workerSees({ anonymousId: first.anonymousId, intentId: first.intentId }, firstHash)).toBe(1);
    expect(await workerSees({ anonymousId: randomUUID(), intentId: randomUUID() }, firstHash)).toBe(0);
  });

  test("external holder: another PoP key with the owner's scoped cookie, or the owner's key without cookie, cannot compile", async () => {
    const victim = await createIntent();
    const attacker = await popKey();
    const before = await contents();
    const foreignKey = await compile(victim, "compile-1", undefined, attacker, victim.cookie);
    const noCookie = await compile(victim, "compile-2", undefined, victim.key, null);
    expect(foreignKey.status).toBeGreaterThanOrEqual(400);
    expect(foreignKey.status).toBeLessThan(500);
    expect(noCookie.status).toBeGreaterThanOrEqual(400);
    expect(noCookie.status).toBeLessThan(500);
    expect(await passedRunsFor(victim.intentId)).toBe(0);
    expect(await contents()).toEqual(before);
  });

  test("cross-site, missing PoP signature and tampered body cannot compile", async () => {
    const victim = await createIntent();
    const before = await contents();
    const path = `${CREATE_PATH}/${victim.intentId}/compile`;
    const body = { intent_version: victim.intentVersion };
    const post = async (idempotencyKey: string, options: Omit<PostOptions, "cookie">) =>
      readOutcome(await signedPost(victim.key, path, body, idempotencyKey, { cookie: victim.cookie, ...options }));
    const crossSite = await post("compile-1", { headerPatch: { "Sec-Fetch-Site": "cross-site", Origin: "https://evil.example" } });
    const noSignature = await post("compile-2", { headerPatch: { [POP_SIGNATURE_HEADER]: null } });
    const tampered = await post("compile-3", { sentBody: JSON.stringify({ intent_version: victim.intentVersion + 1 }) });
    for (const outcome of [crossSite, noSignature, tampered]) {
      expect(outcome.status).toBeGreaterThanOrEqual(400);
      expect(outcome.status).toBeLessThan(500);
    }
    const reason = (outcome: Outcome) =>
      (outcome.body as { error?: { details?: { violations?: { reason?: string }[] } } } | null)?.error?.details?.violations?.[0]?.reason ?? null;
    for (const outcome of [crossSite, noSignature, tampered]) {
      expect(outcome).toMatchObject({ status: 400, code: "F01-ERR-001" });
      expect(reason(outcome)).toBe("TRUSTED_IDENTITY_REQUIRED");
    }
    expect(await passedRunsFor(victim.intentId)).toBe(0);
    expect(await contents()).toEqual(before);
    const control = await compile(victim, "compile-4");
    expect(control).toMatchObject({ status: 200, hash: firstHash });
    console.info(JSON.stringify({ denied: [crossSite, noSignature, tampered].map((o) => [o.status, o.code, reason(o)]), control: control.status }));
  });

  test("F02-only credential cannot read or write unrelated F01/F07 rows", async () => {
    const owned: Record<string, number> = {};
    for (const [table, where] of OWNED_TABLES) owned[table] = (await sql<{ n: number }>(`SELECT count(*)::int AS n FROM public.${table} WHERE ${where}`, [first.anonymousId, first.intentId]))[0]?.n ?? -1;
    for (const table of ["anonymous_identity", "intent_record", "idempotency_operation", "compiler_run", "validation_run"]) expect(owned[table]).toBeGreaterThan(0);

    expect(await sqlStateAs(logins.admission.url, ["SELECT count(*) FROM public.intent_record"])).toBe("42501");
    const f02 = new Client({ connectionString: logins.admission.url });
    await f02.connect();
    const seen: Record<string, number> = {};
    try {
      await f02.query("BEGIN");
      await f02.query("SELECT set_config('app.anonymous_id', $1, true), set_config('app.intent_id', $2, true)", [randomUUID(), randomUUID()]);
      await f02.query("SET LOCAL ROLE appf2_f02_admission");
      for (const [table, where] of OWNED_TABLES) {
        seen[table] = (await f02.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.${table} WHERE ${where}`, [first.anonymousId, first.intentId])).rows[0]?.n ?? -1;
      }
      const updated = await f02.query("UPDATE public.intent_record SET updated_at = updated_at WHERE intent_id = $1", [first.intentId]);
      expect(updated.rowCount).toBe(0);
      await f02.query("ROLLBACK");
    } finally {
      await f02.end();
    }
    expect(seen).toEqual(Object.fromEntries(OWNED_TABLES.map(([table]) => [table, 0])));
    expect(await sqlStateAs(logins.admission.url, ["SET LOCAL ROLE appf2_f02_admission", "DELETE FROM public.product_event"])).toBe("42501");
    expect(await sqlStateAs(logins.admission.url, ["SET LOCAL ROLE appf2_f02_admission", "DELETE FROM public.intent_record"])).toBe("42501");
    expect(await sqlStateAs(logins.admission.url, [
      `SELECT set_config('app.anonymous_id', '${randomUUID()}', true)`,
      "SET LOCAL ROLE appf2_f02_admission",
      `INSERT INTO public.intent_record (intent_id, anonymous_id, intent_kind, lifecycle_status, intent_version)
       VALUES ('${randomUUID()}', '${first.anonymousId}', 'CREATE', 'READY', 1)`
    ])).toBe("42501");
    console.info(JSON.stringify({ f02_foreign_context: { owned, seen } }));
  });
});

describe.skipIf(adminUrl === undefined)("PG-001 F02 admission port on real PostgreSQL: rollback, outage and revocation", () => {
  test("F02 port refuses a hash it did not compute and rolls back content when the run insert fails", async () => {
    const [template] = await sql<Record<string, unknown>>(
      `SELECT v.*, b.schema_version AS content_schema_version, b.registry_version AS content_registry_version
       FROM public.validation_run v JOIN public.blueprint_content b ON b.admitted_by_validation_run_id = v.validation_run_id`
    );
    const variant = blueprintCandidate() as { meta: { title: string } };
    variant.meta.title = "F02 rollback probe";
    const canonical = canonicalizeJson(variant);
    const variantHash = hashBlueprint(variant);
    const run = (blueprintHash: string): ValidationRunRecord => ({
      validation_run_id: randomUUID(),
      compiler_run_id: randomUUID(),
      candidate_digest: String(template?.candidate_digest),
      blueprint_hash: blueprintHash,
      schema_version: String(template?.schema_version),
      registry_version: String(template?.registry_version),
      status: "PASSED",
      error_codes: [],
      report: template?.report as ValidationRunRecord["report"],
      created_at: new Date().toISOString(),
      trace_id: randomBytes(16).toString("hex")
    });
    const content = (contentHash: string): BlueprintContentRecord => ({
      content_hash: contentHash,
      canonical_blueprint: canonical,
      schema_version: String(template?.content_schema_version),
      registry_version: String(template?.content_registry_version),
      trust_status: "VALIDATED",
      created_at: new Date().toISOString(),
      admitted_by_validation_run_id: randomUUID(),
      byte_size: new TextEncoder().encode(canonical).byteLength
    });
    const workerExecutor = new WorkerPostgresExecutor({ connectionString: logins.worker.url }, first);
    const repository = new SplitBlueprintAdmissionRepository(workerExecutor, { connectionString: logins.admission.url }, first);
    try {
      await expect(repository.admitValidatedContent(run(firstHash), content(firstHash))).rejects.toThrow(/server-computed hash/u);
      const unanchored = run(variantHash);
      await expect(repository.admitValidatedContent(unanchored, { ...content(variantHash), admitted_by_validation_run_id: unanchored.validation_run_id }))
        .rejects.toMatchObject({ code: expect.stringMatching(/^(42501|23503)$/u) });
      expect((await contents()).map((row) => row.content_hash)).toEqual([firstHash]);
      const noContext = new SplitBlueprintAdmissionRepository(workerExecutor, { connectionString: logins.admission.url }, { anonymousId: null, intentId: null });
      await expect(noContext.admitValidatedContent(run(variantHash), content(variantHash))).rejects.toThrow(/no verified intent context/u);
    } finally {
      await workerExecutor.close();
    }
  });

  test("F02 database outage and model provider outage fail closed with zero admission; a later retry succeeds", async () => {
    const before = await contents();
    const dbOutage = await createIntent();
    const failed = await compile(dbOutage, "compile-1", { HYPERDRIVE_F02_ADMISSION: { connectionString: UNREACHABLE_DB } });
    expect(failed.status).not.toBe(200);
    expect(await passedRunsFor(dbOutage.intentId)).toBe(0);
    expect(await contents()).toEqual(before);
    // F01 §23 / Shared API rule 12: the interrupted compile keeps its 30 s route lease; no second logical compile meanwhile.
    expect(await compile(dbOutage, "compile-1")).toMatchObject({ status: 409, code: "API-IDEMPOTENCY-IN-PROGRESS" });
    expect(await compile(dbOutage, "compile-2")).toMatchObject({ status: 409, code: "F01-ERR-004" });
    expect(await passedRunsFor(dbOutage.intentId)).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 31_000));
    const recovered = await compile(dbOutage, "compile-1");
    expect(recovered).toMatchObject({ status: 200, hash: firstHash });
    expect(await passedRunsFor(dbOutage.intentId)).toBe(1);

    const provider = await createIntent();
    harness.setProviderDown(true);
    const down = await compile(provider, "compile-1").finally(() => harness.setProviderDown(false));
    expect(down.status).not.toBe(200);
    expect(await passedRunsFor(provider.intentId)).toBe(0);
    const retried = await compile(provider, "compile-1");
    console.info(JSON.stringify({ f02_db_outage: [failed.status, failed.code], provider_outage: [down.status, down.code], provider_retry: [retried.status, retried.code] }));
    expect(retried).toMatchObject({ status: 200, hash: firstHash });
  }, 90_000);

  test("REVOKED content is never resurrected to VALIDATED by a repeat compile from a new intent", async () => {
    const trust = new Client({ connectionString: logins.trust.url });
    await trust.connect();
    try {
      await trust.query("BEGIN");
      await trust.query("SET LOCAL ROLE appf2_f02_trust");
      await trust.query("SELECT set_config('app.trust_transition_content_hash', $1, true)", [firstHash]);
      const transition = await trust.query(POSTGRES_COMPARE_AND_SET_TRUST_STATUS_SQL, [firstHash, "VALIDATED", "REVOKED"]);
      await trust.query("COMMIT");
      expect(transition.rows[0]).toMatchObject({ transitioned: true });
    } finally {
      await trust.end();
    }
    const late = await createIntent();
    const refused = await compile(late, "compile-1");
    expect(refused.status === 200 && refused.hash === firstHash).toBe(false);
    expect(await contents()).toEqual([expect.objectContaining({ content_hash: firstHash, trust_status: "REVOKED" })]);
    console.info(JSON.stringify({ revoked_recompile: [refused.status, refused.code] }));
  });
});
