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
  expect(result.admissible, label).toBeUndefined();
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

const TITLE_SLOT = "title_slot_for_raw_json_escape";

function blueprintTextWithTitle(rawJsonStringBody: string): string {
  const candidate = validBlueprint();
  candidate.meta = { title: TITLE_SLOT };
  return JSON.stringify(candidate).replace(`"${TITLE_SLOT}"`, `"${rawJsonStringBody}"`);
}

test("BF-037 rejects U+0000 and every unpaired or misordered surrogate escape at V01 before admission", () => {
  const cases: readonly (readonly [string, string])[] = [
    ["escaped U+0000", blueprintTextWithTitle("a\\u0000b")],
    ["lone high surrogate before text", blueprintTextWithTitle("a\\uD83Db")],
    ["lone high surrogate at string end", blueprintTextWithTitle("a\\uD83D")],
    ["lone low surrogate", blueprintTextWithTitle("a\\uDE00b")],
    ["misordered low then high surrogate", blueprintTextWithTitle("\\uDE00\\uD83D")],
    ["high surrogate followed by a second high surrogate", blueprintTextWithTitle("\\uD83D\\uD83D")],
    ["high surrogate followed by a non-surrogate escape", blueprintTextWithTitle("\\uD83D\\u0041")],
    ["high surrogate followed by a simple escape", blueprintTextWithTitle("\\uD83D\\n")],
    ["high surrogate paired with escaped U+0000", blueprintTextWithTitle("\\uD83D\\u0000")],
    ["lone surrogate inside an object key", JSON.stringify(validBlueprint()).replace('"meta"', '"me\\uDC00ta"')],
    ["escaped U+0000 inside an object key", JSON.stringify(validBlueprint()).replace('"meta"', '"meta\\u0000"')]
  ];
  for (const [label, text] of cases) {
    expectIntakeRejection(new TextEncoder().encode(text), label);
  }
  expectIntakeRejection(new TextEncoder().encode(blueprintTextWithTitle("a\u0000b")), "raw U+0000 control character");
});

test("BF-037 admits a valid surrogate pair escape as one persistence-safe supplementary scalar", () => {
  const escaped = validateBlueprintCandidate(new TextEncoder().encode(blueprintTextWithTitle("x\\uD83D\\uDE00y")));
  const raw = validateBlueprintCandidate(new TextEncoder().encode(blueprintTextWithTitle("x\u{1F600}y")));
  expect(escaped.report.status).toBe("PASSED");
  expect(raw.report.status).toBe("PASSED");
  expect(escaped.admissible?.blueprint.meta.title).toBe("x\u{1F600}y");
  expect(escaped.report.content_hash).toBe(raw.report.content_hash);

  const canonical = escaped.admissible?.canonicalJson ?? "";
  expect(canonical).toContain('"title":"x\u{1F600}y"');
  expect(new TextDecoder("utf-8", { fatal: true }).decode(new TextEncoder().encode(canonical))).toBe(canonical);
  expect(canonical).not.toContain("\u0000");
  expect(canonical).not.toMatch(/\\u0000|\\ud[89a-f][0-9a-f]{2}/i);

  const atTitleLimit = validateBlueprintCandidate(new TextEncoder().encode(blueprintTextWithTitle("\\uD83D\\uDE00".repeat(120))));
  expect(atTitleLimit.report.status).toBe("PASSED");
  const overTitleLimit = validateBlueprintCandidate(new TextEncoder().encode(blueprintTextWithTitle("\\uD83D\\uDE00".repeat(121))));
  expect(overTitleLimit.report.issues).toEqual([{ error_code: "F02-ERR-002", stage: "V02", json_path: "$.meta.title" }]);
});
