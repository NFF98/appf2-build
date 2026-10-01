import { readFile } from "node:fs/promises";

import { expect, test } from "vitest";

import { digestCandidateBytes } from "../../src/platform/blueprint/candidate-digest.js";
import { hashBlueprint } from "../../src/platform/blueprint/content-identity.js";
import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import type { BlueprintValidationOutcome } from "../../src/platform/blueprint/validation-types.js";
import {
  encodeBlueprint,
  sha256OfBytes,
  validationContext,
  validationDependencies,
  validBlueprint
} from "../contract/blueprint-validation-fixture.js";

async function reject(value: unknown): Promise<BlueprintValidationOutcome> {
  return validateBlueprintCandidate(
    encodeBlueprint(value),
    validationContext(),
    validationDependencies()
  );
}

function withBudgetNode(node: Record<string, unknown>): Record<string, unknown> {
  const blueprint = validBlueprint();
  (blueprint.nodes as Array<Record<string, unknown>>)[1] = node;
  return blueprint;
}

test("TEST-F02-006 rejects invalid state, binding, rule, and action references", async () => {
  const missingState = withBudgetNode({
    id: "node_budget",
    capability: { id: "input.number", version: "1.0.0" },
    bindings: { bind: { kind: "STATE", key: "missing_budget" } },
    events: { change: "action_set_budget" }
  });
  const missingRule = withBudgetNode({
    id: "node_budget",
    capability: { id: "input.number", version: "1.0.0" },
    bindings: { bind: { kind: "RULE", rule_id: "rule_missing" } },
    events: { change: "action_set_budget" }
  });
  const undeclaredBinding = withBudgetNode({
    id: "node_budget",
    capability: { id: "input.number", version: "1.0.0" },
    bindings: { value: { kind: "STATE", key: "budget" } },
    events: { change: "action_set_budget" }
  });
  const missingAction = withBudgetNode({
    id: "node_budget",
    capability: { id: "input.number", version: "1.0.0" },
    bindings: { bind: { kind: "STATE", key: "budget" } },
    events: { change: "action_missing" }
  });
  const derivedTarget = validBlueprint();
  derivedTarget.state = {
    budget: { mode: "MUTABLE", type: "NUMBER", initial: 10 },
    shown: {
      mode: "DERIVED",
      type: "NUMBER",
      expr: { kind: "STATE", key: "budget" }
    }
  };
  derivedTarget.actions = [
    {
      id: "action_set_budget",
      steps: [
        {
          type: "SET_STATE",
          target: "shown",
          value: { kind: "LITERAL", value: 1 }
        }
      ]
    }
  ];
  const missingNode = validBlueprint();
  missingNode.actions = [
    {
      id: "action_set_budget",
      steps: [
        {
          type: "INVOKE_CAPABILITY",
          target_node_id: "node_missing",
          capability_action: "set",
          args: {}
        }
      ]
    }
  ];
  (missingNode.nodes as Array<Record<string, unknown>>)[1] = {
    id: "node_budget",
    capability: { id: "logic.score", version: "1.0.0" }
  };

  const stateOutcome = await reject(missingState);
  const ruleOutcome = await reject(missingRule);
  const bindingOutcome = await reject(undeclaredBinding);
  const actionOutcome = await reject(missingAction);
  const targetOutcome = await reject(derivedTarget);
  const nodeOutcome = await reject(missingNode);

  expect(stateOutcome.validation_report.issues[0]).toMatchObject({
    error_code: "F02-ERR-008",
    stage: "V07",
    message_key: "binding_reference_missing",
    capability_ref: "missing_budget"
  });
  expect(ruleOutcome.validation_report.issues[0]).toMatchObject({
    error_code: "F02-ERR-008",
    stage: "V07",
    message_key: "rule_reference_missing",
    capability_ref: "rule_missing"
  });
  expect(bindingOutcome.validation_report.issues[0]).toMatchObject({
    error_code: "F02-ERR-008",
    stage: "V07",
    message_key: "undeclared_binding"
  });
  expect(actionOutcome.validation_report.issues[0]).toMatchObject({
    error_code: "F02-ERR-010",
    stage: "V08",
    message_key: "action_reference_missing",
    capability_ref: "action_missing"
  });
  expect(targetOutcome.validation_report.issues[0]).toMatchObject({
    error_code: "F02-ERR-010",
    stage: "V08",
    message_key: "set_state_target_invalid",
    capability_ref: "shown"
  });
  expect(nodeOutcome.validation_report.issues[0]).toMatchObject({
    error_code: "F02-ERR-010",
    stage: "V08",
    message_key: "action_node_reference_missing",
    capability_ref: "node_missing"
  });
  for (const outcome of [
    stateOutcome,
    ruleOutcome,
    bindingOutcome,
    actionOutcome,
    targetOutcome,
    nodeOutcome
  ]) {
    expect(outcome.status).toBe("REJECTED");
    expect(outcome.validation_report.content_hash).toBeNull();
  }
});

