import { describe, expect, test } from "vitest";

import { mergeReanalysis } from "../../src/platform/intent/analysis-merge.js";
import { submitClarificationAnswers } from "../../src/platform/intent/answer-merge.js";
import { evaluateClarificationPolicy } from "../../src/platform/intent/clarification-policy.js";
import { F01_CLARIFICATION_POLICY_VERSION } from "../../src/platform/intent/intent-contract.js";
import { restoreTrustedIntentState, startIntentClarification, type TrustedIntentState } from "../../src/platform/intent/intent-state.js";
import { questionIdFor } from "../../src/platform/intent/question-projection.js";
import { admitResolvedIntent, isResolvedIntentAdmission, parseCompileRequest } from "../../src/platform/intent/resolved-intent-gate.js";
import {
  analysis,
  choiceAmbiguity,
  expectIntentError,
  item,
  knownInput,
  llmProposal,
  nffDefault,
  persistedState,
  requiredMissing,
  type EnvelopeParts
} from "../contract/intent-envelope-fixtures.js";

function answer(state: TrustedIntentState, values: Readonly<Record<string, unknown>>, decisions: readonly unknown[] = []) {
  const questions = evaluateClarificationPolicy(state).questions;
  const answers = Object.entries(values).map(([itemId, value]) => ({
    question_id: questions.find((question) => question.semantic_item_ids[0] === itemId)!.question_id,
    value
  }));
  return submitClarificationAnswers(state, { answers, assumption_decisions: decisions, intent_version: 1 });
}

const dinnerParts = (): EnvelopeParts => ({
  known_inputs: [knownInput("budget", 5000), knownInput("event_type", "dinner")],
  constraints: [item("budget_cap", { source: "USER_EXPLICIT", policy_risk_flags: ["MONEY"], depends_on_ids: ["budget"] })],
  missing_fields: [requiredMissing("headcount", { depends_on_ids: ["event_type"] })],
  ambiguities: [choiceAmbiguity("split_rule", ["even", "by_item"], { depends_on_ids: ["headcount"] })]
});

test("TEST-F01-001 User fact is never overwritten by an LLM proposal", () => {
  const answered = answer(startIntentClarification(analysis(dinnerParts())), { headcount: 12, split_rule: "by_item" });
  expect(answered.user_explicit_values).toEqual({ headcount: 12, split_rule: "by_item" });

  const llmOverride = analysis({
    known_inputs: [knownInput("budget", 8000, { source: "LLM_PROPOSED" }), knownInput("event_type", "dinner")],
    constraints: [llmProposal("budget_cap", "8000", { policy_risk_flags: ["MONEY"], depends_on_ids: ["budget"] })],
    missing_fields: [requiredMissing("headcount", { source: "LLM_PROPOSED", resolution_state: "PROPOSED", can_default: true, proposed_default: 10 })],
    ambiguities: [choiceAmbiguity("split_rule", ["even", "by_item"], { source: "LLM_PROPOSED", resolution_state: "PROPOSED", can_default: true, proposed_default: "even" })],
    assumptions: [llmProposal("theme", "red", { materiality: "COSMETIC" })]
  });
  const merged = mergeReanalysis(answered, llmOverride);
  expect(merged.envelope.known_inputs.find((input) => input.id === "budget")).toMatchObject({ value: 5000, source: "USER_EXPLICIT" });
  expect(merged.envelope.constraints[0]).toMatchObject({ id: "budget_cap", source: "USER_EXPLICIT", resolution_state: "CONFIRMED" });
  expect(merged.envelope.missing_fields[0]).toMatchObject({ id: "headcount", source: "USER_EXPLICIT", resolution_state: "CONFIRMED" });
  expect(merged.envelope.missing_fields[0]).not.toHaveProperty("proposed_default");
  expect(merged.user_explicit_values).toEqual({ headcount: 12, split_rule: "by_item" });
  expect(merged.envelope.analysis_metadata.clarification_policy_state.changed_semantic_item_ids).toEqual(["theme"]);

  const evaluation = evaluateClarificationPolicy(merged);
  expect(evaluation.decision).toBe("READY");
  expect(evaluation.visible_assumptions.find((entry) => entry.assumption_id === "headcount")).toBeUndefined();

  const proposalConflict = startIntentClarification(analysis({ constraints: [llmProposal("venue", "hotel", { can_default: false })] }));
  const resolved = answer(proposalConflict, { venue: "rooftop" });
  expect(resolved.envelope.constraints[0]).toMatchObject({ source: "USER_EXPLICIT", resolution_state: "CONFIRMED", can_default: false });
  expect(resolved.envelope.constraints[0]).not.toHaveProperty("proposed_default");
  expect(resolved.user_explicit_values.venue).toBe("rooftop");
});

