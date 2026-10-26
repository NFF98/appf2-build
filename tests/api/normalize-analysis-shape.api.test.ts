import { describe, expect, test } from "vitest";
import { normalizeAnalysisDescriptorFlags } from "../../src/platform/compiler/normalize-analysis-shape.js";
import type { JsonValue } from "../../src/platform/intent/json-value.js";

describe("untrusted Prompt A descriptor flag completion", () => {
  test("completes only missing descriptor required flags without changing facts or policy content", () => {
    const value = {
      envelope_version: "1.0.0",
      goal: "task tracker",
      requested_outputs: [
        { id: "tasks", source: "USER_EXPLICIT", output_type: "LIST" },
        { id: "labels", source: "DOMAIN_KNOWN", output_type: "STRING" },
        { id: "done", source: "USER_EXPLICIT", required: false }
      ],
      capability_hints: [
        { hint_id: "task_store", semantic_need: "persist tasks" },
        { hint_id: "user_action", required: true }
      ],
      assumptions: [{ id: "privacy", resolution_state: "UNRESOLVED" }]
    };
    const before = structuredClone(value);
    const normalized = normalizeAnalysisDescriptorFlags(value as unknown as JsonValue);
    expect(value).toEqual(before);
    expect(normalized).toEqual({
      ...value,
      requested_outputs: [
        { ...value.requested_outputs[0], required: true },
        { ...value.requested_outputs[1], required: false },
        value.requested_outputs[2]
      ],
      capability_hints: [
        { ...value.capability_hints[0], required: false },
        value.capability_hints[1]
      ]
    });
  });

  test("preserves an AI scalar fact but fixes inconsistent nonrisk choice metadata", () => {
    const original = {
      requested_outputs: [],
      capability_hints: [],
      constraints: [
        { id: "color", resolution_state: "CONFIRMED", resolved_value: "red",
          expected_value_type: "ENUM", question_type: "SINGLE_CHOICE",
          alternatives: ["blue"], policy_risk_flags: [] },
        { id: "pay", resolution_state: "CONFIRMED", resolved_value: "yes",
          expected_value_type: "ENUM", question_type: "SINGLE_CHOICE",
          alternatives: ["no"], policy_risk_flags: ["MONEY"] },
        { id: "valid", resolution_state: "CONFIRMED", resolved_value: "yes",
          expected_value_type: "ENUM", question_type: "SINGLE_CHOICE",
          alternatives: ["yes", "no"], policy_risk_flags: [] }
      ]
    };
    const normalized = normalizeAnalysisDescriptorFlags(original as JsonValue) as typeof original;
    expect(normalized.constraints[0]).toMatchObject({
      id: "color", resolved_value: "red",
      expected_value_type: "STRING", question_type: "FREE_TEXT"
    });
    expect(normalized.constraints[1]).toEqual(original.constraints[1]);
    expect(normalized.constraints[2]).toEqual(original.constraints[2]);
    expect(original.constraints[0]?.expected_value_type).toBe("ENUM");
  });

  test("promotes user-required and risky cosmetics to MATERIAL without losing facts", () => {
    const value = {
      requested_outputs: [], capability_hints: [],
      constraints: [
        {id:"daily_tracking", materiality:"COSMETIC", required_for_execution:true,
          policy_risk_flags:[], resolved_value:"working habit checkboxes"},
        {id:"payments", materiality:"COSMETIC", required_for_execution:false,
          policy_risk_flags:["MONEY"], resolved_value:"not allowed"},
        {id:"accent_color", materiality:"COSMETIC", required_for_execution:false,
          policy_risk_flags:[], resolved_value:"soft teal"}
      ]
    };
    const output = normalizeAnalysisDescriptorFlags(value as unknown as JsonValue) as typeof value;
    expect(output.constraints.map(x=>x.materiality)).toEqual(["MATERIAL","MATERIAL","COSMETIC"]);
    expect(output.constraints.map(x=>x.resolved_value)).toEqual(value.constraints.map(x=>x.resolved_value));
    expect(output.constraints.map(x=>x.policy_risk_flags)).toEqual(value.constraints.map(x=>x.policy_risk_flags));
    expect(value.constraints.every(x=>x.materiality==="COSMETIC")).toBe(true);
  });

  test("never repairs malformed root, unknown source or non-boolean provided flag", () => {
    expect(normalizeAnalysisDescriptorFlags([])).toEqual([]);
    const value = {
      requested_outputs: [{ source: "FORGED", id: "x" }, { id: "bad", source: "USER_EXPLICIT", required: "yes" }],
      capability_hints: []
    };
    expect(normalizeAnalysisDescriptorFlags(value as unknown as JsonValue)).toEqual(value);
  });
});
