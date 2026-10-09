import { describe, expect, test } from "vitest";

import { evaluateClarificationPolicy } from "../../src/platform/intent/clarification-policy.js";
import type { PolicyVisibleItem } from "../../src/platform/intent/intent-contract.js";
import { startIntentClarification } from "../../src/platform/intent/intent-state.js";
import type { JsonValue } from "../../src/platform/intent/json-value.js";
import { matchItem } from "../../src/platform/intent/policy-rules.js";
import {
  OPEN_JSON_RECORD_V1,
  projectEditShape,
  projectVisibleAssumptions
} from "../../src/platform/intent/visible-assumptions.js";
import {
  EXPECTED_EDIT_SHAPES,
  FREE_TEXT_AMBIGUITY,
  OPEN_RECORD_DESCRIPTOR,
  SIX_TYPE_ASSUMPTIONS,
  editShapeAnalysis
} from "./intent-edit-shape-fixtures.js";
import { analysis, confirmed, item, llmProposal, nffDefault } from "./intent-envelope-fixtures.js";

const invariant = (reason: string) =>
  expect.objectContaining({ code: "F01-ERR-014", violations: [expect.objectContaining({ reason })] });

/** Bypasses Envelope validation on purpose: proves the projection layer fails closed on its own. */
function forged(base: PolicyVisibleItem, patch: Record<string, unknown>): PolicyVisibleItem {
  return { ...base, ...patch } as unknown as PolicyVisibleItem;
}

function projectForged(target: PolicyVisibleItem) {
  const match = matchItem({ collection: "assumptions", item: target });
  if (match === null) throw new Error("fixture has no policy outcome");
  return projectVisibleAssumptions([match]);
}

describe("F01-DATA-004A edit-shape projection contract", () => {
  test("F01-DATA-004A OPEN_JSON_RECORD_V1 is the exact frozen locked descriptor", () => {
    expect(OPEN_JSON_RECORD_V1).toStrictEqual(OPEN_RECORD_DESCRIPTOR);
    expect(Object.isFrozen(OPEN_JSON_RECORD_V1)).toBe(true);
  });

  test("F01-DATA-004A each of the six value types projects only its own shape fields", () => {
    for (const source of [...SIX_TYPE_ASSUMPTIONS, FREE_TEXT_AMBIGUITY]) {
      expect(JSON.parse(JSON.stringify(projectEditShape(source))), source.id).toStrictEqual(EXPECTED_EDIT_SHAPES[source.id]);
    }
  });

  test("F01-DATA-004A choice options keep the exact validated alternatives order and native JsonValue types", () => {
    const alternatives: JsonValue[] = [false, 0, "0", null, { nested: [1, "1"] }, [true]];
    const list = projectEditShape(
      llmProposal({ id: "pick", expected_value_type: "LIST", question_type: "MULTI_CHOICE", alternatives, proposed_default: [null, [true]] })
    );
    expect(list.options).toStrictEqual(alternatives);
    const single = projectEditShape(
      nffDefault({ id: "one", expected_value_type: "ENUM", question_type: "SINGLE_CHOICE", alternatives: [3, "3", true], proposed_default: "3" })
    );
    expect(single.options).toStrictEqual([3, "3", true]);
  });

  test("F01-DATA-004A non-pending classes never carry edit-shape metadata", () => {
    const evaluation = evaluateClarificationPolicy(
      startIntentClarification(
        analysis({
          constraints: [confirmed({ id: "fact_enum", expected_value_type: "ENUM", question_type: "SINGLE_CHOICE", alternatives: ["a", "b"], resolved_value: "a" })],
          missing_fields: [item({ id: "unknown_record", expected_value_type: "RECORD", question_type: "STRUCTURED_FIELDS" })]
        })
      )
    );
    expect(evaluation.decision).toBe("NEEDS_CLARIFICATION");
    for (const entry of evaluation.visible_assumptions) {
      for (const field of ["expected_value_type", "question_type", "options", "record_edit_schema", "proposed_default"]) {
        expect(entry, `${entry.assumption_id}.${field}`).not.toHaveProperty(field);
      }
    }
  });

  test("F01-DATA-004A a visible COSMETIC pending proposal still projects its edit shape", () => {
    const cosmetic = llmProposal({ id: "palette", materiality: "COSMETIC", expected_value_type: "ENUM", question_type: "SINGLE_CHOICE", alternatives: ["warm", "cool"], proposed_default: "warm" });
    const evaluation = evaluateClarificationPolicy(startIntentClarification(analysis({ assumptions: [cosmetic] })));
    expect(evaluation.decision).toBe("READY");
    expect(evaluation.visible_assumptions).toEqual([
      expect.objectContaining({ assumption_id: "palette", classification: "PROPOSAL", expected_value_type: "ENUM", question_type: "SINGLE_CHOICE", options: ["warm", "cool"] })
    ]);
  });

  test("F01-DATA-004A absent, malformed, mismatched or inconsistent metadata is F01-ERR-014 at the projection layer", () => {
    const [title, , , rounding, addOns, menu] = SIX_TYPE_ASSUMPTIONS as [PolicyVisibleItem, PolicyVisibleItem, PolicyVisibleItem, PolicyVisibleItem, PolicyVisibleItem, PolicyVisibleItem];
    const cases: readonly PolicyVisibleItem[] = [
      forged(title, { question_type: undefined }),
      forged(title, { expected_value_type: undefined }),
      forged(title, { question_type: "TEXTAREA" }),
      forged(title, { expected_value_type: "ENUM" }),
      forged(rounding, { question_type: "FREE_TEXT" }),
      forged(rounding, { alternatives: [10] }),
      forged(rounding, { alternatives: [10, 10] }),
      forged(rounding, { alternatives: undefined }),
      forged(rounding, { proposed_default: 99 }),
      forged(addOns, { proposed_default: ["drinks", "drinks"] }),
      forged(addOns, { proposed_default: "drinks" }),
      forged(menu, { proposed_default: ["not", "a", "record"] }),
      forged(menu, { proposed_default: JSON.stringify({ main: "hotpot" }) }),
      forged(menu, { question_type: "MULTI_CHOICE" }),
      forged(menu, { proposed_default: undefined })
    ];
    for (const target of cases) {
      expect(() => projectForged(target), JSON.stringify(target)).toThrowError(invariant("ASSUMPTION_EDIT_SHAPE_NOT_PROJECTABLE"));
    }
  });

  test("F01-DATA-004A a projection failure aborts the whole evaluation instead of omitting the broken assumption", () => {
    const valid = startIntentClarification(editShapeAnalysis());
    const matches = valid.envelope.assumptions.map((entry) => matchItem({ collection: "assumptions", item: entry })!);
    const broken = matches.map((match) => (match.item.id === "e_add_ons" ? { ...match, item: forged(match.item, { alternatives: ["drinks"] }) } : match));
    expect(projectVisibleAssumptions(matches)).toHaveLength(SIX_TYPE_ASSUMPTIONS.length);
    expect(() => projectVisibleAssumptions(broken)).toThrowError(invariant("ASSUMPTION_EDIT_SHAPE_NOT_PROJECTABLE"));
  });
});
