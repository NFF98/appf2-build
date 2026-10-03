import { describe, expect, test } from "vitest";

import { hashBlueprint } from "../../src/platform/blueprint/content-identity.js";
import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import {
  actionIndex,
  encode,
  issueOf,
  nodeIndex,
  validBlueprint,
  withValue,
  without,
  type JsonRecord
} from "../contract/blueprint-validation-fixtures.js";

function validate(candidate: unknown): ReturnType<typeof validateBlueprintCandidate> {
  return validateBlueprintCandidate(encode(candidate));
}

const TOP_LEVEL_KEYS = [
  "schema_version",
  "registry_version",
  "kind",
  "meta",
  "support",
  "state",
  "rules",
  "actions",
  "nodes",
  "root_node_id",
  "result"
] as const;

describe("F02 executable Blueprint schema closure", () => {
  test("admits a complete Blueprint that uses every Phase 1 core capability, repeat SCOPE and EVENT dispatch", () => {
    const candidate = validBlueprint();
    const result = validate(candidate);

    expect(result.report.issues).toEqual([]);
    expect(result.report.status).toBe("PASSED");
    expect(result.report.registry_version).toBe("4.0.0");
    expect(result.report.registry_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.admissible?.contentHash).toBe(hashBlueprint(candidate));
    expect(result.report.content_hash).toBe(result.admissible?.contentHash);
    const capabilities = new Set((candidate.nodes as JsonRecord[]).map((entry) => (entry.capability as JsonRecord).id));
    expect(capabilities.size).toBe(15);
  });

  test("TEST-F02-004 rejects unknown, missing and implicitly-empty executable keys fail-closed at V02", () => {
    const unknownTopLevel = { ...validBlueprint(), runtime_hook: "anything" };
    expect(issueOf(validate(unknownTopLevel))).toEqual({ code: "F02-ERR-002", stage: "V02", path: "$.runtime_hook" });

    for (const key of TOP_LEVEL_KEYS) {
      const result = validate(without([key]));
      expect(result.report.status, key).toBe("REJECTED");
      expect(issueOf(result), key).toEqual({ code: "F02-ERR-002", stage: "V02", path: `$.${key}` });
      expect(result.admissible, key).toBeUndefined();
    }

    const people = nodeIndex("node_people");
    const pick = actionIndex("action_pick_item");
    const roll = actionIndex("action_roll");
    const nestedUnknown: readonly [readonly (string | number)[], string][] = [
      [["meta", "creator"], "$.meta.creator"],
      [["support", "extra"], "$.support.extra"],
      [["nodes", people, "handler"], `$.nodes[${people}].handler`],
      [["nodes", people, "capability", "latest"], `$.nodes[${people}].capability.latest`],
      [["nodes", people, "bindings", "bind", "fallback"], `$.nodes[${people}].bindings.bind.fallback`],
      [["actions", pick, "steps", 0, "script"], `$.actions[${pick}].steps[0].script`],
      [["actions", roll, "steps", 0, "when_absent"], `$.actions[${roll}].steps[0].when_absent`],
      [["state", "people", "nullable"], "$.state.people.nullable"],
      [["result", "outputs", 0, "format"], "$.result.outputs[0].format"],
      [["nodes", nodeIndex("node_list"), "repeat", "template"], `$.nodes[${nodeIndex("node_list")}].repeat.template`]
    ];
    for (const [path, jsonPath] of nestedUnknown) {
      expect(issueOf(validate(withValue(path, "x"))), jsonPath).toEqual({ code: "F02-ERR-002", stage: "V02", path: jsonPath });
    }

    const implicitEmpty: readonly [readonly (string | number)[], string][] = [
      [["nodes", people, "children"], `$.nodes[${people}].children`],
      [["nodes", people, "events"], `$.nodes[${people}].events`],
      [["nodes", nodeIndex("node_random"), "props"], `$.nodes[${nodeIndex("node_random")}].props`],
      [["actions", roll, "steps", 2, "args"], `$.actions[${roll}].steps[2].args`],
      [["support", "degradations"], "$.support.degradations"],
      [["result", "outputs"], "$.result.outputs"]
    ];
    for (const [path, jsonPath] of implicitEmpty) {
      expect(issueOf(validate(without(path))), jsonPath).toEqual({ code: "F02-ERR-002", stage: "V02", path: jsonPath });
    }

    expect(issueOf(validate(withValue(["kind"], "WIDGET")))).toEqual({ code: "F02-ERR-002", stage: "V02", path: "$.kind" });
    expect(issueOf(validate(withValue(["meta", "title"], "")))).toEqual({ code: "F02-ERR-002", stage: "V02", path: "$.meta.title" });
    expect(issueOf(validate(withValue(["meta", "title"], "字".repeat(121))))).toMatchObject({ code: "F02-ERR-002" });
    expect(validate(withValue(["meta", "title"], "😀".repeat(120))).report.status).toBe("PASSED");
    expect(issueOf(validate(withValue(["actions", pick, "steps"], [])))).toMatchObject({ code: "F02-ERR-002" });
    expect(issueOf(validate(withValue(["nodes"], [])))).toMatchObject({ code: "F02-ERR-002", path: "$.nodes" });
    expect(issueOf(validate(withValue(["nodes", people, "bindings", "bind"], { kind: "LITERAL", value: null })))).toMatchObject({
      code: "F02-ERR-002"
    });
    expect(issueOf(validate(withValue(["state", "nff_secret"], { mode: "MUTABLE", type: "BOOLEAN", initial: true })))).toEqual({
      code: "F02-ERR-006",
      stage: "V05",
      path: "$.state.nff_secret"
    });
    expect(issueOf(validate(withValue(["actions", actionIndex("action_reset"), "steps", 0, "when"], { kind: "LITERAL", value: true })))).toMatchObject({
      code: "F02-ERR-002"
    });
  });

  test("rejects invalid Blueprint versions and registry snapshots as INCOMPATIBLE at V03", () => {
    const schema = validate(withValue(["schema_version"], "2.0.0"));
    expect(schema.report.status).toBe("INCOMPATIBLE");
    expect(issueOf(schema)).toEqual({ code: "F02-ERR-003", stage: "V03", path: "$.schema_version" });
    for (const version of ["1.0.0", "2.0.0", "3.0.0"]) {
      const registry = validate(withValue(["registry_version"], version));
      expect(registry.report.status).toBe("INCOMPATIBLE");
      expect(issueOf(registry)).toEqual({ code: "F02-ERR-004", stage: "V03", path: "$.registry_version" });
    }
  });
});
