import { describe, expect, test } from "vitest";

import { mergeReanalysis } from "../../src/platform/intent/analysis-merge.js";
import { submitClarificationAnswers } from "../../src/platform/intent/answer-merge.js";
import { evaluateClarificationPolicy } from "../../src/platform/intent/clarification-policy.js";
import { startIntentClarification, type TrustedIntentState } from "../../src/platform/intent/intent-state.js";
import { invalidateStaleProposals } from "../../src/platform/intent/trusted-merge.js";
import {
  NFF_POLICY_REF,
  analysis,
  answersBody,
  findItem,
  item,
  llmProposal,
  nffDefault,
  type EnvelopeSpec
} from "../contract/intent-envelope-fixtures.js";

/**
 * guests (blocker) ← per_head (NFF default) ← rounding (LLM proposal)
 *                  ← region (confirmed domain fact) ← tax_mode (LLM proposal)
 * theme_color (LLM proposal) ← palette (unrelated, confirmed)
 */
const graph: EnvelopeSpec = {
  missing_fields: [item({ id: "guests", required_for_execution: true, expected_value_type: "NUMBER", question_type: "NUMBER" })],
  constraints: [
    item({ id: "region", resolution_state: "CONFIRMED", resolved_value: "TW", depends_on_ids: ["guests"] }),
    item({ id: "palette", resolution_state: "CONFIRMED", resolved_value: "warm" })
  ],
  assumptions: [
    nffDefault({ id: "per_head", proposed_default: "500", depends_on_ids: ["guests"], question_type: "SINGLE_CHOICE", expected_value_type: "ENUM", alternatives: ["500", "800"] }),
    llmProposal({ id: "rounding", proposed_default: "UP", depends_on_ids: ["per_head"] }),
    llmProposal({ id: "tax_mode", proposed_default: "INCLUDED", depends_on_ids: ["region"], source_ref: { origin_item_id: "tax_hint" } }),
    llmProposal({ id: "theme_color", proposed_default: "red", depends_on_ids: ["palette"] })
  ]
};

function answerGuests(state: TrustedIntentState) {
  const question = evaluateClarificationPolicy(state).questions.find((candidate) => candidate.semantic_item_ids[0] === "guests")!;
  return submitClarificationAnswers(state, answersBody([{ question_id: question.question_id, value: 8 }]));
}

