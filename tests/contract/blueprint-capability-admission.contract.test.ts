import { describe, expect, test } from "vitest";

import { admitBlueprint } from "../../src/platform/blueprint/blueprint-admission.js";
import { PostgresBlueprintAdmissionRepository } from "../../src/platform/blueprint/postgres-blueprint-repository.js";
import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import { FakeBlueprintPostgres } from "./blueprint-postgres-fake.js";
import { encode, issueOf, nodeIndex, withValue, type JsonRecord } from "./blueprint-validation-fixtures.js";

function validate(candidate: unknown): ReturnType<typeof validateBlueprintCandidate> {
  return validateBlueprintCandidate(encode(candidate));
}

describe("F02 Registry-backed capability admission", () => {
  test("TEST-F02-005 never admits an unknown capability ID or version", async () => {
    const people = nodeIndex("node_people");
    const size = nodeIndex("node_size");
    const unknownRefs: readonly [number, JsonRecord][] = [
      [people, { id: "input.slider", version: "1.0.0" }],
      [people, { id: "input.number", version: "1.0.1" }],
      [people, { id: "input.number", version: "2.0.0" }],
      [size, { id: "input.select", version: "1.0.0" }],
      [people, { id: "constructor", version: "1.0.0" }]
    ];
    const database = new FakeBlueprintPostgres();
    const repository = new PostgresBlueprintAdmissionRepository(database);

    for (const [index, capability] of unknownRefs) {
      const result = validate(withValue(["nodes", index, "capability"], capability));
      const label = `${String(capability.id)}@${String(capability.version)}`;
      if (capability.id === "constructor") {
        expect(issueOf(result), label).toEqual({ code: "F02-ERR-002", stage: "V02", path: `$.nodes[${index}].capability.id` });
        continue;
      }
      expect(result.report.status, label).toBe("REJECTED");
      expect(result.admissible, label).toBeUndefined();
      expect(result.report.issues, label).toEqual([
        { error_code: "F02-ERR-005", stage: "V04", json_path: `$.nodes[${index}].capability`, capability_ref: capability }
      ]);
      const admission = await admitBlueprint(result, repository);
      expect(admission.status, label).toBe("NOT_ADMITTED");
    }

    expect(database.contents.size).toBe(0);
    expect([...database.runs.values()].map((run) => [run.status, run.blueprint_hash, run.error_codes])).toEqual(
      Array.from({ length: 4 }, () => ["REJECTED", null, ["F02-ERR-005"]])
    );

    const inheritedKey = validate(withValue(["nodes", people, "capability"], { id: "input.number", version: "toString" }));
    expect(issueOf(inheritedKey)).toMatchObject({ code: "F02-ERR-002", stage: "V02" });

    const unknownDegradationRef = withValue(["support"], {
      coverage_status: "PARTIALLY_SUPPORTED",
      degradations: [
        {
          requirement_id: "share_to_chat",
          description: "改以複製連結呈現",
          capability_refs: [{ id: "social.chat_share", version: "1.0.0" }],
          preserves_semantic_core: true
        }
      ]
    });
    expect(issueOf(validate(unknownDegradationRef))).toEqual({
      code: "F02-ERR-014",
      stage: "V11",
      path: "$.support.degradations[0].capability_refs[0]"
    });
  });

  test("rejects props, bindings and events the exact capability contract does not declare", () => {
    const people = nodeIndex("node_people");
    const cases: readonly [readonly (string | number)[], unknown, string][] = [
      [["nodes", people, "props", "precision"], { kind: "LITERAL", value: 2 }, `$.nodes[${people}].props.precision`],
      [["nodes", people, "bindings", "value"], { kind: "STATE", key: "people" }, `$.nodes[${people}].bindings.value`],
      [["nodes", people, "events", "submit"], "action_set_people", `$.nodes[${people}].events.submit`],
      [["nodes", nodeIndex("node_list"), "bindings", "items"], { kind: "STATE", key: "items" }, `$.nodes[${nodeIndex("node_list")}].bindings.items`],
      [["nodes", nodeIndex("node_card"), "bindings", "children"], { kind: "LITERAL", value: "x" }, `$.nodes[${nodeIndex("node_card")}].bindings.children`]
    ];
    for (const [path, value, jsonPath] of cases) {
      expect(issueOf(validate(withValue(path, value))), jsonPath).toEqual({ code: "F02-ERR-005", stage: "V04", path: jsonPath });
    }
    const missingRequired = validate(withValue(["nodes", people, "props"], {}));
    expect(issueOf(missingRequired)).toEqual({ code: "F02-ERR-005", stage: "V04", path: `$.nodes[${people}].props.label` });
  });
});