test("TEST-F01-004 material proposals and defaults are always visible and need an explicit User decision", () => {
  const state = startIntentClarification(
    analysis({
      assumptions: [
        llmProposal("rounding", "nearest_10", { user_visible: false, source_ref: { origin_item_id: "rule_42" } }),
        nffDefault("currency", "TWD", { user_visible: false }),
        llmProposal("theme", "red", { materiality: "COSMETIC", user_visible: false })
      ]
    })
  );
  const evaluation = evaluateClarificationPolicy(state);
  expect(evaluation.decision).toBe("READY_WITH_VISIBLE_ASSUMPTIONS");
  expect(evaluation.triggered_rule_ids).toEqual(["F01-POL-CP-004", "F01-POL-CP-005"]);
  expect(evaluation.visible_assumptions).toEqual([
    expect.objectContaining({ assumption_id: "currency", classification: "DEFAULT", proposed_value: "TWD", source: "NFF_DEFAULT" }),
    expect.objectContaining({ assumption_id: "rounding", classification: "PROPOSAL", proposed_value: "nearest_10", source: "LLM_PROPOSED" })
  ]);
  expect(admitResolvedIntent(state)).toMatchObject({ admitted: false, reason: "MATERIAL_ASSUMPTIONS_PENDING" });

  const decided = submitClarificationAnswers(state, {
    answers: [],
    assumption_decisions: [
      { assumption_id: "rounding", decision: "ACCEPT", edited_value: null },
      { assumption_id: "currency", decision: "EDIT", edited_value: "JPY" }
    ],
    intent_version: 1
  });
  expect(decided.envelope.assumptions[0]).toMatchObject({ source: "USER_ACCEPTED_PROPOSAL", source_ref: { origin_item_id: "rule_42" }, resolution_state: "CONFIRMED" });
  expect(decided.envelope.assumptions[1]).toMatchObject({ source: "USER_EXPLICIT", resolution_state: "CONFIRMED" });
  expect(decided.user_explicit_values).toEqual({ currency: "JPY" });
  const after = evaluateClarificationPolicy(decided);
  expect(after.decision).toBe("READY");
  expect(after.visible_assumptions.find((entry) => entry.assumption_id === "rounding")).toBeUndefined();
  expect(admitResolvedIntent(decided)).toMatchObject({ admitted: true, decision: "READY", unresolved_non_material_item_ids: ["theme"] });

  const rejected = submitClarificationAnswers(state, { answers: [], assumption_decisions: [{ assumption_id: "rounding", decision: "REJECT" }], intent_version: 1 });
  expect(rejected.envelope.assumptions[0]).toMatchObject({ resolution_state: "UNRESOLVED", can_default: false });
  const afterReject = evaluateClarificationPolicy(rejected);
  expect(afterReject.decision).toBe("NEEDS_CLARIFICATION");
  expect(afterReject.questions.map((question) => [question.semantic_item_ids[0], question.policy_rule_id])).toEqual([["rounding", "F01-POL-CP-003A"]]);
  expect(afterReject.visible_assumptions).toContainEqual(expect.objectContaining({ assumption_id: "currency", classification: "DEFAULT" }));
  expectIntentError(
    () => submitClarificationAnswers(rejected, { answers: [], assumption_decisions: [{ assumption_id: "rounding", decision: "ACCEPT" }], intent_version: 1 }),
    "F01-ERR-003",
    "ASSUMPTION_NOT_DECIDABLE"
  );
});

