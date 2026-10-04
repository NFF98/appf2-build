import { describe, expect, test } from "vitest";

import { submitClarificationAnswers } from "../../src/platform/intent/answer-merge.js";
import { evaluateClarificationPolicy } from "../../src/platform/intent/clarification-policy.js";
import { collectEnvelopeViolations } from "../../src/platform/intent/envelope-validation.js";
import { POLICY_RISK_FLAGS, type PolicyItemCollection, type PolicyVisibleItem } from "../../src/platform/intent/intent-contract.js";
import { startIntentClarification } from "../../src/platform/intent/intent-state.js";
import { matchItem } from "../../src/platform/intent/policy-rules.js";
import { compareCandidates, questionIdFor, type QuestionCandidate } from "../../src/platform/intent/question-projection.js";
import {
  NFF_POLICY_REF,
  analysis,
  choiceAmbiguity,
  expectIntentError,
  item,
  knownInput,
  llmProposal,
  nffDefault,
  persistedState,
  requiredMissing,
  unresolved,
  userExplicit
} from "./intent-envelope-fixtures.js";

const untrustedReasons = (input: unknown) =>
  collectEnvelopeViolations(input, "UNTRUSTED_ANALYSIS").map((violation) => violation.reason);

function riskSubjects(flag: (typeof POLICY_RISK_FLAGS)[number]): PolicyVisibleItem[] {
  const flags = [flag];
  return [
    item(`domain_${flag}`, { policy_risk_flags: flags }),
    nffDefault(`nff_${flag}`, "card", { policy_risk_flags: flags }),
    llmProposal(`llm_${flag}`, "card", { policy_risk_flags: flags }),
    unresolved(`unconfirmed_${flag}`, { policy_risk_flags: flags })
  ];
}

test("TEST-F01-CP-003 money / permission / external-cost / irreversible truth requires USER_EXPLICIT clarification", () => {
  for (const flag of POLICY_RISK_FLAGS) {
    const subjects = riskSubjects(flag);
    const evaluation = evaluateClarificationPolicy(startIntentClarification(analysis({ candidate_rules: subjects })));
    expect(evaluation.decision).toBe("NEEDS_CLARIFICATION");
    expect(evaluation.triggered_rule_ids[0]).toBe("F01-POL-CP-003");
    expect(evaluation.questions).toHaveLength(3);
    expect(evaluation.questions.every((question) => question.policy_rule_id === "F01-POL-CP-003")).toBe(true);
    for (const subject of subjects) {
      expect(matchItem({ collection: "candidate_rules", item: subject })?.owner_rule_id).toBe("F01-POL-CP-003");
    }
  }

  const acceptedRisk = persistedState({
    constraints: [
      item("accepted_charge", { source: "USER_ACCEPTED_PROPOSAL", resolved_value: "card", policy_risk_flags: ["MONEY"] }),
      item("accepted_permission", { source: "NFF_DEFAULT", source_ref: { ...NFF_POLICY_REF }, resolved_value: "allow", policy_risk_flags: ["PERMISSION"] })
    ]
  });
  const acceptedEvaluation = evaluateClarificationPolicy(acceptedRisk);
  expect(acceptedEvaluation.decision).toBe("NEEDS_CLARIFICATION");
  expect(acceptedEvaluation.questions.map((question) => question.policy_rule_id)).toEqual(["F01-POL-CP-003", "F01-POL-CP-003"]);

  const explicit = startIntentClarification(
    analysis({ constraints: [userExplicit("pay_cap", 3000, { expected_value_type: "NUMBER", question_type: "NUMBER", policy_risk_flags: ["MONEY", "EXTERNAL_COST"] })] })
  );
  expect(evaluateClarificationPolicy(explicit).decision).toBe("READY");

  const riskyMissing = requiredMissing("deposit", {
    source: "NFF_DEFAULT",
    source_ref: { ...NFF_POLICY_REF },
    resolution_state: "PROPOSED",
    policy_risk_flags: ["MONEY"],
    can_default: true,
    proposed_default: 100
  });
  expect(matchItem({ collection: "missing_fields", item: riskyMissing })?.matched_rule_ids).toEqual(["F01-POL-CP-003"]);

  const state = startIntentClarification(analysis({ candidate_rules: [llmProposal("tip_rate", "10%", { policy_risk_flags: ["MONEY"] })] }));
  const [question] = evaluateClarificationPolicy(state).questions;
  expect(question?.policy_rule_id).toBe("F01-POL-CP-003");
  for (const decision of [
    { assumption_id: "tip_rate", decision: "ACCEPT" },
    { assumption_id: "tip_rate", decision: "EDIT", edited_value: "12%" }
  ]) {
    expectIntentError(
      () => submitClarificationAnswers(state, { answers: [], assumption_decisions: [decision], intent_version: 1 }),
      "F01-ERR-003",
      "RISK_ITEM_REQUIRES_CLARIFICATION_ANSWER"
    );
  }
  const answered = submitClarificationAnswers(state, { answers: [{ question_id: question!.question_id, value: "12%" }], assumption_decisions: [], intent_version: 1 });
  expect(answered.envelope.candidate_rules[0]).toMatchObject({ source: "USER_EXPLICIT", resolution_state: "CONFIRMED", resolved_value: "12%", can_default: false });
  expect(answered.envelope.candidate_rules[0]).not.toHaveProperty("proposed_default");
  expect(evaluateClarificationPolicy(answered).decision).toBe("READY");
});

