import { describe, expect, test } from "vitest";

import { verifyAdmissionLineage, type AdmissionLineageFailure } from "../../src/platform/blueprint/admission-lineage.js";
import { admitBlueprint } from "../../src/platform/blueprint/blueprint-admission.js";
import { createBlueprintTrustTransitionService } from "../../src/platform/blueprint/blueprint-trust-transition.js";
import { canonicalizeJson } from "../../src/platform/blueprint/canonical-json.js";
import {
  PostgresAdmissionLineageSource,
  PostgresBlueprintAdmissionRepository,
  PostgresBlueprintTrustTransitionRepository,
  POSTGRES_READ_ADMISSION_LINEAGE_SQL
} from "../../src/platform/blueprint/postgres-blueprint-repository.js";
import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import type { BlueprintValidationResult } from "../../src/platform/blueprint/validation-types.js";
import { FakeBlueprintPostgres, type StoredBlueprintContent, type StoredValidationRun } from "../contract/blueprint-postgres-fake.js";
import { validBlueprint, withValue } from "../contract/blueprint-validation-fixtures.js";
import { evidenceCapture, NOW, runId } from "../runtime/blueprint-evidence-support.js";

const RUN_A = runId(0);
const RUN_B = runId(1);
const RUN_REJECTED = runId(2);

function validate(text: string, validationRunId: string): BlueprintValidationResult {
  return validateBlueprintCandidate(new TextEncoder().encode(text), { validationRunId });
}

interface Admitted {
  readonly database: FakeBlueprintPostgres;
  readonly contentHash: string;
  readonly first: BlueprintValidationResult;
}

async function admittedWithReuse(): Promise<Admitted> {
  const database = new FakeBlueprintPostgres();
  const repository = new PostgresBlueprintAdmissionRepository(database);
  const first = validate(JSON.stringify(validBlueprint()), RUN_A);
  const reuse = validate(JSON.stringify(validBlueprint(), null, 2), RUN_B);
  expect(await admitBlueprint(first, repository, { now: NOW })).toMatchObject({ status: "ADMITTED", reused: false, validationRunId: RUN_A });
  expect(await admitBlueprint(reuse, repository, { now: NOW })).toMatchObject({ status: "ADMITTED", reused: true, validationRunId: RUN_B });
  await admitBlueprint(validate(JSON.stringify(withValue(["extra"], true)), RUN_REJECTED), repository, { now: NOW });
  return { database, contentHash: first.report.content_hash ?? "", first };
}

type Tamper = (content: StoredBlueprintContent, run: StoredValidationRun) => [StoredBlueprintContent, StoredValidationRun | undefined];

function reportTamper(change: Record<string, unknown>): Tamper {
  return (content, run) => [content, { ...run, report: { ...run.report, ...change } }];
}

const TAMPERS: readonly [string, Tamper, AdmissionLineageFailure][] = [
  ["admitting run missing", (content) => [content, undefined], "ADMITTING_RUN_MISSING"],
  ["admitting run status REJECTED", (content, run) => [content, { ...run, status: "REJECTED" }], "ADMITTING_RUN_NOT_PASSED"],
  ["admitting run carries error codes", (content, run) => [content, { ...run, error_codes: ["F02-ERR-015"] }], "ADMITTING_RUN_NOT_PASSED"],
  ["admitting run blueprint_hash differs", (content, run) => [content, { ...run, blueprint_hash: `sha256:${"a".repeat(64)}` }], "ADMITTING_RUN_HASH_MISMATCH"],
  ["report content_hash tampered", reportTamper({ content_hash: `sha256:${"b".repeat(64)}` }), "ADMITTING_REPORT_MISMATCH"],
  ["report trace_id tampered", reportTamper({ trace_id: "4bf92f3577b34da6a3ce929d0e0e4736" }), "ADMITTING_REPORT_MISMATCH"],
  ["report candidate_digest tampered", reportTamper({ candidate_digest: `sha256:${"c".repeat(64)}` }), "ADMITTING_REPORT_MISMATCH"],
  ["report validation_run_id tampered", reportTamper({ validation_run_id: RUN_B }), "ADMITTING_REPORT_MISMATCH"],
  ["report status relabelled", reportTamper({ status: "REJECTED" }), "ADMITTING_REPORT_MISMATCH"],
  ["report issues injected", reportTamper({ issues: [{ error_code: "F02-ERR-015", stage: "V12", json_path: "$" }] }), "ADMITTING_REPORT_MISMATCH"],
  ["report registry_digest removed", reportTamper({ registry_digest: undefined }), "ADMITTING_REPORT_MISMATCH"],
  ["report version tampered", reportTamper({ registry_version: "7.0.9" }), "ADMITTING_REPORT_MISMATCH"],
  [
    "run + report version disagree with content",
    (content, run) => [content, { ...run, registry_version: "7.0.9", report: { ...run.report, registry_version: "7.0.9" } }],
    "VERSION_MISMATCH"
  ],
  ["content registry_version tampered", (content, run) => [{ ...content, registry_version: "7.0.9" }, run], "VERSION_MISMATCH"],
  ["persisted body tampered", (content, run) => [{ ...content, canonical_blueprint: { ...validBlueprint(), meta: { title: "evil" } } }, run], "BODY_INTEGRITY_FAILURE"],
  ["persisted body unparsable text", (content, run) => [{ ...content, canonical_blueprint: "{not json" }, run], "BODY_INTEGRITY_FAILURE"],
  ["byte_size drift", (content, run) => [{ ...content, byte_size: content.byte_size + 1 }, run], "BODY_INTEGRITY_FAILURE"],
  [
    "metadata rewritten consistently but body disagrees",
    (content, run) => [
      { ...content, schema_version: "9.9.9" },
      { ...run, schema_version: "9.9.9", report: { ...run.report, schema_version: "9.9.9" } }
    ],
    "BODY_INTEGRITY_FAILURE"
  ]
];

