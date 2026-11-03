import { describe, expect, it } from "vitest";
import { resolveCapabilityCoverage } from "../../src/platform/capabilities/coverage.js";
import { extractCapabilityRequirements } from "../../src/platform/intent/capability-requirements.js";
import type { CapabilityHintV1 } from "../../src/platform/intent/intent-contract.js";
import { SYSTEM_POLICY } from "../../src/platform/compiler/prompts.js";

const hint: CapabilityHintV1 = {
  hint_id: "hint_smart_tasks",
  semantic_need: "Allow users to add, edit, complete, delete and filter tasks",
  required: false, // Reproduce the model's false-optional LifePilot response.
  impact_level: "HIGH",
  input_types: ["LIST", "STRING"],
  output_types: ["LIST"],
  interaction_class: "form",
  constraint_item_ids: ["feature_smart_tasks"],
  source_item_ids: ["feature_smart_tasks"]
};

function requirements(requiredUserFacts: ReadonlySet<string>) {
  return extractCapabilityRequirements({
    hints: [hint],
    constraints: [{ id: "feature_smart_tasks", value: "Editable tasks", value_type: "STRING" }],
    traceable_item_ids: new Set(["feature_smart_tasks"]),
    intent_classes: new Set(["form"]),
    required_user_item_ids: requiredUserFacts
  });
}

describe("Sprint 3.5 user-required feature preservation", () => {
  it("does not allow the model to downgrade a confirmed, mandatory LifePilot feature", () => {
    const [requirement] = requirements(new Set(["feature_smart_tasks"]));
    expect(requirement?.required).toBe(true);
    const coverage = resolveCapabilityCoverage({ requirements: [requirement!] });
    expect(coverage.requirements[0]?.status).toBe("UNSUPPORTED");
    expect(coverage.status).toBe("UNSUPPORTED");
    expect(coverage.selected).toHaveLength(0);
  });

  it("keeps truly optional features optional and makes no new capability", () => {
    const [optional] = requirements(new Set());
    expect(optional?.required).toBe(false);
    const coverage = resolveCapabilityCoverage({ requirements: [optional!] });
    expect(coverage.requirements[0]?.status).toBe("UNSUPPORTED");
    expect(coverage.status).toBe("FULLY_SUPPORTED");
    expect(coverage.selected).toHaveLength(0);
  });

  it("requires honest atomic UI hints instead of an impossible RECORD-to-LIST form", () => {
    expect(SYSTEM_POLICY.INTENT_ANALYSIS).toContain("Do NOT model the entire add/edit/delete task workflow");
    expect(SYSTEM_POLICY.INTENT_ANALYSIS).toContain("Each hint's input_types/output_types describe ONLY that individual primitive");
    expect(SYSTEM_POLICY.INTENT_ANALYSIS).toContain("source_item_ids referring back to the original mandatory feature");
    expect(SYSTEM_POLICY.INTENT_ANALYSIS).toContain("do not claim that an unsupported composite workflow");
  });

  it("requires F01 analysis to preserve explicit product requirements", () => {
    expect(SYSTEM_POLICY.INTENT_ANALYSIS).toContain("Never downgrade requested functionality");
  });
});
