import { describe, expect, test } from "vitest";
import { normalizeAnalysisDescriptorFlags } from "../../src/platform/compiler/normalize-analysis-shape.js";
import type { JsonValue } from "../../src/platform/intent/json-value.js";

describe("Sprint 3.5 F01 question-type metadata safety", () => {
  test("repairs unambiguous question metadata without modifying required facts or unsafe choice contracts", () => {
    const payload = { requested_outputs: [], capability_hints: [], constraints: [
      { id: "weekly_budget", expected_value_type: "NUMBER", question_type: "FREE_TEXT",
        resolution_state: "UNRESOLVED", alternatives: [], policy_risk_flags: [],
        required_for_execution: true, source: "USER_EXPLICIT" },
      { id: "risky", expected_value_type: "NUMBER", question_type: "FREE_TEXT",
        alternatives: [], policy_risk_flags: ["MONEY"] },
      { id: "unsupported_choices", expected_value_type: "ENUM", question_type: "FREE_TEXT",
        alternatives: ["only_one"], policy_risk_flags: [] },
      { id: "maybe_choice", expected_value_type: "STRING", question_type: "SINGLE_CHOICE",
        alternatives: ["A", "B"], policy_risk_flags: [] },
      { id: "safe_choices", expected_value_type: "ENUM", question_type: "FREE_TEXT",
        alternatives: ["A", "B"], policy_risk_flags: [] }
    ] };
    const input = structuredClone(payload);
    const result = normalizeAnalysisDescriptorFlags(payload as JsonValue) as typeof payload;
    expect(result.constraints[0]?.question_type).toBe("NUMBER");
    expect(result.constraints[0]?.expected_value_type).toBe("NUMBER");
    expect(result.constraints[0]?.source).toBe("USER_EXPLICIT");
    expect(result.constraints[1]).toEqual(payload.constraints[1]);
    expect(result.constraints[2]).toEqual(payload.constraints[2]);
    expect(result.constraints[3]).toEqual(payload.constraints[3]);
    expect(result.constraints[4]?.question_type).toBe("SINGLE_CHOICE");
    expect(payload).toEqual(input);
  });

});
