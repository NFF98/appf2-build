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

  test("preserves complex list/record user facts while correcting nonrisk type metadata only", () => {
    const original = { requested_outputs: [], capability_hints: [], constraints: [
      { id: "task_list", resolution_state: "CONFIRMED", resolved_value: ["A", "B"],
        expected_value_type: "STRING", question_type: "FREE_TEXT",
        alternatives: ["A", "B", "C"], policy_risk_flags: [] },
      { id: "task_record", resolution_state: "CONFIRMED", resolved_value: { title: "A", done: false },
        expected_value_type: "STRING", question_type: "FREE_TEXT",
        alternatives: [], policy_risk_flags: [] },
      { id: "sensitive_record", resolution_state: "CONFIRMED", resolved_value: { secret: "value" },
        expected_value_type: "STRING", question_type: "FREE_TEXT",
        alternatives: [], policy_risk_flags: ["MONEY"] }
    ] };
    const normalized = normalizeAnalysisDescriptorFlags(original as JsonValue) as typeof original;
    expect(normalized.constraints[0]).toMatchObject({ expected_value_type: "LIST", question_type: "MULTI_CHOICE", resolved_value: ["A", "B"] });
    expect(normalized.constraints[1]).toMatchObject({ expected_value_type: "RECORD", question_type: "STRUCTURED_FIELDS", resolved_value: { title: "A", done: false } });
    expect(normalized.constraints[2]).toEqual(original.constraints[2]);
    expect(original.constraints[0]?.expected_value_type).toBe("STRING");
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

  test("canonicalizes only exact harmless capability type synonyms, never arbitrary tokens", () => {
    const hint = {
      hint_id: "task_list", required: true,
      input_types: ["ARRAY", "INTEGER", "BOOLEAN", "UNKNOWN_TYPE"],
      output_types: ["OBJECT", "FLOAT", "LIST", "STRING"],
      source_item_ids: ["feature_smart_tasks"]
    };
    const envelope = { requested_outputs: [], capability_hints: [hint] };
    const result = normalizeAnalysisDescriptorFlags(envelope as unknown as JsonValue) as {
      capability_hints: Array<typeof hint>;
    };
    expect(result.capability_hints[0]?.input_types).toEqual(["LIST", "NUMBER", "BOOLEAN", "UNKNOWN_TYPE"]);
    expect(result.capability_hints[0]?.output_types).toEqual(["RECORD", "NUMBER", "LIST", "STRING"]);
    expect(result.capability_hints[0]?.required).toBe(true);
    expect(result.capability_hints[0]?.source_item_ids).toEqual(["feature_smart_tasks"]);
    expect(hint.input_types[0]).toBe("ARRAY");
  });

  test("natural human moving checklist: user-confirmed scalar list is projectable with exact existing values", () => {
    const checklist = ["紙箱", "膠帶", "清潔用品"];
    const item = {
      id: "shopping_items", semantic_role: "moving_shopping", source: "USER_EXPLICIT",
      resolution_state: "CONFIRMED", expected_value_type: "STRING",
      question_type: "FREE_TEXT", resolved_value: checklist,
      alternatives: [], policy_risk_flags: [], required_for_execution: true
    };
    const input = { requested_outputs: [], capability_hints: [], constraints: [item] };
    const normalized = normalizeAnalysisDescriptorFlags(input as JsonValue) as typeof input;
    expect(normalized.constraints[0]).toMatchObject({
      expected_value_type: "LIST", question_type: "MULTI_CHOICE",
      resolved_value: checklist, alternatives: checklist,
      source: "USER_EXPLICIT", required_for_execution: true
    });
    expect(input.constraints[0]).toEqual(item);
  });

  test("does not invent list alternatives for unconfirmed, risky, repeated or model-proposed facts", () => {
    const base = {
      resolution_state: "CONFIRMED", source: "USER_EXPLICIT",
      expected_value_type: "STRING", question_type: "FREE_TEXT",
      resolved_value: ["高", "中", "低"], alternatives: [],
      policy_risk_flags: []
    };
    const originals = [
      {...base, source: "LLM_PROPOSED" },
      {...base, resolution_state: "PROPOSED" },
      {...base, policy_risk_flags: ["MONEY"] },
      {...base, resolved_value: ["紙箱", "紙箱"] },
      {...base, resolved_value: ["only_one"] },
      {...base, resolved_value: [{ arbitrary: true }, "text"] }
    ];
    const envelope = { requested_outputs: [], capability_hints: [],
      constraints: originals };
    const repaired = normalizeAnalysisDescriptorFlags(envelope as JsonValue) as typeof envelope;
    expect(repaired.constraints).toEqual(originals);
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