describe("F01-AC-005 no repeated clarification", () => {
  test("TEST-F01-005 answered question is not re-asked unless a relevant upstream semantic dependency changed", () => {
    const inferredDinner = (eventType: string): EnvelopeParts => ({
      ...dinnerParts(),
      known_inputs: [knownInput("budget", 5000), knownInput("event_type", eventType, { source: "DOMAIN_KNOWN" })]
    });
    const start = startIntentClarification(analysis(inferredDinner("dinner")));
    const first = evaluateClarificationPolicy(start);
    const headcountQuestion = questionIdFor("F01-POL-CP-001", ["headcount"]);
    expect(first.questions.map((question) => question.question_id)).toEqual([headcountQuestion, questionIdFor("F01-POL-CP-002", ["split_rule"])]);

    const afterHeadcount = answer(start, { headcount: 12 });
    const policyState = afterHeadcount.envelope.analysis_metadata.clarification_policy_state;
    expect(policyState.answered_question_ids).toEqual([headcountQuestion]);
    expect(policyState.changed_semantic_item_ids).toEqual(["headcount"]);
    expect(evaluateClarificationPolicy(afterHeadcount).questions.map((question) => question.semantic_item_ids[0])).toEqual(["split_rule"]);

    const upstreamChanged = mergeReanalysis(afterHeadcount, analysis(inferredDinner("lunch")));
    expect(upstreamChanged.envelope.analysis_metadata.clarification_policy_state.changed_semantic_item_ids).toEqual(["event_type"]);
    expect(evaluateClarificationPolicy(upstreamChanged).questions.map((question) => question.semantic_item_ids[0])).toEqual(["split_rule"]);
    expectIntentError(
      () => submitClarificationAnswers(afterHeadcount, { answers: [{ question_id: headcountQuestion, value: 13 }], assumption_decisions: [], intent_version: 2 }),
      "F01-ERR-003",
      "QUESTION_NOT_ELIGIBLE"
    );

    const reopenParts: EnvelopeParts = {
      known_inputs: [knownInput("event_type", "dinner")],
      missing_fields: [requiredMissing("headcount", { depends_on_ids: ["event_type"] })]
    };
    const reopened = evaluateClarificationPolicy(persistedState(reopenParts, { answered_question_ids: [headcountQuestion], changed_semantic_item_ids: ["event_type"] }));
    expect(reopened.decision).toBe("NEEDS_CLARIFICATION");
    expect(reopened.questions.map((question) => question.question_id)).toEqual([headcountQuestion]);
    const unrelated = persistedState({ ...reopenParts, constraints: [item("theme")] }, { answered_question_ids: [headcountQuestion], changed_semantic_item_ids: ["theme"] });
    expectIntentError(() => evaluateClarificationPolicy(unrelated), "F01-ERR-014", "SUPPRESSED_BLOCKER_UNRESOLVED");

    expectIntentError(
      () => submitClarificationAnswers(start, { answers: [], assumption_decisions: [], intent_version: 1, answered_question_ids: [headcountQuestion] }),
      "F01-ERR-001",
      "SERVER_OWNED_FIELD"
    );
    expectIntentError(
      () => submitClarificationAnswers(start, { answers: [], assumption_decisions: [], intent_version: 1, changed_semantic_item_ids: ["event_type"] }),
      "F01-ERR-001",
      "SERVER_OWNED_FIELD"
    );
  });
});

