import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, test } from "vitest";

import { verifyAdmissionLineage } from "../../src/platform/blueprint/admission-lineage.js";
import { canonicalBlueprintBytes, canonicalizeJson } from "../../src/platform/blueprint/canonical-json.js";
import { hashBlueprint, hashCanonicalBlueprintBytes } from "../../src/platform/blueprint/content-identity.js";
import { createExecutionAdmissionService, type ExecutionAdmissionDecision } from "../../src/platform/blueprint/execution-admission.js";
import { PostgresOriginalIntentReadRepository } from "../../src/platform/blueprint/original-intent-lineage.js";
import { PostgresAdmissionLineageSource, POSTGRES_COMPARE_AND_SET_TRUST_STATUS_SQL } from "../../src/platform/blueprint/postgres-blueprint-repository.js";
import { WorkerPostgresExecutor, type WorkerRequestDbContext } from "../../src/platform/blueprint/worker-postgres-executor.js";
import { CURRENT_BUNDLED_RELEASE, createBundledReleaseSource } from "../../src/platform/capabilities/bundled-release.js";
import { handlersFor, RUNTIME_VERSION, SCHEMA_RANGE } from "../contract/execution-safety-fixtures.js";
import { blueprintCandidate } from "./f01-harness.js";
import { adminUrl, realPgHarness, type Session } from "./pg001-real-pg-harness.js";

/**
 * PG-001 same-hash original-Intent read on real PostgreSQL. Two lawful Intents (separate P-256 key + scoped cookie)
 * compile the identical fixture Blueprint; each must read and freshly admit it through its OWN lineage (A) plus the
 * integrity verdict of the FIRST admitting run (B), while every other context gets nothing. Execution admission uses
 * the contract-test handler catalog for CURRENT_BUNDLED_RELEASE (fixture), not the S03 PoC handlers.
 */
const harness = realPgHarness("read");
const { logins, createIntent, compile, sql, passedRunsFor, contents, sqlStateAs } = harness;
const UNREACHABLE_DB = "postgres://outage:outage@127.0.0.1:1/outage";

const ctx = (session: Session): WorkerRequestDbContext => ({ anonymousId: session.anonymousId, intentId: session.intentId });

async function withRepo<T>(context: WorkerRequestDbContext, fn: (repo: PostgresOriginalIntentReadRepository) => Promise<T>, url = logins.worker.url): Promise<T> {
  const executor = new WorkerPostgresExecutor({ connectionString: url }, context);
  try {
    return await fn(new PostgresOriginalIntentReadRepository(executor));
  } finally {
    await executor.close().catch(() => undefined);
  }
}

const admit = (context: WorkerRequestDbContext, hash: string, url?: string): Promise<ExecutionAdmissionDecision> =>
  withRepo(context, (repo) =>
    createExecutionAdmissionService({
      content: repo,
      releases: createBundledReleaseSource({ bundledHandlers: handlersFor(CURRENT_BUNDLED_RELEASE) }),
      runtimeVersion: RUNTIME_VERSION,
      supportedBlueprintSchemaRange: SCHEMA_RANGE
    }).admit(hash), url);

interface ReadView {
  readonly lineage: Awaited<ReturnType<PostgresOriginalIntentReadRepository["verifyLineage"]>>;
  readonly body: "FOUND" | "NOT_ADMITTED";
  readonly bodyHash: string | null;
  readonly admission: string;
}

async function view(context: WorkerRequestDbContext, hash: string): Promise<ReadView> {
  const lineage = await withRepo(context, (repo) => repo.verifyLineage(hash));
  const body = await withRepo(context, (repo) => repo.readCanonicalBody(hash));
  const decision = await admit(context, hash);
  return {
    lineage,
    body: body.kind,
    bodyHash: body.kind === "FOUND" ? hashCanonicalBlueprintBytes(body.bytes) : null,
    admission: decision.executable ? "EXECUTABLE" : `${decision.step}:${decision.error_code ?? decision.http_status ?? "-"}`
  };
}