describe("F01-DATA-001 Envelope invariants are enforced before policy", () => {
  test("rejects shape, provenance, default and choice violations as F01-ERR-002", () => {
    expect(untrustedReasons(analysis({ constraints: [item("a", { question_type: "NUMBER" })] }))).toContain("QUESTION_VALUE_TYPE_MISMATCH");
    expect(untrustedReasons(analysis({ constraints: [nffDefault("a", "x", { source_ref: undefined })] }))).toContain(
      "NFF_DEFAULT_POLICY_PROVENANCE_REQUIRED"
    );
    expect(untrustedReasons(analysis({ ambiguities: [choiceAmbiguity("a", ["same", "same"])] }))).toContain(
      "AT_LEAST_TWO_DISTINCT_ALTERNATIVES_REQUIRED"
    );
    expect(untrustedReasons(analysis({ ambiguities: [unresolved("a", { alternatives: ["x"] })] }))).toContain(
      "AT_LEAST_TWO_DISTINCT_ALTERNATIVES_REQUIRED"
    );
    expect(untrustedReasons(analysis({ constraints: [item("a", { materiality: "COSMETIC", required_for_execution: true })] }))).toContain(
      "COSMETIC_CANNOT_BE_REQUIRED"
    );
    expect(untrustedReasons(analysis({ constraints: [item("a", { materiality: "COSMETIC", policy_risk_flags: ["MONEY"] })] }))).toContain(
      "RISK_ITEM_MUST_BE_MATERIAL"
    );
  });

  test("resolution_state / resolved_value / proposed_default / can_default / source invariant", () => {
    const cases: readonly [PolicyVisibleItem, string][] = [
      [item("a", { resolved_value: undefined }), "CONFIRMED_REQUIRES_RESOLVED_VALUE"],
      [item("a", { proposed_default: "x" }), "PROPOSED_DEFAULT_ONLY_FOR_PROPOSED"],
      [item("a", { can_default: true, proposed_default: "x" }), "CAN_DEFAULT_ONLY_FOR_PROPOSED"],
      [item("a", { resolved_value: 7 }), "RESOLVED_VALUE_SHAPE_MISMATCH"],
      [choiceAmbiguity("a", ["x", "y"], { resolution_state: "CONFIRMED", resolved_value: "z" }), "RESOLVED_VALUE_SHAPE_MISMATCH"],
      [unresolved("a", { resolved_value: "x" }), "RESOLVED_VALUE_ONLY_FOR_CONFIRMED"],
      [unresolved("a", { proposed_default: "x" }), "PROPOSED_DEFAULT_ONLY_FOR_PROPOSED"],
      [unresolved("a", { can_default: true }), "SAFE_DEFAULT_VALUE_REQUIRED"],
      [llmProposal("a", "x", { proposed_default: undefined, can_default: false }), "PROPOSED_REQUIRES_PROPOSED_DEFAULT"],
      [llmProposal("a", "x", { resolved_value: "x" }), "RESOLVED_VALUE_ONLY_FOR_CONFIRMED"],
      [choiceAmbiguity("a", ["x", "y"], { source: "LLM_PROPOSED", resolution_state: "PROPOSED", proposed_default: "z" }), "DEFAULT_VALUE_SHAPE_MISMATCH"],
      [item("a", { resolution_state: "PROPOSED", resolved_value: undefined, proposed_default: "x" }), "PROPOSED_SOURCE_NOT_ALLOWED"],
      [userExplicit("a", "x", { resolution_state: "UNRESOLVED", resolved_value: undefined }), "USER_SOURCE_MUST_BE_CONFIRMED"]
    ];
    for (const [subject, reason] of cases) {
      expect(untrustedReasons(analysis({ constraints: [subject] }))).toContain(reason);
      expectIntentError(() => startIntentClarification(analysis({ constraints: [subject] })), "F01-ERR-002", reason);
      expectIntentError(() => persistedState({ constraints: [subject] }), "F01-ERR-014", reason);
    }
  });

  test("dependency graph must be same-Envelope, self-free, unique-ID and acyclic", () => {
    expect(untrustedReasons(analysis({ constraints: [item("a", { depends_on_ids: ["a"] })] }))).toContain("SELF_DEPENDENCY");
    expect(untrustedReasons(analysis({ constraints: [item("a", { depends_on_ids: ["ghost"] })] }))).toContain("UNKNOWN_DEPENDENCY");
    expect(
      untrustedReasons(analysis({ constraints: [item("a", { depends_on_ids: ["b"] }), item("b", { depends_on_ids: ["c"] }), item("c", { depends_on_ids: ["a"] })] }))
    ).toEqual(["DEPENDENCY_CYCLE", "DEPENDENCY_CYCLE", "DEPENDENCY_CYCLE"]);
    expect(untrustedReasons(analysis({ known_inputs: [knownInput("a", 1)], constraints: [item("a")] }))).toContain("DUPLICATE_SEMANTIC_ID");
    expect(untrustedReasons(analysis({ known_inputs: [knownInput("k", 1)], constraints: [item("a", { depends_on_ids: ["k"] })] }))).toEqual([]);
  });

  test("Prompt A cannot assert User decisions, executable values or unknown fields", () => {
    expect(untrustedReasons(analysis({ constraints: [item("a", { source: "USER_ACCEPTED_PROPOSAL" })] }))).toContain(
      "USER_DECISION_NOT_ASSERTABLE_BY_ANALYSIS"
    );
    expect(untrustedReasons(analysis({ constraints: [item("a", { source: "NFF_DEFAULT", source_ref: { ...NFF_POLICY_REF } })] }))).toContain(
      "PROPOSAL_MUST_BE_PROPOSED_BEFORE_USER_DECISION"
    );
    expect(untrustedReasons(analysis({ constraints: [llmProposal("a", "x", { resolution_state: "UNRESOLVED", proposed_default: undefined, can_default: false })] }))).toContain(
      "PROPOSAL_MUST_BE_PROPOSED_BEFORE_USER_DECISION"
    );
    expect(untrustedReasons(analysis({ constraints: [userExplicit("a", "from raw input")] }))).toEqual([]);
    expect(untrustedReasons({ ...analysis(), goal: () => "run" })).toEqual(["NON_JSON_VALUE"]);
    expect(untrustedReasons({ ...analysis(), constraints: [{ ...item("a"), policy_outcome: "READY" }] })).toContain("UNKNOWN_FIELD");
    expectIntentError(() => startIntentClarification({ ...analysis(), decision: "READY" }), "F01-ERR-002", "UNKNOWN_FIELD");
  });
});