test("TEST-F02-007 rejects node cycles and derived or rule dependency cycles", async () => {
  const nodeCycle = validBlueprint();
  nodeCycle.nodes = [
    {
      id: "node_root",
      capability: { id: "layout.container", version: "1.0.0" },
      children: ["node_child"]
    },
    {
      id: "node_child",
      capability: { id: "layout.container", version: "1.0.0" },
      children: ["node_root"]
    }
  ];
  nodeCycle.actions = [];
  const missingRoot = validBlueprint();
  missingRoot.root_node_id = "node_absent";
  const missingChild = validBlueprint();
  (missingChild.nodes as Array<Record<string, unknown>>)[0] = {
    id: "node_root",
    capability: { id: "layout.container", version: "1.0.0" },
    children: ["node_absent"]
  };
  const orphan = validBlueprint();
  (orphan.nodes as Array<Record<string, unknown>>).push({
    id: "node_orphan",
    capability: { id: "content.text", version: "1.0.0" },
    bindings: { text: { kind: "LITERAL", value: "Orphan" } }
  });
  const derivedCycle = validBlueprint();
  derivedCycle.state = {
    left: { mode: "DERIVED", type: "NUMBER", expr: { kind: "STATE", key: "right" } },
    right: { mode: "DERIVED", type: "NUMBER", expr: { kind: "STATE", key: "left" } }
  };
  derivedCycle.actions = [];
  (derivedCycle.nodes as Array<Record<string, unknown>>)[1] = {
    id: "node_budget",
    capability: { id: "content.text", version: "1.0.0" },
    bindings: { text: { kind: "LITERAL", value: "Cycle" } }
  };
  const ruleCycle = validBlueprint();
  ruleCycle.rules = [
    { id: "rule_left", result_type: "BOOLEAN", expr: { kind: "RULE", rule_id: "rule_right" } },
    { id: "rule_right", result_type: "BOOLEAN", expr: { kind: "RULE", rule_id: "rule_left" } }
  ];
  const crossCycle = validBlueprint();
  crossCycle.state = {
    budget: { mode: "MUTABLE", type: "NUMBER", initial: 1 },
    shown: { mode: "DERIVED", type: "BOOLEAN", expr: { kind: "RULE", rule_id: "rule_shown" } }
  };
  crossCycle.rules = [
    { id: "rule_shown", result_type: "BOOLEAN", expr: { kind: "STATE", key: "shown" } }
  ];

  const nodeOutcome = await reject(nodeCycle);
  const rootOutcome = await reject(missingRoot);
  const childOutcome = await reject(missingChild);
  const orphanOutcome = await reject(orphan);
  const derivedOutcome = await reject(derivedCycle);
  const ruleOutcome = await reject(ruleCycle);
  const crossOutcome = await reject(crossCycle);

  expect(nodeOutcome.validation_report.issues.map((issue) => issue.message_key)).toContain("node_cycle");
  expect(rootOutcome.validation_report.issues[0]).toMatchObject({
    error_code: "F02-ERR-007",
    stage: "V06",
    message_key: "root_missing"
  });
  expect(childOutcome.validation_report.issues.map((issue) => issue.message_key)).toContain("child_missing");
  expect(orphanOutcome.validation_report.issues.map((issue) => issue.message_key)).toContain("node_unreachable");
  expect(derivedOutcome.validation_report.issues[0]).toMatchObject({
    error_code: "F02-ERR-006",
    stage: "V05",
    message_key: "dependency_cycle"
  });
  expect(ruleOutcome.validation_report.issues[0]).toMatchObject({
    error_code: "F02-ERR-009",
    stage: "V07",
    message_key: "dependency_cycle"
  });
  expect(crossOutcome.validation_report.issues[0]).toMatchObject({
    error_code: "F02-ERR-009",
    stage: "V07",
    message_key: "dependency_cycle"
  });
  for (const outcome of [
    nodeOutcome,
    rootOutcome,
    childOutcome,
    orphanOutcome,
    derivedOutcome,
    ruleOutcome,
    crossOutcome
  ]) {
    expect(outcome.status).toBe("REJECTED");
    expect(outcome.validation_report.content_hash).toBeNull();
  }
});