async function workerCount(context: WorkerRequestDbContext, statement: string, parameters: readonly unknown[]): Promise<number> {
  const executor = new WorkerPostgresExecutor({ connectionString: logins.worker.url }, context);
  try {
    return (await executor.query<{ n: number }>(statement, parameters)).rows[0]?.n ?? -1;
  } finally {
    await executor.close();
  }
}

async function integrityRowsAs(context: WorkerRequestDbContext, hash: string): Promise<Record<string, unknown>[]> {
  const executor = new WorkerPostgresExecutor({ connectionString: logins.worker.url }, context);
  try {
    return [...(await executor.query<Record<string, unknown>>("SELECT * FROM public.appf2_original_admission_integrity($1)", [hash])).rows];
  } finally {
    await executor.close();
  }
}

async function revoke(hash: string): Promise<void> {
  const trust = new Client({ connectionString: logins.trust.url });
  await trust.connect();
  try {
    await trust.query("BEGIN");
    await trust.query("SET LOCAL ROLE appf2_f02_trust");
    await trust.query("SELECT set_config('app.trust_transition_content_hash', $1, true)", [hash]);
    const transition = await trust.query(POSTGRES_COMPARE_AND_SET_TRUST_STATUS_SQL, [hash, "VALIDATED", "REVOKED"]);
    await trust.query("COMMIT");
    expect(transition.rows[0]).toMatchObject({ transitioned: true });
  } finally {
    await trust.end();
  }
}

let a: Session;
let b: Session;
let c: Session;
let hash = "";

describe.skipIf(adminUrl === undefined)("PG-001 same-hash original-Intent read on real PostgreSQL", () => {
  test("two lawful Intents compile the identical Blueprint: one immutable content row, two PASSED runs", async () => {
    a = await createIntent();
    b = await createIntent();
    c = await createIntent();
    const first = await compile(a, "compile-1");
    const second = await compile(b, "compile-1");
    expect(first).toMatchObject({ status: 200 });
    hash = first.hash as string;
    expect(second).toMatchObject({ status: 200, hash });
    expect(await contents()).toHaveLength(1);
    expect(await passedRunsFor(a.intentId)).toBe(1);
    expect(await passedRunsFor(b.intentId)).toBe(1);
    const [admitting] = await sql<{ intent_id: string }>(
      `SELECT c.intent_id FROM public.blueprint_content b JOIN public.validation_run v ON v.validation_run_id = b.admitted_by_validation_run_id
       JOIN public.compiler_run c ON c.compiler_run_id = v.compiler_run_id WHERE b.content_hash = $1`,
      [hash]
    );
    expect(admitting?.intent_id).toBe(a.intentId);
  });

  test("regression: the original single-join lineage read fails for the second lawful Intent under PG-001 RLS", async () => {
    const legacy = async (context: WorkerRequestDbContext) => {
      const executor = new WorkerPostgresExecutor({ connectionString: logins.worker.url }, context);
      try {
        return await verifyAdmissionLineage(hash, new PostgresAdmissionLineageSource(executor));
      } finally {
        await executor.close();
      }
    };
    expect(await legacy(ctx(a))).toMatchObject({ verified: true });
    expect(await legacy(ctx(b))).toMatchObject({ verified: false, failure: "ADMITTING_RUN_MISSING" });
  });

  test("each lawful Intent reads the body and is freshly admitted through its own lineage + original integrity", async () => {
    const [aRun, bRun] = await Promise.all([a, b].map(async (s) =>
      (await sql<{ validation_run_id: string; registry_digest: string }>(
        `SELECT v.validation_run_id, v.report->>'registry_digest' AS registry_digest FROM public.validation_run v
         JOIN public.compiler_run c ON c.compiler_run_id = v.compiler_run_id WHERE c.intent_id = $1 AND v.status = 'PASSED'`,
        [s.intentId]
      ))[0]));
    for (const [session, run] of [[a, aRun], [b, bRun]] as const) {
      const seen = await view(ctx(session), hash);
      expect(seen).toMatchObject({ body: "FOUND", bodyHash: hash, admission: "EXECUTABLE" });
      expect(seen.lineage).toEqual({
        verified: true, content_hash: hash, own_validation_run_id: run?.validation_run_id, registry_digest: aRun?.registry_digest, trust_status: "VALIDATED"
      });
    }
    console.info(JSON.stringify({ lawful_reads: "A,B FOUND + EXECUTABLE", own_runs_differ: aRun?.validation_run_id !== bRun?.validation_run_id }));
  });

  test("owner RLS stays intact: B cannot see A's admitting run, A cannot see B's run", async () => {
    const runOf = async (s: Session) => (await sql<{ id: string }>(
      `SELECT v.validation_run_id AS id FROM public.validation_run v JOIN public.compiler_run c ON c.compiler_run_id = v.compiler_run_id
       WHERE c.intent_id = $1 AND v.status = 'PASSED'`, [s.intentId]))[0]?.id;
    const count = "SELECT count(*)::int AS n FROM public.validation_run WHERE validation_run_id = $1";
    expect(await workerCount(ctx(b), count, [await runOf(a)])).toBe(0);
    expect(await workerCount(ctx(a), count, [await runOf(b)])).toBe(0);
    expect(await workerCount(ctx(a), count, [await runOf(a)])).toBe(1);
  });
});

