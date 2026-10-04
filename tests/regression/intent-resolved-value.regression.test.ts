import { describe, expect, test } from "vitest";

import { submitClarificationAnswers } from "../../src/platform/intent/answer-merge.js";
import { evaluateClarificationPolicy } from "../../src/platform/intent/clarification-policy.js";
import type { PolicyVisibleItem } from "../../src/platform/intent/intent-contract.js";
import { restoreTrustedIntentState, startIntentClarification, type TrustedIntentState } from "../../src/platform/intent/intent-state.js";
import { admitResolvedIntent } from "../../src/platform/intent/resolved-intent-gate.js";
import {
  NFF_POLICY_REF,
  analysis,
  choiceAmbiguity,
  expectIntentError,
  llmProposal,
  nffDefault,
  requiredMissing
} from "../contract/intent-envelope-fixtures.js";

function assumptionById(state: TrustedIntentState, id: string): PolicyVisibleItem {
  return state.envelope.assumptions.find((entry) => entry.id === id)!;
}

/** The item after a locked transition: `changes` applied, proposed_default (and optionally resolved_value) removed. */
function expectedAfter(before: PolicyVisibleItem, changes: Partial<PolicyVisibleItem>, dropResolved = false): PolicyVisibleItem {
  const next: Record<string, unknown> = { ...before, ...changes, can_default: false };
  delete next.proposed_default;
  if (dropResolved) delete next.resolved_value;
  return next as PolicyVisibleItem;
}

describe("BF-045 resolved_value is the only canonical confirmed value", () => {
  test("clarification answer is stored in the target resolved_value and no answer-value sidecar exists", () => {
    const start = startIntentClarification(
      analysis({ missing_fields: [requiredMissing("bill_total")], ambiguities: [choiceAmbiguity("split_rule", ["even", "by_item"])] })
    );
    const questions = evaluateClarificationPolicy(start).questions;
    const answered = submitClarificationAnswers(start, {
      answers: [
        { question_id: questions.find((question) => question.semantic_item_ids[0] === "bill_total")!.question_id, value: 12500 },
        { question_id: questions.find((question) => question.semantic_item_ids[0] === "split_rule")!.question_id, value: "by_item" }
      ],
      assumption_decisions: [],
      intent_version: 1
    });

    expect(answered.envelope.missing_fields[0]).toStrictEqual(
      expectedAfter(start.envelope.missing_fields[0]!, { source: "USER_EXPLICIT", resolution_state: "CONFIRMED", resolved_value: 12500 })
    );
    expect(answered.envelope.ambiguities[0]).toMatchObject({ source: "USER_EXPLICIT", resolution_state: "CONFIRMED", resolved_value: "by_item" });
    expect(Object.keys(answered)).toEqual(["envelope"]);
    const durable = JSON.stringify(answered);
    expect(durable).not.toContain("user_explicit_values");
    expect(durable.match(/12500/g)).toHaveLength(1);
    expect(Object.keys(answered.envelope.analysis_metadata.clarification_policy_state).sort()).toEqual([
      "answered_question_ids",
      "changed_semantic_item_ids",
      "policy_version"
    ]);

    const rehydrated = restoreTrustedIntentState(JSON.parse(JSON.stringify(answered.envelope)));
    expect(rehydrated.envelope).toEqual(answered.envelope);
    expect(evaluateClarificationPolicy(rehydrated).decision).toBe("READY");
    const admission = admitResolvedIntent(rehydrated);
    expect(admission.admitted).toBe(true);
    expect(admission.admitted && admission.state.envelope.missing_fields[0]!.resolved_value).toBe(12500);
  });

  test("ACCEPT / EDIT / REJECT move and clear values exactly as locked", () => {
    const start = startIntentClarification(
      analysis({
        assumptions: [
          llmProposal("llm_accept", "nearest_10", { source_ref: { origin_item_id: "rule_42" } }),
          nffDefault("nff_accept", "TWD"),
          llmProposal("llm_edit", "hotel"),
          nffDefault("nff_reject", "even"),
          llmProposal("llm_reject", "tip_10", { source_ref: { origin_item_id: "rule_7" } })
        ]
      })
    );
    const decided = submitClarificationAnswers(start, {
      answers: [],
      assumption_decisions: [
        { assumption_id: "llm_accept", decision: "ACCEPT" },
        { assumption_id: "nff_accept", decision: "ACCEPT" },
        { assumption_id: "llm_edit", decision: "EDIT", edited_value: "rooftop" },
        { assumption_id: "nff_reject", decision: "REJECT" },
        { assumption_id: "llm_reject", decision: "REJECT" }
      ],
      intent_version: 1
    });
    const before = (id: string) => assumptionById(start, id);

    expect(assumptionById(decided, "llm_accept")).toStrictEqual(
      expectedAfter(before("llm_accept"), { source: "USER_ACCEPTED_PROPOSAL", resolution_state: "CONFIRMED", resolved_value: "nearest_10" })
    );
    expect(assumptionById(decided, "llm_accept").source_ref).toEqual({ origin_item_id: "rule_42" });
    expect(assumptionById(decided, "nff_accept")).toStrictEqual(
      expectedAfter(before("nff_accept"), { source: "NFF_DEFAULT", resolution_state: "CONFIRMED", resolved_value: "TWD" })
    );
    expect(assumptionById(decided, "nff_accept").source_ref).toEqual(NFF_POLICY_REF);
    expect(assumptionById(decided, "llm_edit")).toStrictEqual(
      expectedAfter(before("llm_edit"), { source: "USER_EXPLICIT", resolution_state: "CONFIRMED", resolved_value: "rooftop" })
    );
    expect(assumptionById(decided, "nff_reject")).toStrictEqual(expectedAfter(before("nff_reject"), { resolution_state: "UNRESOLVED" }, true));
    expect(assumptionById(decided, "llm_reject")).toStrictEqual(expectedAfter(before("llm_reject"), { resolution_state: "UNRESOLVED" }, true));
    expect(assumptionById(decided, "llm_reject")).toMatchObject({ source: "LLM_PROPOSED", source_ref: { origin_item_id: "rule_7" } });
    expect(decided.envelope.analysis_metadata.clarification_policy_state.changed_semantic_item_ids).toEqual([
      "llm_accept",
      "llm_edit",
      "llm_reject",
      "nff_accept",
      "nff_reject"
    ]);

    const after = evaluateClarificationPolicy(decided);
    expect(after.decision).toBe("NEEDS_CLARIFICATION");
    expect(after.questions.map((question) => [question.semantic_item_ids[0], question.policy_rule_id])).toEqual([
      ["llm_reject", "F01-POL-CP-003A"],
      ["nff_reject", "F01-POL-CP-003A"]
    ]);
    expect(after.visible_assumptions.filter((entry) => entry.classification === "UNKNOWN")).toEqual([]);

    expectIntentError(
      () => submitClarificationAnswers(start, { answers: [], assumption_decisions: [{ assumption_id: "llm_edit", decision: "EDIT", edited_value: 7 }], intent_version: 1 }),
      "F01-ERR-003",
      "ANSWER_TYPE_MISMATCH"
    );
  });
});