describe("BF-045 dependent stale-proposal invalidation", () => {
  test("a trusted answer invalidates every PROPOSED item in its recursive dependents closure before policy re-runs", () => {
    const merged = answerGuests(startIntentClarification(analysis(graph)));
    const envelope = merged.state.envelope;

    for (const id of ["per_head", "rounding", "tax_mode"]) {
      const invalidated = findItem(envelope, id);
      expect(invalidated).toMatchObject({ resolution_state: "UNRESOLVED", can_default: false });
      expect(invalidated).not.toHaveProperty("proposed_default");
      expect(invalidated).not.toHaveProperty("resolved_value");
    }
    expect(envelope.analysis_metadata.clarification_policy_state.changed_semantic_item_ids).toEqual(["guests", "per_head", "rounding", "tax_mode"]);
    expect(merged.evaluation.decision).toBe("NEEDS_CLARIFICATION");
    expect(merged.evaluation.questions.map((question) => [question.semantic_item_ids[0], question.policy_rule_id])).toEqual([
      ["per_head", "F01-POL-CP-003A"],
      ["rounding", "F01-POL-CP-003A"],
      ["tax_mode", "F01-POL-CP-003A"]
    ]);
  });

  test("invalidation preserves identity, question shape and provenance while leaving confirmed truth and unrelated branches untouched", () => {
    const before = startIntentClarification(analysis(graph));
    const after = answerGuests(before).state.envelope;

    expect(findItem(after, "per_head")).toMatchObject({
      source: "NFF_DEFAULT",
      source_ref: NFF_POLICY_REF,
      question_type: "SINGLE_CHOICE",
      expected_value_type: "ENUM",
      alternatives: ["500", "800"],
      depends_on_ids: ["guests"]
    });
    expect(findItem(after, "tax_mode")).toMatchObject({ source: "LLM_PROPOSED", source_ref: { origin_item_id: "tax_hint" } });
    expect(findItem(after, "region")).toEqual(findItem(before.envelope, "region"));
    expect(findItem(after, "theme_color")).toEqual(findItem(before.envelope, "theme_color"));
  });

  test("REJECT is a direct change that invalidates its dependent proposals", () => {
    const state = startIntentClarification(
      analysis({ assumptions: [llmProposal({ id: "split", proposed_default: "EQUAL" }), llmProposal({ id: "rounding", proposed_default: "UP", depends_on_ids: ["split"] })] })
    );
    const merged = submitClarificationAnswers(state, answersBody([], [{ assumption_id: "split", decision: "REJECT" }]));

    expect(findItem(merged.state.envelope, "rounding")).toMatchObject({ resolution_state: "UNRESOLVED", can_default: false });
    expect(merged.state.envelope.analysis_metadata.clarification_policy_state.changed_semantic_item_ids).toEqual(["rounding", "split"]);
  });

  test("the fixpoint equals the PROPOSED subset of the transitive dependents and is idempotent", () => {
    const envelope = startIntentClarification(analysis(graph)).envelope;
    const first = invalidateStaleProposals(envelope, new Set(["guests"]));
    const second = invalidateStaleProposals(first.envelope, new Set(["guests", ...first.invalidated_item_ids]));

    expect(first.invalidated_item_ids).toEqual(["per_head", "rounding", "tax_mode"]);
    expect(second.invalidated_item_ids).toEqual([]);
    expect(invalidateStaleProposals(envelope, new Set(["unknown_id"])).envelope).toBe(envelope);
  });

  test("a later re-analysis may propose again, validated against post-merge truth, but same-merge proposals on a changed upstream are stale", () => {
    const answered = answerGuests(startIntentClarification(analysis(graph))).state;
    const refreshed = mergeReanalysis(answered, analysis({ assumptions: [llmProposal({ id: "rounding", proposed_default: "DOWN", depends_on_ids: ["per_head"] })] }));

    expect(findItem(refreshed.state.envelope, "rounding")).toMatchObject({ resolution_state: "PROPOSED", proposed_default: "DOWN" });
    expect(refreshed.state.envelope.analysis_metadata.clarification_policy_state.changed_semantic_item_ids).toEqual(["rounding"]);

    const sameMerge = mergeReanalysis(
      answered,
      analysis({
        assumptions: [
          nffDefault({ id: "per_head", proposed_default: "800", depends_on_ids: ["guests"], question_type: "SINGLE_CHOICE", expected_value_type: "ENUM", alternatives: ["500", "800"] }),
          llmProposal({ id: "rounding", proposed_default: "DOWN", depends_on_ids: ["per_head"] })
        ]
      })
    );
    expect(findItem(sameMerge.state.envelope, "per_head")).toMatchObject({ resolution_state: "PROPOSED", proposed_default: "800" });
    expect(findItem(sameMerge.state.envelope, "rounding")).toMatchObject({ resolution_state: "UNRESOLVED" });

    expect(() => mergeReanalysis(answered, analysis({ assumptions: [llmProposal({ id: "orphan", proposed_default: "x", depends_on_ids: ["nope"] })] }))).toThrowError(
      expect.objectContaining({ code: "F01-ERR-002" })
    );
    const cyclic = analysis({
      assumptions: [
        llmProposal({ id: "rounding", proposed_default: "DOWN", depends_on_ids: ["per_head", "loop"] }),
        llmProposal({ id: "loop", proposed_default: "x", depends_on_ids: ["rounding"] })
      ]
    });
    expect(() => mergeReanalysis(answered, cyclic)).toThrowError(expect.objectContaining({ code: "F01-ERR-002" }));
  });
});
