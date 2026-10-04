import { describe, expect, test } from "vitest";

import { lockedEvidenceRegistry } from "../../src/platform/evidence/evidence-registry.js";
import { submitClarificationAnswers } from "../../src/platform/intent/answer-merge.js";
import { evaluateClarificationPolicy } from "../../src/platform/intent/clarification-policy.js";
import { POLICY_RISK_FLAGS, type PolicyVisibleItem } from "../../src/platform/intent/intent-contract.js";
import { restoreTrustedIntentState, startIntentClarification } from "../../src/platform/intent/intent-state.js";
import { admitResolvedIntent } from "../../src/platform/intent/resolved-intent-gate.js";
import {
  NFF_POLICY_REF,
  analysis,
  answersBody,
  confirmed,
  findItem,
  item,
  llmProposal,
  nffDefault,
  persisted
} from "./intent-envelope-fixtures.js";

const UNTRUSTED_RISK_STATES: readonly [string, (flag: (typeof POLICY_RISK_FLAGS)[number]) => PolicyVisibleItem][] = [
  ["safe LLM proposal", (flag) => llmProposal({ id: "risk", policy_risk_flags: [flag], proposed_default: "500" })],
  ["unsafe LLM proposal", (flag) => llmProposal({ id: "risk", policy_risk_flags: [flag], proposed_default: "500", can_default: false })],
  ["safe NFF default", (flag) => nffDefault({ id: "risk", policy_risk_flags: [flag], proposed_default: "TWD" })],
  ["confirmed domain fact", (flag) => item({ id: "risk", policy_risk_flags: [flag], resolution_state: "CONFIRMED", resolved_value: "known" })],
  ["domain unknown", (flag) => item({ id: "risk", policy_risk_flags: [flag] })]
];

describe("F01-AC-003 money / permission / external-cost / irreversible gate", () => {
  for (const flag of POLICY_RISK_FLAGS) {
    for (const [label, build] of UNTRUSTED_RISK_STATES) {
      test(`TEST-F01-CP-003 ${flag} rule from ${label} is NEEDS_CLARIFICATION owned by CP-003`, () => {
        const evaluation = evaluateClarificationPolicy(startIntentClarification(analysis({ candidate_rules: [build(flag)] })));

        expect(evaluation.decision).toBe("NEEDS_CLARIFICATION");
        expect(evaluation.triggered_rule_ids[0]).toBe("F01-POL-CP-003");
        expect(evaluation.questions).toHaveLength(1);
        expect(evaluation.questions[0]).toMatchObject({ semantic_item_ids: ["risk"], policy_rule_id: "F01-POL-CP-003", required: true });
        expect(admitResolvedIntent(startIntentClarification(analysis({ candidate_rules: [build(flag)] }))).admitted).toBe(false);
      });
    }

    test(`TEST-F01-CP-003 ${flag} rule that is USER_EXPLICIT does not trigger CP-003`, () => {
      const evaluation = evaluateClarificationPolicy(
        startIntentClarification(analysis({ candidate_rules: [confirmed({ id: "risk", policy_risk_flags: [flag], resolved_value: "1200" })] }))
      );

      expect(evaluation.decision).toBe("READY");
      expect(evaluation.triggered_rule_ids).toEqual(["F01-POL-CP-006"]);
      expect(evaluation.questions).toEqual([]);
    });
  }

  test("TEST-F01-CP-003 CP-003 outranks CP-001 on the same required missing item and owns the question", () => {
    const risky = item({ id: "budget", policy_risk_flags: ["MONEY"], required_for_execution: true, expected_value_type: "NUMBER", question_type: "NUMBER" });
    const evaluation = evaluateClarificationPolicy(startIntentClarification(analysis({ missing_fields: [risky] })));

    expect(evaluation.triggered_rule_ids).toEqual(["F01-POL-CP-003", "F01-POL-CP-001"]);
    expect(evaluation.questions.map((question) => question.policy_rule_id)).toEqual(["F01-POL-CP-003"]);
  });

  test("TEST-F01-CP-003 accepted proposals and accepted NFF defaults still require an explicit User answer", () => {
    const accepted = restoreTrustedIntentState(
      persisted({
        candidate_rules: [
          item({ id: "fee", source: "USER_ACCEPTED_PROPOSAL", resolution_state: "CONFIRMED", resolved_value: "50", policy_risk_flags: ["EXTERNAL_COST"] }),
          item({ id: "currency", source: "NFF_DEFAULT", source_ref: { ...NFF_POLICY_REF }, resolution_state: "CONFIRMED", resolved_value: "TWD", policy_risk_flags: ["MONEY"] })
        ]
      })
    );
    const evaluation = evaluateClarificationPolicy(accepted);

    expect(evaluation.decision).toBe("NEEDS_CLARIFICATION");
    expect(evaluation.questions.map((question) => [question.semantic_item_ids[0], question.policy_rule_id])).toEqual([
      ["currency", "F01-POL-CP-003"],
      ["fee", "F01-POL-CP-003"]
    ]);
  });

  test("TEST-F01-CP-003 a risk proposal cannot be resolved by assumption ACCEPT or EDIT, only by a clarification answer", () => {
    const state = startIntentClarification(analysis({ candidate_rules: [llmProposal({ id: "deposit", policy_risk_flags: ["IRREVERSIBLE"], proposed_default: "no" })] }));
    const [question] = evaluateClarificationPolicy(state).questions;

    for (const decision of [{ decision: "ACCEPT" as const }, { decision: "EDIT" as const, edited_value: "yes" }]) {
      expect(() => submitClarificationAnswers(state, answersBody([], [{ assumption_id: "deposit", ...decision }]))).toThrowError(
        expect.objectContaining({ code: "F01-ERR-003", violations: [expect.objectContaining({ reason: "RISK_ITEM_REQUIRES_CLARIFICATION_ANSWER" })] })
      );
    }

    const merged = submitClarificationAnswers(state, answersBody([{ question_id: question!.question_id, value: "yes" }]));
    expect(findItem(merged.state.envelope, "deposit")).toMatchObject({ source: "USER_EXPLICIT", resolution_state: "CONFIRMED", resolved_value: "yes", can_default: false });
    expect(findItem(merged.state.envelope, "deposit")).not.toHaveProperty("proposed_default");
    expect(merged.evaluation.decision).toBe("READY");
  });
});

describe("F01 Evidence source ownership", () => {
  test("clarification-policy and compiler economics truth have no F01 product_event property", () => {
    const clarificationEvents = ["F01-EVT-002", "F01-EVT-003", "F01-EVT-004", "F01-EVT-005", "F01-EVT-006", "F01-EVT-007"];
    for (const eventType of clarificationEvents) {
      const entry = lockedEvidenceRegistry.find(eventType);
      expect(entry?.functionId).toBe("F01");
      expect(entry?.allowedProperties.has("policy_version")).toBe(true);
      for (const forbidden of ["triggered_rule_ids", "input_tokens", "output_tokens", "estimated_cost", "raw_intent"]) {
        expect(entry?.allowedProperties.has(forbidden)).toBe(false);
      }
    }
  });
});
