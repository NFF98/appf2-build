import { describe, expect, test } from "vitest";

import { admitBlueprint } from "../../src/platform/blueprint/blueprint-admission.js";
import { PostgresBlueprintAdmissionRepository } from "../../src/platform/blueprint/postgres-blueprint-repository.js";
import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import type { BlueprintValidationResult } from "../../src/platform/blueprint/validation-types.js";
import { FakeBlueprintPostgres } from "../contract/blueprint-postgres-fake.js";
import { encode, issueOf, validBlueprint, withValue, type JsonRecord } from "../contract/blueprint-validation-fixtures.js";

const TEXT = { id: "content.text", version: "1.0.0" };
const BUTTON = { id: "action.button", version: "1.0.0" };
const DEGRADATIONS = "$.support.degradations";
const NOW = (): Date => new Date("2026-10-04T00:00:00.000Z");

function degradation(overrides: JsonRecord = {}): JsonRecord {
  return {
    requirement_id: "req_visual",
    description: "3D 視覺降為 2D 呈現，分帳規則與結果完整保留",
    capability_refs: [TEXT],
    preserves_semantic_core: true,
    ...overrides
  };
}

function withSupport(coverageStatus: unknown, degradations: unknown): JsonRecord {
  return withValue(["support"], { coverage_status: coverageStatus, degradations });
}

function partial(...degradations: unknown[]): JsonRecord {
  return withSupport("PARTIALLY_SUPPORTED", degradations);
}

function without(entry: JsonRecord, key: string): JsonRecord {
  const copy = { ...entry };
  delete copy[key];
  return copy;
}

function validate(candidate: unknown): BlueprintValidationResult {
  return validateBlueprintCandidate(encode(candidate));
}

function expectRejected(candidate: unknown, expected: { code: string; stage: string; path: string }, label: string): void {
  const result = validate(candidate);
  expect(result.report.status, label).toBe("REJECTED");
  expect(result.admissible, label).toBeUndefined();
  expect(result.report.content_hash, label).toBeUndefined();
  expect(issueOf(result), label).toEqual(expected);
}

function schemaError(path: string): { code: string; stage: string; path: string } {
  return { code: "F02-ERR-002", stage: "V02", path };
}

function degradationError(path: string): { code: string; stage: string; path: string } {
  return { code: "F02-ERR-014", stage: "V11", path };
}

function expectPassed(result: BlueprintValidationResult, label: string): NonNullable<BlueprintValidationResult["admissible"]> {
  expect(result.report.issues, label).toEqual([]);
  expect(result.report.status, label).toBe("PASSED");
  return result.admissible!;
}

function passed(candidate: unknown, label: string): NonNullable<BlueprintValidationResult["admissible"]> {
  return expectPassed(validate(candidate), label);
}

const EXPLICIT = [
  degradation(),
  degradation({ requirement_id: "req_animation", description: "動畫改為靜態按鈕回饋", capability_refs: [BUTTON, TEXT] })
];

async function expectExplicitMetadataPersisted(): Promise<void> {
  const result = validate(partial(...EXPLICIT));
  const admissible = expectPassed(result, "explicit PARTIALLY_SUPPORTED");
  const expectedSupport = { coverage_status: "PARTIALLY_SUPPORTED", degradations: EXPLICIT };
  expect((JSON.parse(admissible.canonicalJson) as JsonRecord).support).toEqual(expectedSupport);

  const database = new FakeBlueprintPostgres();
  const admitted = await admitBlueprint(result, new PostgresBlueprintAdmissionRepository(database), { now: NOW });
  expect(admitted).toMatchObject({ status: "ADMITTED", contentHash: admissible.contentHash });
  expect((database.contents.get(admissible.contentHash)?.canonical_blueprint as JsonRecord).support).toEqual(expectedSupport);

  const reworded = passed(partial(degradation({ description: "3D 視覺改為平面呈現" }), EXPLICIT[1]), "reworded degradation");
  const fully = passed(validBlueprint(), "FULLY_SUPPORTED control");
  expect(new Set([admissible.contentHash, reworded.contentHash, fully.contentHash]).size).toBe(3);
}

