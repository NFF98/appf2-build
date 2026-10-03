import { afterEach, describe, expect, test, vi } from "vitest";

import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import type { BlueprintValidationResult } from "../../src/platform/blueprint/validation-types.js";
import { encode, nodeIndex, source, validBlueprint, withValue, type JsonRecord } from "../contract/blueprint-validation-fixtures.js";
import { registryWith, withBudget } from "../contract/validator-registry-variants.js";

const { lit, op } = source;
const INERT_CODE_TEXT =
  "eval(alert(1)); import('https://evil.example/x.js'); function () { return 1 }; <script>alert(1)</script> ${process.exit(1)} require('child_process'); globalThis.__appf2_executed = true";

function validate(candidate: unknown): BlueprintValidationResult {
  return validateBlueprintCandidate(encode(candidate));
}

function withNodeKey(key: string, value: unknown): JsonRecord {
  const candidate = validBlueprint();
  (candidate.nodes as JsonRecord[])[0]![key] = value;
  return candidate;
}

function withRuleExpr(expr: JsonRecord): JsonRecord {
  const candidate = validBlueprint();
  (candidate.rules as JsonRecord[]).push({ id: "rule_carrier", result_type: "NUMBER", expr });
  return candidate;
}

function expectRejected(result: BlueprintValidationResult, label: string, issue: { code: string; stage: string; path: string }): void {
  expect(result.report.status, label).toBe("REJECTED");
  expect(result.report.issues, label).toEqual([{ error_code: issue.code, stage: issue.stage, json_path: issue.path }]);
  expect(result.admissible, label).toBeUndefined();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("F02 structural no-code admission", () => {
  test("TEST-F02-009 rejects executable carriers and escape paths before Runtime while user strings stay inert data", () => {
    const evalSpy = vi.spyOn(globalThis, "eval");
    const carrierCode = "globalThis.__appf2_executed = true";

    for (const key of ["script", "code", "module", "handler", "import_url", "function_body"]) {
      expectRejected(validate({ ...validBlueprint(), [key]: carrierCode }), `top-level ${key}`, {
        code: "F02-ERR-002",
        stage: "V02",
        path: `$.${key}`
      });
    }
    for (const key of ["handler", "registrationKey", "module_path", "component", "import_url"]) {
      expectRejected(validate(withNodeKey(key, carrierCode)), `node ${key}`, { code: "F02-ERR-002", stage: "V02", path: `$.nodes[0].${key}` });
    }
    expectRejected(
      validate(withValue(["nodes", 1, "capability"], { id: "content.text", version: "1.0.0", registrationKey: "content/text" })),
      "capability registrationKey",
      { code: "F02-ERR-002", stage: "V02", path: "$.nodes[1].capability.registrationKey" }
    );
    for (const kind of ["CODE", "FUNCTION", "SCRIPT", "IMPORT"]) {
      expectRejected(validate(withValue(["nodes", 1, "bindings", "text"], { kind, value: carrierCode })), `Value Source kind ${kind}`, {
        code: "F02-ERR-002",
        stage: "V02",
        path: "$.nodes[1].bindings.text.kind"
      });
    }
    expectRejected(
      validate(withValue(["nodes", 1, "bindings", "text"], { kind: "LITERAL", value: "x", code: carrierCode })),
      "LITERAL code sibling",
      { code: "F02-ERR-002", stage: "V02", path: "$.nodes[1].bindings.text.code" }
    );
    expectRejected(
      validate(withValue(["actions", 0, "steps", 0], { type: "RUN_SCRIPT", target: "people", value: lit(carrierCode) })),
      "action step RUN_SCRIPT",
      { code: "F02-ERR-002", stage: "V02", path: "$.actions[0].steps[0].type" }
    );
    for (const name of ["EVAL", "IMPORT", "FUNCTION", "REQUIRE"]) {
      expectRejected(validate(withRuleExpr(op(name, lit(carrierCode)))), `operator ${name}`, {
        code: "F02-ERR-009",
        stage: "V07",
        path: "$.rules[1].expr.op"
      });
    }
    const unknownCapability = validate(withValue(["nodes", 1, "capability"], { id: "system.eval", version: "1.0.0" }));
    expect(unknownCapability.report.status).toBe("REJECTED");
    expect(unknownCapability.report.issues).toEqual([
      {
        error_code: "F02-ERR-005",
        stage: "V04",
        json_path: "$.nodes[1].capability",
        capability_ref: { id: "system.eval", version: "1.0.0" }
      }
    ]);
    const escapes = [
      ["browser permission", registryWith({ "action.button@1.0.0": (capability) => ({ ...capability, permission_class: "BROWSER_PERMISSION" }) })],
      ["network access", registryWith({ "action.button@1.0.0": withBudget({ networkAccessAllowed: true }) })]
    ] as const;
    for (const [label, registry] of escapes) {
      const escaped = validateBlueprintCandidate(encode(validBlueprint()), { registry });
      expect(escaped.report.status, label).toBe("REJECTED");
      expect(escaped.report.issues, label).toEqual([
        {
          error_code: "F02-ERR-012",
          stage: "V10",
          json_path: `$.nodes[${nodeIndex("node_item_pick")}].capability`,
          capability_ref: { id: "action.button", version: "1.0.0" }
        }
      ]);
    }

    const pollutionText = JSON.stringify(validBlueprint()).replace(/^\{/, '{"__proto__":{"polluted":true},');
    const pollution = validateBlueprintCandidate(new TextEncoder().encode(pollutionText));
    expectRejected(pollution, "__proto__ key", { code: "F02-ERR-002", stage: "V02", path: "$.__proto__" });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    const inert = validBlueprint();
    (inert.meta as JsonRecord).description = INERT_CODE_TEXT;
    ((inert.nodes as JsonRecord[])[1]!.bindings as JsonRecord).text = lit(INERT_CODE_TEXT);
    const states = inert.state as Record<string, JsonRecord>;
    states.note = { ...states.note!, initial: "import('x'); eval('1')" };
    (inert.result as { outputs: JsonRecord[] }).outputs[0]!.label = "function(){} eval()";
    const passed = validate(inert);
    expect(passed.report.issues).toEqual([]);
    expect(passed.report.status).toBe("PASSED");
    expect(passed.admissible?.canonicalJson).toContain(JSON.stringify(INERT_CODE_TEXT));

    expect(evalSpy).not.toHaveBeenCalled();
    expect((globalThis as Record<string, unknown>).__appf2_executed).toBeUndefined();
  });
});