describe.skipIf(adminUrl === undefined)("PG-001 same-hash read: foreign, forged and failing contexts get nothing", () => {
  test("third Intent, hash-only and forged identity pairings: no body, no provenance, not executable", async () => {
    const denied = { body: "NOT_ADMITTED", bodyHash: null };
    const contexts: Record<string, WorkerRequestDbContext> = {
      third_intent: ctx(c),
      hash_only: { anonymousId: null, intentId: null },
      random_ids: { anonymousId: randomUUID(), intentId: randomUUID() },
      b_intent_with_c_anon: { anonymousId: c.anonymousId, intentId: b.intentId },
      c_intent_with_b_anon: { anonymousId: b.anonymousId, intentId: c.intentId },
      b_intent_without_anon: { anonymousId: null, intentId: b.intentId }
    };
    const outcomes: Record<string, unknown> = {};
    for (const [label, context] of Object.entries(contexts)) {
      const seen = await view(context, hash);
      expect(seen, label).toMatchObject(denied);
      expect(seen.lineage.verified, label).toBe(false);
      expect(seen.admission, label).not.toBe("EXECUTABLE");
      expect(await integrityRowsAs(context, hash), label).toEqual([]);
      outcomes[label] = [seen.lineage.verified ? "?" : seen.lineage.failure, seen.admission];
    }
    console.info(JSON.stringify({ denied_contexts: outcomes }));
  });

  test("integrity helper: only verdict + registry_digest, never foreign run fields; no EXECUTE outside appf2_worker", async () => {
    const rows = await integrityRowsAs(ctx(b), hash);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(["registry_digest", "verdict"]);
    expect(rows[0]).toMatchObject({ verdict: "VERIFIED" });
    const privileges = await sql<{ role: string; allowed: boolean }>(
      `SELECT r AS role, has_function_privilege(r, 'public.appf2_original_admission_integrity(text)', 'EXECUTE') AS allowed
       FROM unnest(ARRAY['anon', 'authenticated', 'appf2_retention', 'appf2_f02_trust', 'appf2_worker']) AS r`
    );
    expect(Object.fromEntries(privileges.map((p) => [p.role, p.allowed]))).toEqual({
      anon: false, authenticated: false, appf2_retention: false, appf2_f02_trust: false, appf2_worker: true
    });
    expect(await sqlStateAs(logins.trust.url, ["SET LOCAL ROLE appf2_f02_trust", `SELECT * FROM public.appf2_original_admission_integrity('${hash}')`])).toBe("42501");
    expect(await sqlStateAs(logins.worker.url, [`SELECT * FROM public.appf2_original_admission_integrity('${hash}')`])).toBe("42501");
  });

  test("database outage fails closed: read throws, fresh admission is E08 503, never a stale allow", async () => {
    await expect(withRepo(ctx(b), (repo) => repo.verifyLineage(hash), UNREACHABLE_DB)).rejects.toThrow();
    await expect(withRepo(ctx(b), (repo) => repo.readCanonicalBody(hash), UNREACHABLE_DB)).rejects.toThrow();
    const decision = await admit(ctx(b), hash, UNREACHABLE_DB);
    expect(decision).toMatchObject({ executable: false, step: "E08", http_status: 503 });
  });
});

