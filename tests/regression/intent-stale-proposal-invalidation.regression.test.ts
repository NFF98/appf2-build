import { describe, expect, test } from "vitest";

import { mergeReanalysis } from "../../src/platform/intent/analysis-merge.js";
import { submitClarificationAnswers } from "../../src/platform/intent/answer-merge.js";
import { evaluateClarificationPolicy } from "../../src/platform/intent/clarification-policy.js";
import { policyItemsOf, type PolicyVisibleItem } from "../../src/platform/intent/intent-contract.js";
import { startIntentClarification, type TrustedIntentState } from "../../src/platform/intent/intent-state.js";
import { invalidateStaleProposals } from "../../src/platform/intent/trusted-merge.js";
import {
  NFF_POLICY_REF,
  analysis,
  item,
  knownInput,
  llmProposal,
  nffDefault,
  persistedState,
  requiredMissing,
  userExplicit,
  type EnvelopeParts
} from "../contract/intent-envelope-fixtures.js";

function itemById(state: TrustedIntentState, id: string): PolicyVisibleItem {
  return policyItemsOf(state.envelope).find((entry) => entry.item.id === id)!.item;
}

function answerItem(state: TrustedIntentState, itemId: string, value: unknown): TrustedIntentState {
  const question = evaluateClarificationPolicy(state).questions.find((entry) => entry.semantic_item_ids[0] === itemId)!;
  return submitClarificationAnswers(state, { answers: [{ question_id: question.question_id, value }], assumption_decisions: [], intent_version: 1 });
}

function changedIds(state: TrustedIntentState): readonly string[] {
  return state.envelope.analysis_metadata.clarification_policy_state.changed_semantic_item_ids;
}

/** Locked invalidation result: UNRESOLVED, can_default=false, both values cleared, everything else kept. */
function invalidated(before: PolicyVisibleItem): PolicyVisibleItem {
  const next: Record<string, unknown> = { ...before, resolution_state: "UNRESOLVED", can_default: false };
  delete next.proposed_default;
  delete next.resolved_value;
  return next as PolicyVisibleItem;
}

