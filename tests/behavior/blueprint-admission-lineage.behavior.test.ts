import { describe, expect, test } from "vitest";

import { verifyAdmissionLineage, type AdmissionLineageFailure } from "../../src/platform/blueprint/admission-lineage.js";
import { admitBlueprint } from "../../src/platform/blueprint/blueprint-admission.js";
import { hashBlueprint } from "../../src/platform/blueprint/content-identity.js";
import {
  POSTGRES_READ_ADMISSION_LINEAGE_SQL,
  PostgresAdmissionLineageSource
} from "../../src/platform/blueprint/postgres-blueprint-repository.js";
import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import type { BlueprintValidationResult } from "../../src/platform/blueprint/validation-types.js";
import { FakeBlueprintPostgres } from "../contract/blueprint-postgres-fake.js";
import { validBlueprint, withValue, type JsonRecord } from "../contract/blueprint-validation-fixtures.js";
import { durableStore, NOW, traceOf, uuid, type DurableStore } from "../runtime/blueprint-evidence-support.js";

const RUN_A = uuid(0xa);
const RUN_B = uuid(0xb);
const RUN_C = uuid(0xc);
const RUN_D = uuid(0xd);
const MISSING_RUN = uuid(0xdead);

function validate(candidate: JsonRecord, validationRunId: string, indent?: number): BlueprintValidationResult {
  return validateBlueprintCandidate(new TextEncoder().encode(JSON.stringify(candidate, null, indent)), {
    validationRunId,
    traceId: traceOf(Number.parseInt(validationRunId.slice(-4), 16))
  });
}

function retitled(): JsonRecord {
  const candidate = validBlueprint();
  candidate.meta = { title: "另一個 App", description: "" };
  return candidate;
}

/** Copy of the durable tables with one row rewritten, read back through the Postgres lineage port. */
async function tamperedLineageFailure(store: DurableStore, contentHash: string, tamper: (database: FakeBlueprintPostgres) => void): Promise<unknown> {
  const database = new FakeBlueprintPostgres();
  for (const [key, row] of store.database.contents) {
    database.contents.set(key, structuredClone(row));
  }
  for (const [key, row] of store.database.runs) {
    database.runs.set(key, structuredClone(row));
  }
  tamper(database);
  const lineage = await verifyAdmissionLineage(contentHash, new PostgresAdmissionLineageSource(database));
  return lineage.verified ? "VERIFIED" : lineage.failure;
}

async function expectTamperedLineageRejected(store: DurableStore, contentHash: string, otherHash: string): Promise<void> {
  const content = (database: FakeBlueprintPostgres) => database.contents.get(contentHash)!;
  const runA = (database: FakeBlueprintPostgres) => database.runs.get(RUN_A)!;
  const cases: readonly [string, (database: FakeBlueprintPostgres) => void, AdmissionLineageFailure][] = [
    ["admitted_by points at no validation_run", (db) => db.contents.set(contentHash, { ...content(db), admitted_by_validation_run_id: MISSING_RUN }), "ADMITTING_RUN_MISSING"],
    ["admitted_by points at a REJECTED run", (db) => db.contents.set(contentHash, { ...content(db), admitted_by_validation_run_id: RUN_C }), "ADMITTING_RUN_NOT_PASSED"],
    ["admitted_by points at another content's PASSED run", (db) => db.contents.set(contentHash, { ...content(db), admitted_by_validation_run_id: RUN_D }), "ADMITTING_RUN_HASH_MISMATCH"],
    ["admitting report content_hash drifted", (db) => db.runs.set(RUN_A, { ...runA(db), report: { ...runA(db).report, content_hash: otherHash } }), "ADMITTING_REPORT_MISMATCH"],
    ["admitting report trace_id drifted", (db) => db.runs.set(RUN_A, { ...runA(db), report: { ...runA(db).report, trace_id: traceOf(0xbad) } }), "ADMITTING_REPORT_MISMATCH"],
    ["admitting report candidate_digest drifted", (db) => db.runs.set(RUN_A, { ...runA(db), report: { ...runA(db).report, candidate_digest: otherHash } }), "ADMITTING_REPORT_MISMATCH"],
    ["content registry_version drifted from the admitting run", (db) => db.contents.set(contentHash, { ...content(db), registry_version: "7.0.1" }), "VERSION_MISMATCH"],
    ["canonical body rewritten", (db) => db.contents.set(contentHash, { ...content(db), canonical_blueprint: retitled() }), "BODY_INTEGRITY_FAILURE"],
    ["byte_size drifted", (db) => db.contents.set(contentHash, { ...content(db), byte_size: content(db).byte_size + 1 }), "BODY_INTEGRITY_FAILURE"]
  ];
  for (const [label, tamper, failure] of cases) {
    expect(await tamperedLineageFailure(store, contentHash, tamper), label).toBe(failure);
  }
  expect(await tamperedLineageFailure(store, contentHash, () => undefined), "untampered copy").toBe("VERIFIED");
}

