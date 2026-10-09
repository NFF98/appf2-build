import { describe, expect, test } from "vitest";

import { submitClarificationAnswers } from "../../src/platform/intent/answer-merge.js";
import { evaluateClarificationPolicy } from "../../src/platform/intent/clarification-policy.js";
import type { PolicyVisibleItem, StructuredIntentEnvelope } from "../../src/platform/intent/intent-contract.js";
import { restoreTrustedIntentState, startIntentClarification } from "../../src/platform/intent/intent-state.js";
import { matchItem } from "../../src/platform/intent/policy-rules.js";
import { projectQuestion, questionIdFor } from "../../src/platform/intent/question-projection.js";
import { toDurableStructuredIntent } from "../../src/platform/intent/resolved-intent.js";
import { MENU_PROPOSAL, OPEN_RECORD_DESCRIPTOR, editShapeAnalysis } from "../contract/intent-edit-shape-fixtures.js";
import { analysis, answersBody, findItem, item, llmProposal, nffDefault } from "../contract/intent-envelope-fixtures.js";

const guests = item({ id: "guests", required_for_execution: true, expected_value_type: "NUMBER", question_type: "NUMBER" });
const perHead = nffDefault({ id: "per_head", expected_value_type: "ENUM", question_type: "SINGLE_CHOICE", alternatives: [800, "500"], proposed_default: "500", depends_on_ids: ["guests"] });
const menu = llmProposal({ id: "menu", expected_value_type: "RECORD", question_type: "STRUCTURED_FIELDS", proposed_default: MENU_PROPOSAL, depends_on_ids: ["guests"] });

describe("F01-DATA-004A edit-shape regressions", () => {
  test("stale-proposal invalidation drops the edit shape while question-shape provenance keeps the same options", () => {
    const state = startIntentClarification(analysis({ missing_fields: [guests], assumptions: [perHead, menu] }));
    const initial = evaluateClarificationPolicy(state);
    expect(initial.visible_assumptions.filter((entry) => entry.classification === "DEFAULT" || entry.classification === "PROPOSAL")).toEqual([
      expect.objectContaining({ assumption_id: "menu", question_type: "STRUCTURED_FIELDS", record_edit_schema: OPEN_RECORD_DESCRIPTOR }),
      expect.objectContaining({ assumption_id: "per_head", question_type: "SINGLE_CHOICE", options: [800, "500"] })
    ]);

    const merged = submitClarificationAnswers(state, answersBody([{ question_id: questionIdFor("F01-POL-CP-001", ["guests"]), value: 8 }]));
    for (const id of ["menu", "per_head"]) {
      const view = merged.evaluation.visible_assumptions.find((entry) => entry.assumption_id === id);
      expect(view, id).toMatchObject({ classification: "UNKNOWN" });
      for (const field of ["expected_value_type", "question_type", "options", "record_edit_schema", "proposed_default"]) expect(view, id).not.toHaveProperty(field);
    }
    expect(findItem(merged.state.envelope, "per_head")).toMatchObject({ question_type: "SINGLE_CHOICE", alternatives: [800, "500"] });
    expect(merged.evaluation.questions.map((question) => [question.semantic_item_ids[0], question.question_type, question.options])).toEqual([
      ["menu", "STRUCTURED_FIELDS", undefined],
      ["per_head", "SINGLE_CHOICE", [800, "500"]]
    ]);
  });

  test("persisted restore and collection order never change the projected edit shape", () => {
    const sealed = startIntentClarification(editShapeAnalysis());
    const durable = toDurableStructuredIntent(sealed.envelope);
    const reversed: StructuredIntentEnvelope = { ...durable, assumptions: [...durable.assumptions].reverse() };
    const first = evaluateClarificationPolicy(sealed).visible_assumptions;
    expect(evaluateClarificationPolicy(restoreTrustedIntentState(JSON.parse(JSON.stringify(durable)))).visible_assumptions).toStrictEqual(first);
    expect(evaluateClarificationPolicy(restoreTrustedIntentState(reversed)).visible_assumptions).toStrictEqual(first);
  });

  test("clarification questions still fail closed on an unprojectable answer shape after the shared shape check", () => {
    const candidate = (target: PolicyVisibleItem) => ({
      match: matchItem({ collection: "missing_fields", item: target })!,
      question_id: questionIdFor("F01-POL-CP-001", [target.id]),
      already_asked: false,
      downstream_unknowns_resolved: 0
    });
    expect(projectQuestion(candidate(guests))).not.toHaveProperty("options");
    const choice = item({ id: "tip", required_for_execution: true, expected_value_type: "LIST", question_type: "MULTI_CHOICE", alternatives: [1, { pct: 10 }] });
    expect(projectQuestion(candidate(choice)).options).toStrictEqual([1, { pct: 10 }]);
    for (const patch of [{ question_type: "SINGLE_CHOICE" }, { alternatives: [1, 1] }]) {
      expect(() => projectQuestion(candidate({ ...choice, ...patch } as PolicyVisibleItem))).toThrowError(
        expect.objectContaining({ code: "F01-ERR-014", violations: [expect.objectContaining({ reason: "QUESTION_NOT_PROJECTABLE" })] })
      );
    }
  });
});
