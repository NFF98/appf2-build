import { describe, expect, test } from "vitest";

import { submitClarificationAnswers } from "../../src/platform/intent/answer-merge.js";
import { evaluateClarificationPolicy, type ClarificationPolicyEvaluation } from "../../src/platform/intent/clarification-policy.js";
import {
  IMPACT_LEVELS,
  INTENT_SOURCES,
  IntentContractError,
  POLICY_ITEM_COLLECTIONS,
  RESOLUTION_STATES,
  type PolicyItemCollection,
  type PolicyVisibleItem
} from "../../src/platform/intent/intent-contract.js";
import { startIntentClarification, type TrustedIntentState } from "../../src/platform/intent/intent-state.js";
import { analysis, choiceAmbiguity, item, persistedState, type ItemOverrides } from "../contract/intent-envelope-fixtures.js";

const CLARIFICATION_RULES = ["F01-POL-CP-003", "F01-POL-CP-001", "F01-POL-CP-002", "F01-POL-CP-003A"];
/** Fail-closed outcomes for valid states the frozen CP table does not own; never a silent decision. */
const KNOWN_INVARIANT_REASONS = ["NO_POLICY_OUTCOME", "MATERIAL_ASSUMPTION_NOT_PRESENTABLE"];

function subject(collection: PolicyItemCollection, overrides: ItemOverrides): PolicyVisibleItem {
  if (collection === "ambiguities") return choiceAmbiguity("subject", ["x", "y"], overrides);
  return item("subject", overrides);
}

function answerValue(collection: PolicyItemCollection): string {
  return collection === "ambiguities" ? "x" : "v";
}

describe("BF-044 CP-003A totality fallback", () => {
  test("MATERIAL unresolved item without safe default, risk, required flag or HIGH ambiguity is asked through CP-003A", () => {
    for (const collection of POLICY_ITEM_COLLECTIONS) {
      const counterexample = subject(collection, { resolution_state: "UNRESOLVED", impact_level: "MEDIUM", can_default: false, required_for_execution: false });
      const evaluation = evaluateClarificationPolicy(startIntentClarification(analysis({ [collection]: [counterexample] })));
      expect(evaluation.decision).toBe("NEEDS_CLARIFICATION");
      expect(evaluation.triggered_rule_ids).toEqual(["F01-POL-CP-003A"]);
      expect(evaluation.questions.map((question) => [question.policy_rule_id, question.semantic_item_ids])).toEqual([["F01-POL-CP-003A", ["subject"]]]);
      expect(evaluation.visible_assumptions.some((entry) => entry.classification === "UNKNOWN" && entry.assumption_id === "subject")).toBe(false);
    }
  });

  test("LLM proposal without safe default is never READY_WITH_VISIBLE_ASSUMPTIONS", () => {
    const proposal = item("subject", { source: "LLM_PROPOSED", resolution_state: "PROPOSED", can_default: false });
    const evaluation = evaluateClarificationPolicy(startIntentClarification(analysis({ assumptions: [proposal] })));
    expect(evaluation.decision).toBe("NEEDS_CLARIFICATION");
    expect(evaluation.questions[0]?.policy_rule_id).toBe("F01-POL-CP-003A");
  });
});

type SweepCase = { readonly collection: PolicyItemCollection; readonly overrides: ItemOverrides };

function expand(overrides: readonly ItemOverrides[], axis: readonly ItemOverrides[]): ItemOverrides[] {
  return overrides.flatMap((base) => axis.map((value) => ({ ...base, ...value })));
}

