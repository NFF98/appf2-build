import { describe, expect, test } from "vitest";

import { canonicalBlueprintBytes } from "../../src/platform/blueprint/canonical-json.js";
import { hashBlueprint } from "../../src/platform/blueprint/content-identity.js";

function blueprint(): Record<string, unknown> {
  return {
    schema_version: "1.0.0",
    registry_version: "1.0.0",
    kind: "APP",
    meta: { title: "Split dinner", description: "Weighted shares" },
    state: {
      people: { mode: "MUTABLE", type: "NUMBER", initial: 4 },
      total: { mode: "MUTABLE", type: "NUMBER", initial: 120 }
    },
    nodes: [{ id: "node_total" }, { id: "node_people" }],
    actions: [],
    rules: [],
    root_node_id: "node_total",
    result: { outputs: ["per_person"] }
  };
}

describe("Blueprint content identity", () => {
  test("TEST-F02-002 gives equivalent canonical Blueprints the same SHA-256 identity", () => {
    const first = blueprint();
    const second = {
      result: { outputs: ["per_person"] },
      root_node_id: "node_total",
      rules: [],
      actions: [],
      nodes: [{ id: "node_total" }, { id: "node_people" }],
      state: {
        total: { initial: 120, type: "NUMBER", mode: "MUTABLE" },
        people: { initial: 4, mode: "MUTABLE", type: "NUMBER" }
      },
      meta: { description: "Weighted shares", title: "Split dinner" },
      kind: "APP",
      registry_version: "1.0.0",
      schema_version: "1.0.0"
    };

    expect(canonicalBlueprintBytes(second)).toEqual(canonicalBlueprintBytes(first));
    expect(hashBlueprint(second)).toBe(hashBlueprint(first));
    expect(hashBlueprint(first)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(hashBlueprint({ b: 2, a: 1 })).toBe(
      "sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777"
    );
  });

  test("TEST-F02-003 changes identity for every canonical Blueprint content change", () => {
    const original = blueprint();
    const originalHash = hashBlueprint(original);
    const titleChanged = { ...blueprint(), meta: { title: "Split lunch" } };
    const nestedValueChanged = {
      ...blueprint(),
      state: {
        ...(blueprint().state as Record<string, unknown>),
        total: { mode: "MUTABLE", type: "NUMBER", initial: 121 }
      }
    };
    const arrayOrderChanged = {
      ...blueprint(),
      nodes: [{ id: "node_people" }, { id: "node_total" }]
    };

    expect(hashBlueprint(titleChanged)).not.toBe(originalHash);
    expect(hashBlueprint(nestedValueChanged)).not.toBe(originalHash);
    expect(hashBlueprint(arrayOrderChanged)).not.toBe(originalHash);
  });

  test("TEST-F02-AC-018 excludes mutable Runtime Instance state from Blueprint identity", () => {
    const immutableBlueprint = blueprint();
    const runtimeInstance = {
      blueprint: immutableBlueprint,
      state: { people: 4, total: 120 }
    };
    const canonicalBefore = canonicalBlueprintBytes(runtimeInstance.blueprint);
    const hashBefore = hashBlueprint(runtimeInstance.blueprint);
    const runtimeEnvelopeHashBefore = hashBlueprint(runtimeInstance);

    runtimeInstance.state.total = 240;
    runtimeInstance.state.people = 6;

    expect(canonicalBlueprintBytes(runtimeInstance.blueprint)).toEqual(canonicalBefore);
    expect(hashBlueprint(runtimeInstance.blueprint)).toBe(hashBefore);
    expect(hashBlueprint(runtimeInstance)).not.toBe(runtimeEnvelopeHashBefore);
  });
});