interface Fixture {
  readonly hash: string;
  readonly canonical: string;
  readonly bytes: number;
}

function variant(title: string): Fixture {
  const body = blueprintCandidate() as { meta: { title: string } };
  body.meta.title = title;
  return { hash: hashBlueprint(body), canonical: canonicalizeJson(body), bytes: canonicalBlueprintBytes(body).byteLength };
}

const sha = (seed: string) => `sha256:${createHash("sha256").update(seed).digest("hex")}`;

interface RunTemplate {
  readonly compiler_run_id: string;
  readonly schema_version: string;
  readonly registry_version: string;
  readonly report: Record<string, unknown>;
}

async function runTemplate(session: Session): Promise<RunTemplate> {
  const [row] = await sql<RunTemplate>(
    `SELECT v.compiler_run_id, v.schema_version, v.registry_version, v.report FROM public.validation_run v
     JOIN public.compiler_run c ON c.compiler_run_id = v.compiler_run_id WHERE c.intent_id = $1 AND v.status = 'PASSED'`,
    [session.intentId]
  );
  if (row === undefined) throw new Error("no PASSED template run");
  return row;
}

type RunTamper = (run: { blueprint_hash: string; status: string; report: Record<string, unknown> }) => void;

/** Test fixture rows written by the scratch DB owner (not a Worker path); validation_run stays insert-only. */
async function insertRun(template: RunTemplate, contentHash: string, tamper: RunTamper = () => undefined): Promise<string> {
  const id = randomUUID();
  const trace = `trace-${id}`;
  const candidate = sha(`candidate-${id}`);
  const run = {
    blueprint_hash: contentHash,
    status: "PASSED",
    report: { ...template.report, validation_run_id: id, content_hash: contentHash, candidate_digest: candidate, trace_id: trace, status: "PASSED", issues: [] }
  };
  tamper(run);
  await sql(
    `INSERT INTO public.validation_run (validation_run_id, compiler_run_id, candidate_digest, blueprint_hash, schema_version, registry_version,
       status, error_codes, report, trace_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, '[]'::jsonb, $8::jsonb, $9)`,
    [id, template.compiler_run_id, candidate, run.status === "PASSED" ? run.blueprint_hash : null, template.schema_version, template.registry_version,
      run.status, JSON.stringify(run.report), trace]
  );
  return id;
}

async function insertContent(fixture: Fixture, admittingRunId: string, storedCanonical = fixture.canonical): Promise<void> {
  const body = JSON.parse(fixture.canonical) as { schema_version: string; registry_version: string };
  await sql(
    `INSERT INTO public.blueprint_content (content_hash, canonical_blueprint, schema_version, registry_version, trust_status, admitted_by_validation_run_id, byte_size)
     VALUES ($1, $2::jsonb, $3, $4, 'VALIDATED', $5, $6)`,
    [fixture.hash, storedCanonical, body.schema_version, body.registry_version, admittingRunId, fixture.bytes]
  );
}