describe("BF-045 dependent stale-proposal invalidation runs before policy re-evaluation", () => {
  test("a direct upstream answer invalidates one dependent PROPOSED item before policy", () => {
    const start = startIntentClarification(
      analysis({
        missing_fields: [requiredMissing("headcount")],
        assumptions: [llmProposal("rounding", "per_person_100", { depends_on_ids: ["headcount"], source_ref: { origin_item_id: "rule_9" } })]
      })
    );
    expect(evaluateClarificationPolicy(start).triggered_rule_ids).toEqual(["F01-POL-CP-001", "F01-POL-CP-004"]);

    const answered = answerItem(start, "headcount", 12);
    expect(itemById(answered, "rounding")).toStrictEqual(invalidated(itemById(start, "rounding")));
    expect(itemById(answered, "rounding")).toMatchObject({ source: "LLM_PROPOSED", source_ref: { origin_item_id: "rule_9" }, question_type: "FREE_TEXT" });
    expect(changedIds(answered)).toEqual(["headcount", "rounding"]);

    const evaluation = evaluateClarificationPolicy(answered);
    expect(evaluation.decision).toBe("NEEDS_CLARIFICATION");
    expect(evaluation.triggered_rule_ids).toEqual(["F01-POL-CP-003A", "F01-POL-CP-006"]);
    expect(evaluation.questions.map((question) => [question.semantic_item_ids[0], question.policy_rule_id])).toEqual([["rounding", "F01-POL-CP-003A"]]);
    expect(evaluation.visible_assumptions.some((entry) => entry.proposed_default !== undefined)).toBe(false);
  });

  test("recursive chain A -> B -> C invalidates B and C to fixpoint and records both changed IDs", () => {
    const start = startIntentClarification(
      analysis({
        missing_fields: [requiredMissing("a_headcount")],
        assumptions: [
          llmProposal("b_split", "even", { depends_on_ids: ["a_headcount"] }),
          nffDefault("c_rounding", "nearest_10", { depends_on_ids: ["b_split"] }),
          llmProposal("d_receipt", "email", { depends_on_ids: ["c_rounding"], can_default: false })
        ]
      })
    );
    const answered = answerItem(start, "a_headcount", 8);
    for (const id of ["b_split", "c_rounding", "d_receipt"]) {
      expect(itemById(answered, id)).toStrictEqual(invalidated(itemById(start, id)));
    }
    expect(itemById(answered, "c_rounding").source_ref).toEqual(NFF_POLICY_REF);
    expect(changedIds(answered)).toEqual(["a_headcount", "b_split", "c_rounding", "d_receipt"]);
    expect(evaluateClarificationPolicy(answered).questions.map((question) => question.semantic_item_ids[0])).toEqual(["b_split", "c_rounding", "d_receipt"]);
  });

  test("recursive closure reaches a PROPOSED item through an unchanged CONFIRMED intermediate", () => {
    const parts: EnvelopeParts = {
      missing_fields: [requiredMissing("a_headcount")],
      constraints: [userExplicit("m_venue", "rooftop", { depends_on_ids: ["a_headcount"] })],
      assumptions: [llmProposal("p_menu", "set_menu", { depends_on_ids: ["m_venue"] })]
    };
    const start = startIntentClarification(analysis(parts));
    const answered = answerItem(start, "a_headcount", 8);
    expect(itemById(answered, "m_venue")).toStrictEqual(itemById(start, "m_venue"));
    expect(itemById(answered, "p_menu")).toStrictEqual(invalidated(itemById(start, "p_menu")));
    expect(changedIds(answered)).toEqual(["a_headcount", "p_menu"]);
  });

  test("an unrelated upstream change does not invalidate a proposal", () => {
    const start = startIntentClarification(
      analysis({
        known_inputs: [knownInput("currency_hint", "TWD")],
        missing_fields: [requiredMissing("headcount")],
        assumptions: [nffDefault("currency", "TWD", { depends_on_ids: ["currency_hint"] })]
      })
    );
    const answered = answerItem(start, "headcount", 12);
    expect(itemById(answered, "currency")).toStrictEqual(itemById(start, "currency"));
    expect(changedIds(answered)).toEqual(["headcount"]);
    const evaluation = evaluateClarificationPolicy(answered);
    expect(evaluation.decision).toBe("READY_WITH_VISIBLE_ASSUMPTIONS");
    expect(evaluation.visible_assumptions).toEqual([expect.objectContaining({ assumption_id: "currency", classification: "DEFAULT", proposed_default: "TWD" })]);
  });

  test("dependency change does not erase CONFIRMED User-decided truth", () => {
    const parts: EnvelopeParts = {
      missing_fields: [requiredMissing("headcount")],
      constraints: [
        userExplicit("u_explicit", "rooftop", { depends_on_ids: ["headcount"] }),
        item("u_accepted", { source: "USER_ACCEPTED_PROPOSAL", resolved_value: "even", source_ref: { origin_item_id: "rule_3" }, depends_on_ids: ["headcount"] }),
        item("u_nff_accepted", { source: "NFF_DEFAULT", source_ref: { ...NFF_POLICY_REF }, resolved_value: "TWD", depends_on_ids: ["headcount"] })
      ]
    };
    const start = persistedState(parts);
    const answered = answerItem(start, "headcount", 12);
    for (const id of ["u_explicit", "u_accepted", "u_nff_accepted"]) {
      expect(itemById(answered, id)).toStrictEqual(itemById(start, id));
    }
    expect(changedIds(answered)).toEqual(["headcount"]);
    expect(evaluateClarificationPolicy(answered).decision).toBe("READY");
  });

  test("re-analysis upstream KnownInput change invalidates dependent fresh proposals before policy", () => {
    const parts = (eventType: string): EnvelopeParts => ({
      known_inputs: [knownInput("event_type", eventType, { source: "DOMAIN_KNOWN" })],
      assumptions: [nffDefault("dress_code", "smart_casual", { depends_on_ids: ["event_type"] }), llmProposal("theme", "red", { materiality: "COSMETIC" })]
    });
    const start = startIntentClarification(analysis(parts("dinner")));
    const changed = mergeReanalysis(start, analysis(parts("lunch")));
    expect(changedIds(changed)).toEqual(["dress_code", "event_type"]);
    expect(itemById(changed, "dress_code")).toStrictEqual(invalidated(itemById(start, "dress_code")));
    expect(itemById(changed, "theme")).toStrictEqual(itemById(start, "theme"));
    expect(evaluateClarificationPolicy(changed).questions.map((question) => [question.semantic_item_ids[0], question.policy_rule_id])).toEqual([
      ["dress_code", "F01-POL-CP-003A"]
    ]);

    const unchanged = mergeReanalysis(start, analysis(parts("dinner")));
    expect(changedIds(unchanged)).toEqual([]);
    expect(evaluateClarificationPolicy(unchanged).decision).toBe("READY_WITH_VISIBLE_ASSUMPTIONS");
  });

  test("invalidation is the fixpoint over the whole changed set and leaves the input Envelope untouched", () => {
    const envelope = startIntentClarification(
      analysis({
        known_inputs: [knownInput("k1", 1), knownInput("k2", 2)],
        assumptions: [
          llmProposal("p1", "a", { depends_on_ids: ["k1"] }),
          llmProposal("p2", "b", { depends_on_ids: ["p1", "k2"] }),
          llmProposal("p3", "c", { depends_on_ids: ["k2"] }),
          llmProposal("p4", "d", { depends_on_ids: ["p2"] })
        ]
      })
    ).envelope;
    const result = invalidateStaleProposals(envelope, new Set(["k1"]));
    expect(result.invalidated_item_ids).toEqual(["p1", "p2", "p4"]);
    expect(result.envelope.assumptions.find((entry) => entry.id === "p3")).toBe(envelope.assumptions.find((entry) => entry.id === "p3"));
    expect(envelope.assumptions.every((entry) => entry.resolution_state === "PROPOSED")).toBe(true);
    expect(invalidateStaleProposals(envelope, new Set(["unrelated"]))).toEqual({ envelope, invalidated_item_ids: [] });
  });
});