describe("F01-AC-006 deterministic policy", () => {
  test("TEST-F01-006 same Envelope + policy version yields the same decision, questions and assumptions", () => {
    const parts: EnvelopeParts = {
      known_inputs: [knownInput("event_type", "dinner")],
      constraints: [item("deposit", { resolution_state: "UNRESOLVED", impact_level: "LOW", policy_risk_flags: ["EXTERNAL_COST"] }), item("venue", { resolution_state: "UNRESOLVED", impact_level: "HIGH" })],
      missing_fields: [requiredMissing("headcount", { depends_on_ids: ["event_type"] }), requiredMissing("bill_total", { impact_level: "CRITICAL" })],
      ambiguities: [choiceAmbiguity("split_rule", ["even", "by_item"], { depends_on_ids: ["headcount"] })],
      assumptions: [llmProposal("rounding", "nearest_10")]
    };
    const state = startIntentClarification(analysis(parts));
    const baseline = evaluateClarificationPolicy(state);
    expect(baseline.policy_version).toBe(F01_CLARIFICATION_POLICY_VERSION);
    expect(evaluateClarificationPolicy(state)).toEqual(baseline);
    expect(evaluateClarificationPolicy(startIntentClarification(analysis(parts)))).toEqual(baseline);
    expect(baseline.questions.map((question) => question.semantic_item_ids[0])).toEqual(["deposit", "bill_total", "headcount"]);

    const reversed = Object.fromEntries(Object.entries(parts).map(([key, list]) => [key, [...(list as readonly unknown[])].reverse()])) as EnvelopeParts;
    expect(evaluateClarificationPolicy(startIntentClarification(analysis(reversed)))).toEqual(baseline);
    const reworded = { ...parts, missing_fields: parts.missing_fields!.map((entry) => ({ ...entry, description: `Please tell us ${entry.id}` })) };
    const rewordedEvaluation = evaluateClarificationPolicy(startIntentClarification(analysis(reworded)));
    expect(rewordedEvaluation.questions.map((question) => question.question_id)).toEqual(baseline.questions.map((question) => question.question_id));

    const restored = restoreTrustedIntentState(JSON.parse(JSON.stringify(state)) as { envelope: unknown; user_explicit_values: unknown });
    expect(evaluateClarificationPolicy(restored)).toEqual(baseline);
    expect(Object.isFrozen(baseline.questions[0])).toBe(true);
  });
});

test("TEST-F01-SEC-007 Client and LLM cannot bypass server-owned clarification state or the resolved_intent gate", () => {
  for (const field of ["resolved_intent", "decision", "clarification_policy_state", "answered_question_ids"]) {
    expectIntentError(() => parseCompileRequest({ intent_version: 1, [field]: { decision: "READY" } }), "F01-ERR-001", "SERVER_OWNED_FIELD");
  }
  expect(parseCompileRequest({ intent_version: 4, source_blueprint_hash: null, client_context: { locale: "zh-TW" } })).toEqual({
    intent_version: 4,
    source_blueprint_hash: null,
    client_context: { locale: "zh-TW" }
  });

  const blocked = startIntentClarification(analysis({ missing_fields: [requiredMissing("bill_total")] }));
  expectIntentError(
    () => submitClarificationAnswers(blocked, { answers: [], assumption_decisions: [], intent_version: 1, resolved_intent: { goal: "x" } }),
    "F01-ERR-001",
    "SERVER_OWNED_FIELD"
  );
  const llmState = { ...analysis(), analysis_metadata: { clarification_policy_state: { policy_version: F01_CLARIFICATION_POLICY_VERSION, answered_question_ids: ["q_x"], changed_semantic_item_ids: [] } } };
  expectIntentError(() => startIntentClarification(llmState), "F01-ERR-002", "SERVER_OWNED_POLICY_STATE");
  expectIntentError(() => startIntentClarification({ ...analysis(), resolved_intent: { goal: "x" } }), "F01-ERR-002", "UNKNOWN_FIELD");
  expectIntentError(() => mergeReanalysis(blocked, llmState), "F01-ERR-002", "SERVER_OWNED_POLICY_STATE");

  const rejection = admitResolvedIntent(blocked);
  expect(rejection).toMatchObject({ admitted: false, decision: "NEEDS_CLARIFICATION", reason: "CLARIFICATION_REQUIRED" });
  expect(isResolvedIntentAdmission(rejection)).toBe(false);

  const forgedState = JSON.parse(JSON.stringify(blocked)) as TrustedIntentState;
  expectIntentError(() => admitResolvedIntent(forgedState), "F01-ERR-014", "UNTRUSTED_CLARIFICATION_STATE");
  expectIntentError(() => evaluateClarificationPolicy({ ...blocked }), "F01-ERR-014", "UNTRUSTED_CLARIFICATION_STATE");

  const ready = answer(blocked, { bill_total: 12500 });
  const admission = admitResolvedIntent(ready);
  expect(admission).toMatchObject({ admitted: true, decision: "READY", policy_version: F01_CLARIFICATION_POLICY_VERSION });
  expect(isResolvedIntentAdmission(admission)).toBe(true);
  expect(Object.isFrozen(admission)).toBe(true);
  expect(isResolvedIntentAdmission({ ...admission })).toBe(false);
  expect(isResolvedIntentAdmission({ admitted: true, decision: "READY", state: ready })).toBe(false);
});