function sweepCases(): SweepCase[] {
  const axes: readonly (readonly ItemOverrides[])[] = [
    INTENT_SOURCES.map((source) => ({ source })),
    RESOLUTION_STATES.map((resolution_state) => ({ resolution_state })),
    [{ materiality: "MATERIAL" }, { materiality: "COSMETIC" }],
    [{ policy_risk_flags: [] }, { policy_risk_flags: ["IRREVERSIBLE"] }],
    [{ can_default: false }, { can_default: true }],
    [...IMPACT_LEVELS.map((impact_level) => ({ impact_level, required_for_execution: false })), { impact_level: "MEDIUM", required_for_execution: true }]
  ];
  const combinations = axes.reduce<ItemOverrides[]>(expand, [{}]);
  return POLICY_ITEM_COLLECTIONS.flatMap((collection) =>
    combinations.map((combination) => ({
      collection,
      overrides: {
        ...combination,
        ...(combination.can_default === true ? { proposed_default: answerValue(collection) } : {}),
        ...(combination.source === "NFF_DEFAULT" ? { source_ref: { policy_id: "nff.default.split", policy_version: "2026.10" } } : {})
      }
    }))
  );
}

function restoreIfValid(sweep: SweepCase): TrustedIntentState | null {
  try {
    return persistedState({ [sweep.collection]: [subject(sweep.collection, sweep.overrides)] });
  } catch (error) {
    if (error instanceof IntentContractError) return null;
    throw error;
  }
}

function evaluateOrInvariant(state: TrustedIntentState): ClarificationPolicyEvaluation | string {
  try {
    return evaluateClarificationPolicy(state);
  } catch (error) {
    expect(error).toBeInstanceOf(IntentContractError);
    const contractError = error as IntentContractError;
    expect(contractError.code).toBe("F01-ERR-014");
    return contractError.violations[0]!.reason;
  }
}

function expectNeedsClarificationIsActionable(state: TrustedIntentState, evaluation: ClarificationPolicyEvaluation, collection: PolicyItemCollection): void {
  expect(evaluation.questions.length).toBeGreaterThanOrEqual(1);
  expect(evaluation.questions.length).toBeLessThanOrEqual(3);
  const [question] = evaluation.questions;
  expect(question!.semantic_item_ids).toEqual(["subject"]);
  expect(CLARIFICATION_RULES).toContain(question!.policy_rule_id);
  expect(question!.policy_rule_id).toBe(evaluation.triggered_rule_ids[0]);

  const answered = submitClarificationAnswers(state, { answers: [{ question_id: question!.question_id, value: answerValue(collection) }], assumption_decisions: [], intent_version: 1 });
  const after = evaluateClarificationPolicy(answered);
  expect(after.decision).toBe("READY");
  expect(after.questions).toEqual([]);
}

function expectDecisionShape(state: TrustedIntentState, evaluation: ClarificationPolicyEvaluation, sweep: SweepCase): void {
  const target = state.envelope[sweep.collection][0]!;
  if (evaluation.decision === "NEEDS_CLARIFICATION") {
    expectNeedsClarificationIsActionable(state, evaluation, sweep.collection);
    return;
  }
  expect(evaluation.questions).toEqual([]);
  expect(evaluation.triggered_rule_ids.some((ruleId) => CLARIFICATION_RULES.includes(ruleId))).toBe(false);
  if (evaluation.decision === "READY_WITH_VISIBLE_ASSUMPTIONS") {
    expect(evaluation.triggered_rule_ids).toEqual(["F01-POL-CP-004"]);
    expect(evaluation.visible_assumptions.map((entry) => entry.assumption_id)).toEqual(["subject"]);
    return;
  }
  expect(target.materiality === "COSMETIC" || target.resolution_state === "CONFIRMED").toBe(true);
}

describe("F01 policy totality sweep", () => {
  test("every valid single-item Envelope yields one authorized outcome or a fail-closed F01-ERR-014", () => {
    let validStates = 0;
    const invariantReasons = new Set<string>();
    for (const sweep of sweepCases()) {
      const state = restoreIfValid(sweep);
      if (state === null) continue;
      validStates += 1;
      const outcome = evaluateOrInvariant(state);
      if (typeof outcome === "string") {
        invariantReasons.add(outcome);
        continue;
      }
      expectDecisionShape(state, outcome, sweep);
    }
    expect(validStates).toBeGreaterThan(100);
    for (const reason of invariantReasons) expect(KNOWN_INVARIANT_REASONS).toContain(reason);
  });
});