test("candidate digest is SHA-256 of exact pre-parse bytes for invalid and duplicate-key JSON", async () => {
  const invalidText = "{\"not-json-body-marker\"";
  const invalidBytes = new TextEncoder().encode(invalidText);
  const duplicateText = "{\"schema_version\":\"1.0.0\",\"schema_version\":\"9.0.0\"}";
  const duplicateBytes = new TextEncoder().encode(duplicateText);
  const invalidUtf8 = Uint8Array.from([0xff, 0xfe, 0xfd]);
  const dependencies = validationDependencies();

  const invalid = await validateBlueprintCandidate(invalidBytes, validationContext(), dependencies);
  const duplicate = await validateBlueprintCandidate(duplicateBytes, validationContext(), dependencies);
  const utf8 = await validateBlueprintCandidate(invalidUtf8, validationContext(), dependencies);

  expect(invalid.status).toBe("REJECTED");
  expect(invalid.validation_report.candidate_digest).toBe(sha256OfBytes(invalidBytes));
  expect(invalid.validation_report.candidate_digest).toBe(digestCandidateBytes(invalidBytes));
  expect(invalid.validation_report.issues[0]).toMatchObject({
    error_code: "F02-ERR-001",
    stage: "V01",
    message_key: "invalid_json"
  });
  expect(JSON.stringify(invalid.validation_report)).not.toContain("not-json-body-marker");
  expect(duplicate.validation_report.candidate_digest).toBe(sha256OfBytes(duplicateBytes));
  expect(duplicate.validation_report.issues[0]).toMatchObject({
    error_code: "F02-ERR-001",
    stage: "V01",
    message_key: "duplicate_key"
  });
  expect(JSON.stringify(duplicate.validation_report)).not.toContain("schema_version\":\"9.0.0");
  expect(utf8.validation_report.candidate_digest).toBe(sha256OfBytes(invalidUtf8));
  expect(utf8.validation_report.issues[0]?.message_key).toBe("invalid_utf8");
  expect(await dependencies.repository.readRun("123e4567-e89b-42d3-a456-426614174000")).toBeNull();
});

test("byte-different candidates can share one canonical content hash", async () => {
  const compact = encodeBlueprint(validBlueprint());
  const pretty = new TextEncoder().encode(JSON.stringify(validBlueprint(), null, 2));
  const reordered = new TextEncoder().encode(JSON.stringify({
    result: validBlueprint().result,
    root_node_id: "node_root",
    nodes: validBlueprint().nodes,
    actions: validBlueprint().actions,
    rules: [],
    state: validBlueprint().state,
    support: validBlueprint().support,
    meta: validBlueprint().meta,
    kind: "APP",
    registry_version: "1.0.0",
    schema_version: "1.0.0"
  }));
  const first = validationDependencies();
  const second = validationDependencies(
    undefined,
    () => "323e4567-e89b-42d3-a456-426614174222"
  );

  const compactOutcome = await validateBlueprintCandidate(compact, validationContext(), first);
  const prettyOutcome = await validateBlueprintCandidate(pretty, validationContext(), second);

  expect(compactOutcome.status).toBe("PASSED");
  expect(prettyOutcome.status).toBe("PASSED");
  if (compactOutcome.status !== "PASSED" || prettyOutcome.status !== "PASSED") {
    return;
  }
  expect(compactOutcome.validation_report.candidate_digest).toBe(sha256OfBytes(compact));
  expect(prettyOutcome.validation_report.candidate_digest).toBe(sha256OfBytes(pretty));
  expect(compactOutcome.validation_report.candidate_digest).not.toBe(sha256OfBytes(pretty));
  expect(compactOutcome.validation_report.candidate_digest).not.toBe(sha256OfBytes(reordered));
  expect(compactOutcome.content_hash).toBe(prettyOutcome.content_hash);
  expect(compactOutcome.content_hash).toBe(hashBlueprint(validBlueprint()));
  expect(compactOutcome.validation_report.candidate_digest).not.toBe(compactOutcome.content_hash);
});

test("candidate intake does not derive digest with JSON.parse", async () => {
  const files = [
    "../../src/platform/blueprint/strict-json.ts",
    "../../src/platform/blueprint/candidate-digest.ts",
    "../../src/platform/blueprint/validate-blueprint.ts"
  ];
  const sources = await Promise.all(files.map(async (file) => readFile(new URL(file, import.meta.url), "utf8")));
  for (const source of sources) {
    expect(source.includes("JSON.parse")).toBe(false);
  }
});
