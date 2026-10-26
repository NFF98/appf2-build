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

  test("never repairs malformed root, unknown source or non-boolean provided flag", () => {
    expect(normalizeAnalysisDescriptorFlags([])).toEqual([]);
    const value = {
      requested_outputs: [{ source: "FORGED", id: "x" }, { id: "bad", source: "USER_EXPLICIT", required: "yes" }],
      capability_hints: []
    };
    expect(normalizeAnalysisDescriptorFlags(value as unknown as JsonValue)).toEqual(value);
  });
});