async function expectTamperedLineageFailsClosed(base: Admitted): Promise<void> {
  const content = base.database.contents.get(base.contentHash)!;
  const run = base.database.runs.get(RUN_A)!;
  for (const [label, tamper, failure] of TAMPERS) {
    const database = new FakeBlueprintPostgres();
    const [tamperedContent, tamperedRun] = tamper(structuredClone(content), structuredClone(run));
    database.contents.set(base.contentHash, tamperedContent);
    if (tamperedRun !== undefined) {
      database.runs.set(RUN_A, tamperedRun);
    }
    database.runs.set(RUN_B, structuredClone(base.database.runs.get(RUN_B)!));
    const lineage = await verifyAdmissionLineage(base.contentHash, new PostgresAdmissionLineageSource(database));
    expect(lineage, label).toEqual({ verified: false, content_hash: base.contentHash, failure });
  }
}

describe("F02 admitted Blueprint → admitting validation_run lineage", () => {
  test("TEST-F02-021 admitted content is mechanically traceable to its exact admitting validation_run and tampered lineage fails closed", async () => {
    const base = await admittedWithReuse();
    const source = new PostgresAdmissionLineageSource(base.database);
    const expected = {
      verified: true,
      content_hash: base.contentHash,
      validation_run_id: RUN_A,
      candidate_digest: base.first.report.candidate_digest,
      trace_id: base.first.report.trace_id,
      registry_digest: base.first.report.registry_digest,
      trust_status: "VALIDATED"
    };

    const before = structuredClone([...base.database.contents.values(), ...base.database.runs.values()]);
    const statementsBefore = base.database.statements.length;
    expect(await verifyAdmissionLineage(base.contentHash, source)).toEqual(expected);
    expect(base.database.statements.slice(statementsBefore)).toEqual([POSTGRES_READ_ADMISSION_LINEAGE_SQL]);
    expect([...base.database.contents.values(), ...base.database.runs.values()]).toEqual(before);

    const reuseRun = base.database.runs.get(RUN_B);
    expect(reuseRun).toMatchObject({ status: "PASSED", blueprint_hash: base.contentHash });
    expect(reuseRun?.candidate_digest).not.toBe(base.first.report.candidate_digest);
    expect(base.database.contents.get(base.contentHash)?.admitted_by_validation_run_id).toBe(RUN_A);
    expect(canonicalizeJson(base.database.contents.get(base.contentHash)?.canonical_blueprint)).toBe(base.first.admissible?.canonicalJson);

    const transitions = createBlueprintTrustTransitionService({
      repository: new PostgresBlueprintTrustTransitionRepository(base.database),
      evidence: evidenceCapture().options
    });
    expect(await transitions.revoke(base.contentHash)).toMatchObject({ status: "TRANSITIONED" });
    expect(await verifyAdmissionLineage(base.contentHash, source)).toEqual({ ...expected, trust_status: "REVOKED" });

    const rejectedHash = validate(JSON.stringify(withValue(["extra"], true)), runId(9)).report.candidate_digest;
    expect(await verifyAdmissionLineage(rejectedHash, source)).toEqual({ verified: false, content_hash: rejectedHash, failure: "CONTENT_UNKNOWN" });
    await expectTamperedLineageFailsClosed(base);
  });
});
