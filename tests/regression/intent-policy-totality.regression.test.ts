import { describe, expect, test } from "vitest";

import { submitClarificationAnswers } from "../../src/platform/intent/answer-merge.js";
import { evaluateClarificationPolicy, type ClarificationPolicyEvaluation } from "../../src/platform/intent/clarification-policy.js";
import { collectEnvelopeViolations } from "../../src/platform/intent/envelope-validation.js";
import {
  INTENT_SOURCES,
  IntentContractError,
  POLICY_ITEM_COLLECTIONS,
  RESOLUTION_STATES,
  type PolicyItemCollection,
  type PolicyVisibleItem
} from "../../src/platform/intent/intent-contract.js";
import { startIntentClarification, type TrustedIntentState } from "../../src/platform/intent/intent-state.js";
import {
  NFF_POLICY_REF,
  analysis,
  choiceAmbiguity,
  expectIntentError,
  item,
  llmProposal,
  persistedEnvelope,
  persistedState,
  unresolved,
  type ItemOverrides
} from "../contract/intent-envelope-fixtures.js";

const CLARIFICATION_RULES = ["F01-POL-CP-003", "F01-POL-CP-001", "F01-POL-CP-002", "F01-POL-CP-003A"];

function subject(collection: PolicyItemCollection, overrides: ItemOverrides): PolicyVisibleItem {
  if (collection === "ambiguities") return choiceAmbiguity("subject", ["x", "y"], overrides);
  return unresolved("subject", overrides);
}

function answerValue(collection: PolicyItemCollection): string {
  return collection === "ambiguities" ? "x" : "v";
}

describe("BF-044 CP-003A totality fallback", () => {
  test("MATERIAL unresolved item without safe default, risk, required flag or HIGH ambiguity is asked through CP-003A", () => {
    for (const collection of POLICY_ITEM_COLLECTIONS) {
      const counterexample = subject(collection, { impact_level: "MEDIUM" });
      const evaluation = evaluateClarificationPolicy(startIntentClarification(analysis({ [collection]: [counterexample] })));
      expect(evaluation.decision).toBe("NEEDS_CLARIFICATION");
      expect(evaluation.triggered_rule_ids).toEqual(["F01-POL-CP-003A"]);
      expect(evaluation.questions.map((question) => [question.policy_rule_id, question.semantic_item_ids])).toEqual([["F01-POL-CP-003A", ["subject"]]]);
      expect(evaluation.visible_assumptions.some((entry) => entry.classification === "UNKNOWN" && entry.assumption_id === "subject")).toBe(false);
    }
  });

  test("LLM proposal without safe default is never READY_WITH_VISIBLE_ASSUMPTIONS", () => {
    const proposal = llmProposal("subject", "v", { can_default: false });
    const evaluation = evaluateClarificationPolicy(startIntentClarification(analysis({ assumptions: [proposal] })));
    expect(evaluation.decision).toBe("NEEDS_CLARIFICATION");
    expect(evaluation.questions[0]?.policy_rule_id).toBe("F01-POL-CP-003A");
  });
});

describe("BF-045 former F01-ERR-014 policy holes are Envelope invariant failures before policy", () => {
  test("UNRESOLVED + can_default=true is rejected as an Envelope invariant", () => {
    for (const overrides of [{ can_default: true, proposed_default: "v" }, { can_default: true }] as const) {
      const invalid = unresolved("x", overrides);
      const reasons = collectEnvelopeViolations(analysis({ constraints: [invalid] }), "UNTRUSTED_ANALYSIS").map((violation) => violation.reason);
      expect(reasons).toContain("CAN_DEFAULT_ONLY_FOR_PROPOSED");
      expectIntentError(() => startIntentClarification(analysis({ constraints: [invalid] })), "F01-ERR-002", "CAN_DEFAULT_ONLY_FOR_PROPOSED");
      expectIntentError(() => persistedState({ constraints: [invalid] }), "F01-ERR-014", "CAN_DEFAULT_ONLY_FOR_PROPOSED");
    }
  });

  test("DOMAIN_KNOWN + PROPOSED is rejected as an Envelope invariant", () => {
    for (const canDefault of [true, false]) {
      const invalid = item("y", { resolution_state: "PROPOSED", resolved_value: undefined, can_default: canDefault, proposed_default: "v" });
      expectIntentError(() => startIntentClarification(analysis({ assumptions: [invalid] })), "F01-ERR-002", "PROPOSED_SOURCE_NOT_ALLOWED");
      expectIntentError(() => persistedState({ assumptions: [invalid] }), "F01-ERR-014", "PROPOSED_SOURCE_NOT_ALLOWED");
    }
  });
});

type SweepCase = { readonly collection: PolicyItemCollection; readonly overrides: ItemOverrides };

function expand(overrides: readonly ItemOverrides[], axis: readonly ItemOverrides[]): ItemOverrides[] {
  return overrides.flatMap((base) => axis.map((value) => ({ ...base, ...value })));
}

