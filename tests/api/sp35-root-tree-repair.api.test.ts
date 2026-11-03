import { describe, expect, it } from "vitest";
import { accumulateValidationIssues, canonicalRepairHint } from "../../src/platform/compiler/compose-validate.js";
import { SYSTEM_POLICY } from "../../src/platform/compiler/prompts.js";

describe("Sprint 3.5 F02 V06 rooted Blueprint tree recovery", () => {
  it("specifically diagnoses orphan nodes instead of repeating opaque V06 codes", () => {
    const hint = canonicalRepairHint("F02-ERR-007", "V06", "$.nodes[1]");
    expect(hint).toContain("Orphan node");
    expect(hint).toContain("root_node_id");
    expect(canonicalRepairHint("F02-ERR-007", "V06", "$.nodes[2].children[0]")).toBeUndefined();
    expect(canonicalRepairHint("F02-ERR-007", "V02", "$.nodes[1]")).toBeUndefined();
    expect(canonicalRepairHint("F02-ERR-002", "V06", "$.nodes[1]")).toBeUndefined();
  });

  it("preserves precise safe model-repair hints across bounded recompilation", () => {
    const issue = { error_code: "F02-ERR-007", stage: "V06",
      json_path: "$.nodes[1]", repair_hint: canonicalRepairHint("F02-ERR-007", "V06", "$.nodes[1]") };
    expect(accumulateValidationIssues([], [issue, issue])).toEqual([issue]);
  });

  it("requires each generated node to be connected to exactly one root", () => {
    expect(SYSTEM_POLICY.BLUEPRINT_COMPOSE).toContain("ONE CONNECTED ROOTED TREE");
    expect(SYSTEM_POLICY.BLUEPRINT_COMPOSE).toContain("Orphan nodes at $.nodes[N]");
    expect(SYSTEM_POLICY.BLUEPRINT_COMPOSE).toContain("WALK children recursively");
  });
});