describe("F01 §6 precedence", () => {
  test("each rule owns exactly its locked machine condition", () => {
    const owner = (collection: PolicyItemCollection, subject: PolicyVisibleItem) => matchItem({ collection, item: subject })?.owner_rule_id;
    expect(owner("missing_fields", requiredMissing("m"))).toBe("F01-POL-CP-001");
    expect(owner("missing_fields", requiredMissing("m", { source: "LLM_PROPOSED", resolution_state: "PROPOSED", can_default: true, proposed_default: 4 }))).toBe(
      "F01-POL-CP-004"
    );
    expect(owner("ambiguities", choiceAmbiguity("a", ["x", "y"], { impact_level: "CRITICAL" }))).toBe("F01-POL-CP-002");
    expect(owner("ambiguities", choiceAmbiguity("a", ["x", "y"], { impact_level: "MEDIUM" }))).toBe("F01-POL-CP-003A");
    expect(owner("ambiguities", choiceAmbiguity("a", ["x", "y"], { materiality: "COSMETIC", impact_level: "CRITICAL" }))).toBe("F01-POL-CP-005");
    expect(owner("constraints", unresolved("c"))).toBe("F01-POL-CP-003A");
    expect(owner("constraints", llmProposal("c", "x", { can_default: false }))).toBe("F01-POL-CP-003A");
    expect(owner("assumptions", nffDefault("d", "x"))).toBe("F01-POL-CP-004");
    expect(owner("assumptions", unresolved("p", { materiality: "COSMETIC" }))).toBe("F01-POL-CP-005");
    expect(owner("constraints", item("f"))).toBe("F01-POL-CP-006");
  });

  test("multiple clarification rules on one item: highest precedence supplies policy_rule_id", () => {
    const subject = choiceAmbiguity("a", ["x", "y"], { policy_risk_flags: ["IRREVERSIBLE"] });
    const evaluation = evaluateClarificationPolicy(startIntentClarification(analysis({ ambiguities: [subject] })));
    expect(evaluation.triggered_rule_ids).toEqual(["F01-POL-CP-003", "F01-POL-CP-002"]);
    expect(evaluation.questions.map((question) => question.policy_rule_id)).toEqual(["F01-POL-CP-003"]);
    expect(evaluation.questions[0]!.question_id).toBe(questionIdFor("F01-POL-CP-003", ["a"]));
  });
});