/** Every combination of the policy-relevant axes, including value presence, for one collection. */
function sweepCases(collection: PolicyItemCollection): SweepCase[] {
  const value = answerValue(collection);
  const axes: readonly (readonly ItemOverrides[])[] = [
    INTENT_SOURCES.map((source) => ({ source, ...(source === "NFF_DEFAULT" ? { source_ref: { ...NFF_POLICY_REF } } : {}) })),
    RESOLUTION_STATES.map((resolution_state) => ({ resolution_state })),
    [{ materiality: "MATERIAL" }, { materiality: "COSMETIC" }],
    [{ policy_risk_flags: [] }, { policy_risk_flags: ["IRREVERSIBLE"] }],
    [{ can_default: false }, { can_default: true }],
    [
      { impact_level: "LOW", required_for_execution: false },
      { impact_level: "HIGH", required_for_execution: false },
      { impact_level: "MEDIUM", required_for_execution: true }
    ],
    [{ resolved_value: undefined }, { resolved_value: value }],
    [{ proposed_default: undefined }, { proposed_default: value }]
  ];
  return axes.reduce<ItemOverrides[]>(expand, [{}]).map((overrides) => ({ collection, overrides }));
}

function isContractValid(sweep: SweepCase): boolean {
  const envelope = persistedEnvelope({ [sweep.collection]: [subject(sweep.collection, sweep.overrides)] });
  return collectEnvelopeViolations(envelope, "TRUSTED").length === 0;
}

function evaluateValidState(state: TrustedIntentState): ClarificationPolicyEvaluation {
  try {
    return evaluateClarificationPolicy(state);
  } catch (error) {
    const reasons = error instanceof IntentContractError ? error.violations.map((violation) => violation.reason) : [String(error)];
    throw new Error(`Contract-valid state reached a non-policy outcome: ${reasons.join(", ")} :: ${JSON.stringify(state.envelope)}`);
  }
}

function expectNeedsClarificationIsActionable(state: TrustedIntentState, evaluation: ClarificationPolicyEvaluation, collection: PolicyItemCollection): void {
  expect(evaluation.questions).toHaveLength(1);
  const [question] = evaluation.questions;
  expect(question!.semantic_item_ids).toEqual(["subject"]);
  expect(CLARIFICATION_RULES).toContain(question!.policy_rule_id);
  expect(question!.policy_rule_id).toBe(evaluation.triggered_rule_ids[0]);

  const answered = submitClarificationAnswers(state, { answers: [{ question_id: question!.question_id, value: answerValue(collection) }], assumption_decisions: [], intent_version: 1 });
  const after = evaluateClarificationPolicy(answered);
  expect(after.decision).toBe("READY");
  expect(after.questions).toEqual([]);
}

function expectAuthorizedDecision(state: TrustedIntentState, evaluation: ClarificationPolicyEvaluation, sweep: SweepCase): void {
  const target = state.envelope[sweep.collection][0]!;
  if (evaluation.decision === "NEEDS_CLARIFICATION") {
    expectNeedsClarificationIsActionable(state, evaluation, sweep.collection);
    return;
  }
  expect(evaluation.questions).toEqual([]);
  expect(evaluation.triggered_rule_ids.some((ruleId) => CLARIFICATION_RULES.includes(ruleId))).toBe(false);
  if (evaluation.decision === "READY_WITH_VISIBLE_ASSUMPTIONS") {
    expect(evaluation.triggered_rule_ids).toEqual(["F01-POL-CP-004"]);
    expect(evaluation.visible_assumptions).toEqual([
      expect.objectContaining({ assumption_id: "subject", proposed_default: answerValue(sweep.collection) })
    ]);
    expect(["DEFAULT", "PROPOSAL"]).toContain(evaluation.visible_assumptions[0]!.classification);
    return;
  }
  expect(target.materiality === "COSMETIC" || target.resolution_state === "CONFIRMED").toBe(true);
}

describe("BF-045 F01 policy totality sweep", () => {
  test.each(POLICY_ITEM_COLLECTIONS)(
    "every contract-valid single-item %s Envelope yields a contract-authorized decision without F01-ERR-014",
    (collection) => {
      let validStates = 0;
      const decisions = new Set<string>();
      for (const sweep of sweepCases(collection)) {
        const { resolution_state: state, can_default: canDefault, source } = sweep.overrides;
        if (!isContractValid(sweep)) continue;
        expect(state === "UNRESOLVED" && canDefault === true).toBe(false);
        expect(state === "PROPOSED" && (source === "DOMAIN_KNOWN" || source === "USER_EXPLICIT" || source === "USER_ACCEPTED_PROPOSAL")).toBe(false);
        validStates += 1;
        const restored = persistedState({ [collection]: [subject(collection, sweep.overrides)] });
        const evaluation = evaluateValidState(restored);
        decisions.add(evaluation.decision);
        expectAuthorizedDecision(restored, evaluation, sweep);
      }
      expect(validStates).toBeGreaterThan(50);
      expect([...decisions].sort()).toEqual(["NEEDS_CLARIFICATION", "READY", "READY_WITH_VISIBLE_ASSUMPTIONS"]);
    },
    30_000
  );
});