describe.skipIf(adminUrl === undefined)("PG-001 same-hash read: tampered original admission or own lineage is denied", () => {
  test("original admitting run hash / report / registry_digest tampering, own-run tampering and body tampering fail closed", async () => {
    const original = await runTemplate(a);
    const own = await runTemplate(b);
    const cases: { label: string; originalTamper?: RunTamper; ownTamper?: RunTamper; bodyFrom?: string; expectLineage: string; expectAdmission: RegExp }[] = [
      { label: "control-intact", expectLineage: "VERIFIED", expectAdmission: /^EXECUTABLE$/u },
      { label: "original-run-hash", originalTamper: (r) => { r.blueprint_hash = sha("other-content"); }, expectLineage: "ADMITTING_RUN_HASH_MISMATCH", expectAdmission: /^E06:/u },
      { label: "original-not-passed", originalTamper: (r) => { r.status = "REJECTED"; }, expectLineage: "ADMITTING_RUN_NOT_PASSED", expectAdmission: /^E06:/u },
      { label: "original-report-hash", originalTamper: (r) => { r.report.content_hash = sha("relabelled"); }, expectLineage: "ADMITTING_REPORT_MISMATCH", expectAdmission: /^E06:/u },
      { label: "original-registry-digest-missing", originalTamper: (r) => { delete r.report.registry_digest; }, expectLineage: "ADMITTING_REPORT_MISMATCH", expectAdmission: /^E06:/u },
      { label: "original-registry-digest-swapped", originalTamper: (r) => { r.report.registry_digest = sha("foreign-release"); }, expectLineage: "VERIFIED", expectAdmission: /^E06:/u },
      { label: "own-run-report", ownTamper: (r) => { r.report.trace_id = "relabelled-trace"; }, expectLineage: "OWN_RUN_MISMATCH", expectAdmission: /^E06:/u },
      { label: "stored-body", bodyFrom: "PG-001 tamper donor body", expectLineage: "BODY_INTEGRITY_FAILURE", expectAdmission: /^E04-B:F02-ERR-015$/u }
    ];
    const results: Record<string, [string, string, string]> = {};
    for (const item of cases) {
      const fixture = variant(`PG-001 tamper ${item.label}`);
      const originalId = await insertRun(original, fixture.hash, item.originalTamper);
      await insertRun(own, fixture.hash, item.ownTamper);
      await insertContent(fixture, originalId, item.bodyFrom === undefined ? fixture.canonical : variant(item.bodyFrom).canonical);
      const seen = await view(ctx(b), fixture.hash);
      const lineage = seen.lineage.verified ? "VERIFIED" : seen.lineage.failure;
      results[item.label] = [lineage, seen.body, seen.admission];
      expect(lineage, item.label).toBe(item.expectLineage);
      expect(seen.admission, item.label).toMatch(item.expectAdmission);
      expect(seen.body, item.label).toBe(item.expectLineage === "VERIFIED" ? "FOUND" : "NOT_ADMITTED");
      expect((await view(ctx(c), fixture.hash)).body, `${item.label} third intent`).toBe("NOT_ADMITTED");
    }
    console.info(JSON.stringify({ tamper_matrix: results }));
  });

  test("revocation: lineage and body permission remain, but fresh admission is E02 F02-ERR-016 for both lawful Intents", async () => {
    await revoke(hash);
    for (const session of [a, b]) {
      const seen = await view(ctx(session), hash);
      expect(seen.lineage).toMatchObject({ verified: true, trust_status: "REVOKED" });
      expect(seen.admission).toBe("E02:F02-ERR-016");
    }
    expect((await view(ctx(c), hash)).body).toBe("NOT_ADMITTED");
    const late = await createIntent();
    const recompiled = await compile(late, "compile-1");
    expect(recompiled.status === 200 && recompiled.hash === hash).toBe(false);
    expect((await contents()).find((row) => row.content_hash === hash)?.trust_status).toBe("REVOKED");
    console.info(JSON.stringify({ revoked: { a: (await view(ctx(a), hash)).admission, b: (await view(ctx(b), hash)).admission, recompile: [recompiled.status, recompiled.code] } }));
  });
});