describe("F02 admitted Blueprint validation lineage", () => {
  test("TEST-F02-021 admitted Blueprint content traces mechanically to its admitting validation_run", async () => {
    const store = durableStore();
    const first = validate(validBlueprint(), RUN_A);
    const contentHash = first.report.content_hash ?? "";
    expect(await admitBlueprint(first, store.repository, { now: NOW })).toEqual({
      status: "ADMITTED",
      validationRunId: RUN_A,
      contentHash,
      reused: false,
      trustStatus: "VALIDATED"
    });
    expect(await store.lineage(contentHash)).toEqual({
      verified: true,
      content_hash: contentHash,
      validation_run_id: RUN_A,
      candidate_digest: first.report.candidate_digest,
      trace_id: first.report.trace_id,
      registry_digest: first.report.registry_digest,
      trust_status: "VALIDATED"
    });

    const reformatted = validate(validBlueprint(), RUN_B, 2);
    expect(reformatted.report.content_hash).toBe(contentHash);
    expect(await admitBlueprint(reformatted, store.repository, { now: NOW })).toMatchObject({ validationRunId: RUN_B, contentHash, reused: true });
    expect(store.database.runs.get(RUN_B)).toMatchObject({ status: "PASSED", blueprint_hash: contentHash, candidate_digest: reformatted.report.candidate_digest });
    expect(await store.lineage(contentHash), "same-hash reuse never re-points the admitting run").toMatchObject({ verified: true, validation_run_id: RUN_A });
    expect(store.database.contents.get(contentHash)?.admitted_by_validation_run_id).toBe(RUN_A);

    const rejectedCandidate = withValue(["extra"], true);
    const rejected = validate(rejectedCandidate, RUN_C);
    expect(await admitBlueprint(rejected, store.repository, { now: NOW })).toMatchObject({ status: "NOT_ADMITTED" });
    expect(await store.lineage(hashBlueprint(rejectedCandidate))).toEqual({ verified: false, content_hash: hashBlueprint(rejectedCandidate), failure: "CONTENT_UNKNOWN" });
    expect(await store.lineage(rejected.report.candidate_digest)).toMatchObject({ verified: false, failure: "CONTENT_UNKNOWN" });

    const other = validate(retitled(), RUN_D);
    const otherHash = other.report.content_hash ?? "";
    expect(await admitBlueprint(other, store.repository, { now: NOW })).toMatchObject({ status: "ADMITTED", validationRunId: RUN_D, reused: false });
    expect(await store.lineage(otherHash)).toMatchObject({ verified: true, validation_run_id: RUN_D, candidate_digest: other.report.candidate_digest });

    await expectTamperedLineageRejected(store, contentHash, otherHash);

    const lineageReads = store.database.statements.filter((statement) => statement === POSTGRES_READ_ADMISSION_LINEAGE_SQL);
    expect(lineageReads.length).toBeGreaterThan(0);
    expect(POSTGRES_READ_ADMISSION_LINEAGE_SQL).toMatch(/^SELECT\b/);
    expect(POSTGRES_READ_ADMISSION_LINEAGE_SQL).toMatch(/LEFT JOIN public\.validation_run AS run\s+ON run\.validation_run_id = content\.admitted_by_validation_run_id/);
    expect(POSTGRES_READ_ADMISSION_LINEAGE_SQL).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/);
  });
});