function expectMissingMetadataRejected(): void {
  const first = `${DEGRADATIONS}[0]`;
  expectRejected(partial(), degradationError(DEGRADATIONS), "PARTIALLY_SUPPORTED without degradations");
  expectRejected(withSupport("FULLY_SUPPORTED", [degradation()]), degradationError(DEGRADATIONS), "degradation hidden under FULLY_SUPPORTED");
  expectRejected(without(validBlueprint(), "support"), schemaError("$.support"), "support omitted");
  expectRejected(withValue(["support"], { coverage_status: "PARTIALLY_SUPPORTED" }), schemaError(DEGRADATIONS), "degradations omitted");
  for (const key of ["requirement_id", "description", "capability_refs", "preserves_semantic_core"]) {
    expectRejected(partial(without(degradation(), key)), schemaError(`${first}.${key}`), `${key} omitted`);
  }
  expectRejected(partial(degradation({ description: "" })), schemaError(`${first}.description`), "empty description");
  expectRejected(partial(degradation({ description: "降".repeat(501) })), schemaError(`${first}.description`), "description over 500 code points");
  expectRejected(partial(degradation({ description: 42 })), schemaError(`${first}.description`), "non-text description");
  expectRejected(partial(degradation({ requirement_id: "Req-Visual" })), schemaError(`${first}.requirement_id`), "requirement_id grammar");
  expectRejected(partial(degradation(), degradation()), schemaError(`${DEGRADATIONS}[1]`), "duplicate requirement_id");
  expectRejected(partial(degradation({ capability_refs: [] })), schemaError(`${first}.capability_refs`), "no capability refs");
  expectRejected(partial(degradation({ capability_refs: ["content.text"] })), schemaError(`${first}.capability_refs[0]`), "bare capability id");
  expectRejected(partial(degradation({ capability_refs: [TEXT, TEXT] })), schemaError(`${first}.capability_refs[1]`), "duplicate capability ref");
  expectRejected(partial(degradation({ hidden: true })), schemaError(`${first}.hidden`), "undeclared degradation key");
  expectRejected(
    partial(degradation({ capability_refs: [{ id: "content.text", version: "9.9.9" }] })),
    degradationError(`${first}.capability_refs[0]`),
    "degradation references unknown capability"
  );
  passed(partial(degradation({ description: "😀".repeat(500) })), "500 supplementary code points");
}

async function expectNotAdmittedAsPartialSuccess(candidate: JsonRecord, path: string, label: string): Promise<void> {
  const database = new FakeBlueprintPostgres();
  const result = validateBlueprintCandidate(encode(candidate), { validationRunId: "00000000-0000-4000-8000-000000000016" });
  expect(result.report.status, label).toBe("REJECTED");
  expect(issueOf(result), label).toEqual(degradationError(path));
  expect(result.admissible, label).toBeUndefined();
  const outcome = await admitBlueprint(result, new PostgresBlueprintAdmissionRepository(database), { now: NOW });
  expect(outcome, label).toEqual({ status: "NOT_ADMITTED", report: result.report });
  expect(database.contents.size, label).toBe(0);
  expect(database.runs.get(result.report.validation_run_id), label).toMatchObject({
    status: "REJECTED",
    blueprint_hash: null,
    error_codes: ["F02-ERR-014"]
  });
}

describe("F02 support / degradation admission", () => {
  test("TEST-F02-015 PARTIALLY_SUPPORTED requires explicit user-visible degradation metadata that survives admission", async () => {
    await expectExplicitMetadataPersisted();
    expectMissingMetadataRejected();
  });

  test("TEST-F02-AC-016 a degradation that does not preserve the semantic core is never admitted as partial success", async () => {
    const lost = degradation({ requirement_id: "req_core", description: "改用不同計算方式", preserves_semantic_core: false });
    await expectNotAdmittedAsPartialSuccess(partial(lost), `${DEGRADATIONS}[0].preserves_semantic_core`, "single degradation");
    await expectNotAdmittedAsPartialSuccess(partial(degradation(), lost), `${DEGRADATIONS}[1].preserves_semantic_core`, "one of several degradations");
    expectRejected(withSupport("FULLY_SUPPORTED", [lost]), degradationError(DEGRADATIONS), "non-preserving degradation under FULLY_SUPPORTED");
    passed(partial(degradation(), { ...lost, preserves_semantic_core: true }), "same Blueprint with semantic core preserved");

    for (const flag of ["true", 1, null, [true], { value: true }]) {
      expectRejected(
        partial(degradation({ preserves_semantic_core: flag })),
        schemaError(`${DEGRADATIONS}[0].preserves_semantic_core`),
        `preserves_semantic_core ${JSON.stringify(flag)}`
      );
    }
    for (const status of ["EXTERNAL_OR_HEAVY_REQUIRED", "UNSUPPORTED", "partially_supported", ""]) {
      expectRejected(withSupport(status, [degradation()]), schemaError("$.support.coverage_status"), `coverage_status ${status}`);
    }
  });
});
