import { createHash } from "node:crypto";

import { expect, test } from "vitest";

import { MAX_CANDIDATE_PAYLOAD_BYTES } from "../../src/platform/blueprint/validation-types.js";
import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import { validBlueprint } from "../contract/blueprint-validation-fixtures.js";

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function paddedTo(byteLength: number): Uint8Array {
  const base = JSON.stringify(validBlueprint());
  const padding = byteLength - new TextEncoder().encode(base).byteLength;
  expect(padding).toBeGreaterThan(0);
  return new TextEncoder().encode(`${" ".repeat(padding)}${base}`);
}

function expectIntakeRejection(bytes: Uint8Array, label: string): void {
  const result = validateBlueprintCandidate(bytes);
  expect(result.report.status, label).toBe("REJECTED");
  expect(result.report.candidate_digest, label).toBe(sha256(bytes));
  expect(result.report.issues, label).toEqual([{ error_code: "F02-ERR-001", stage: "V01", json_path: "$" }]);
}

test("candidate intake enforces the exact 512 KiB ceiling and digests raw bytes before parsing", () => {
  expect(MAX_CANDIDATE_PAYLOAD_BYTES).toBe(524_288);

  const atCeiling = paddedTo(524_288);
  const accepted = validateBlueprintCandidate(atCeiling);
  expect(accepted.report.status).toBe("PASSED");
  expect(accepted.report.candidate_digest).toBe(sha256(atCeiling));

  expectIntakeRejection(paddedTo(524_289), "one byte over ceiling");
  expectIntakeRejection(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(JSON.stringify(validBlueprint()))]), "UTF-8 BOM");
  expectIntakeRejection(new Uint8Array([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x3a, 0x31, 0x7d]), "invalid UTF-8");
  expectIntakeRejection(new TextEncoder().encode('{"kind":"BLUEPRINT","kind":"BLUEPRINT"}'), "duplicate key");
  expectIntakeRejection(new TextEncoder().encode("[]"), "non-object root");
  expectIntakeRejection(new TextEncoder().encode('{"a":1}garbage'), "trailing bytes");
  expectIntakeRejection(new TextEncoder().encode('{"a":1e999}'), "non-finite number");
  expectIntakeRejection(new TextEncoder().encode('{"a":"\\x"}'), "invalid escape");
});