describe("F01-DATA-003 question projection", () => {
  test("type, expected type, options, rationale and identity come only from the target contract", () => {
    const state = startIntentClarification(
      analysis({
        ambiguities: [choiceAmbiguity("split", ["even", "by_item"], { description: "How should the bill be split?" })],
        missing_fields: [requiredMissing("headcount")]
      })
    );
    const [first, second] = evaluateClarificationPolicy(state).questions;
    expect(first).toEqual({
      question_id: questionIdFor("F01-POL-CP-001", ["headcount"]),
      semantic_item_ids: ["headcount"],
      question_type: "NUMBER",
      prompt: "Decide headcount",
      expected_value_type: "NUMBER",
      required: true,
      rationale_key: "intent.clarification.rationale.cp_001",
      policy_rule_id: "F01-POL-CP-001"
    });
    expect(second).toMatchObject({ question_type: "SINGLE_CHOICE", expected_value_type: "ENUM", options: ["even", "by_item"], policy_rule_id: "F01-POL-CP-002" });
    expect(questionIdFor("F01-POL-CP-001", ["b", "a"])).toBe(questionIdFor("F01-POL-CP-001", ["a", "b"]));
    expect(questionIdFor("F01-POL-CP-001", ["a"])).not.toBe(questionIdFor("F01-POL-CP-003A", ["a"]));
    expect(first!.question_id).toMatch(/^q_[0-9a-f]{64}$/);
  });

  test("ranking is the locked lexicographic order with semantic ID as final tie-break", () => {
    const candidate = (subject: PolicyVisibleItem, downstream = 0, alreadyAsked = false): QuestionCandidate => {
      const match = matchItem({ collection: "constraints", item: subject })!;
      return { match, question_id: questionIdFor(match.owner_rule_id, [subject.id]), already_asked: alreadyAsked, downstream_unknowns_resolved: downstream };
    };
    const ordered = [
      candidate(unresolved("z_risk", { impact_level: "LOW", policy_risk_flags: ["PERMISSION"] })),
      candidate(unresolved("y_required", { impact_level: "CRITICAL", required_for_execution: true })),
      candidate(unresolved("a_core_critical", { impact_level: "CRITICAL" })),
      candidate(unresolved("b_core_high_many", { impact_level: "HIGH" }), 2),
      candidate(unresolved("c_core_high_few", { impact_level: "HIGH" }), 1),
      candidate(unresolved("d_core_high_few_asked", { impact_level: "HIGH" }), 1, true),
      candidate(unresolved("e_tie", { impact_level: "LOW" })),
      candidate(unresolved("f_tie", { impact_level: "LOW" }))
    ];
    const shuffled = [ordered[5]!, ordered[7]!, ordered[0]!, ordered[3]!, ordered[6]!, ordered[1]!, ordered[4]!, ordered[2]!];
    expect([...shuffled].sort(compareCandidates).map((entry) => entry.match.item.id)).toEqual(ordered.map((entry) => entry.match.item.id));
  });
});
