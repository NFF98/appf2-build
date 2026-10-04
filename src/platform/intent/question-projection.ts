import { createHash } from "node:crypto";

import { QUESTION_VALUE_TYPE, internalInvariant, type ImpactLevel, type QuestionType, type ValueType } from "./intent-contract.js";
import { canonicalJson, type JsonValue } from "./json-value.js";
import type { ItemPolicyMatch, PolicyRuleId } from "./policy-rules.js";
import { distinctCanonicalCount, isChoiceQuestion } from "./value-shape.js";

/** F01-RQ-002: at most three questions per clarification round. */
export const MAX_QUESTIONS_PER_ROUND = 3;

export type ClarificationQuestion = {
  readonly question_id: string;
  readonly semantic_item_ids: readonly [string];
  readonly question_type: QuestionType;
  readonly prompt: string;
  readonly options?: readonly JsonValue[];
  readonly expected_value_type: ValueType;
  readonly required: true;
  readonly rationale_key: string;
  readonly policy_rule_id: PolicyRuleId;
};

export type QuestionCandidate = {
  readonly match: ItemPolicyMatch;
  readonly question_id: string;
  readonly already_asked: boolean;
  readonly downstream_unknowns_resolved: number;
};

/** Stable presentation mapping key per policy_rule_id; F00 may humanize copy but not change identity. */
const RATIONALE_KEYS: Readonly<Record<PolicyRuleId, string>> = Object.freeze({
  "F01-POL-CP-003": "intent.clarification.rationale.cp_003",
  "F01-POL-CP-001": "intent.clarification.rationale.cp_001",
  "F01-POL-CP-002": "intent.clarification.rationale.cp_002",
  "F01-POL-CP-003A": "intent.clarification.rationale.cp_003a",
  "F01-POL-CP-004": "intent.clarification.rationale.cp_004",
  "F01-POL-CP-005": "intent.clarification.rationale.cp_005",
  "F01-POL-CP-006": "intent.clarification.rationale.cp_006"
});

const IMPACT_RANK: Readonly<Record<ImpactLevel, number>> = Object.freeze({ CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 });

/**
 * F01-RQ-002 tiers: Safety / Money / Permission > Execution Blocker > High Outcome Divergence >
 * Core Business Rule > Secondary Preference > Cosmetic. Materiality is binary, so every non-COSMETIC
 * item is MATERIAL and the Secondary Preference tier has no reachable member.
 */
const PolicyPriority = Object.freeze({
  SafetyMoneyPermission: 0,
  ExecutionBlocker: 1,
  HighOutcomeDivergence: 2,
  CoreBusinessRule: 3,
  Cosmetic: 5
});
type PolicyPriority = (typeof PolicyPriority)[keyof typeof PolicyPriority];

/** Deterministic identity of policy_rule_id + sorted(semantic_item_ids); prompt wording never participates. */
export function questionIdFor(policyRuleId: PolicyRuleId, semanticItemIds: readonly string[]): string {
  const tuple = canonicalJson([policyRuleId, [...semanticItemIds].sort()]);
  return `q_${createHash("sha256").update(tuple, "utf8").digest("hex")}`;
}

function policyPriority({ item, matched_rule_ids }: ItemPolicyMatch): PolicyPriority {
  if (item.policy_risk_flags.length > 0) return PolicyPriority.SafetyMoneyPermission;
  if (item.required_for_execution) return PolicyPriority.ExecutionBlocker;
  if (matched_rule_ids.includes("F01-POL-CP-002")) return PolicyPriority.HighOutcomeDivergence;
  return item.materiality === "MATERIAL" ? PolicyPriority.CoreBusinessRule : PolicyPriority.Cosmetic;
}

function compareIds(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Lexicographic F01-RQ-002 comparison; the stable semantic item ID is the only final tie-break. */
export function compareCandidates(left: QuestionCandidate, right: QuestionCandidate): number {
  return (
    policyPriority(left.match) - policyPriority(right.match) ||
    IMPACT_RANK[left.match.item.impact_level] - IMPACT_RANK[right.match.item.impact_level] ||
    Number(right.match.item.required_for_execution) - Number(left.match.item.required_for_execution) ||
    right.downstream_unknowns_resolved - left.downstream_unknowns_resolved ||
    Number(left.already_asked) - Number(right.already_asked) ||
    compareIds(left.match.item.id, right.match.item.id)
  );
}

/** F01-DATA-003 projection: every question field derives from the validated target item contract. */
export function projectQuestion(candidate: QuestionCandidate): ClarificationQuestion {
  const { item, owner_rule_id } = candidate.match;
  const isChoice = isChoiceQuestion(item);
  if (
    QUESTION_VALUE_TYPE[item.question_type] !== item.expected_value_type ||
    (isChoice && distinctCanonicalCount(item.alternatives) < 2)
  ) {
    internalInvariant("QUESTION_NOT_PROJECTABLE", `$.questions[${item.id}]`);
  }
  return {
    question_id: candidate.question_id,
    semantic_item_ids: [item.id],
    question_type: item.question_type,
    prompt: item.description,
    ...(isChoice ? { options: item.alternatives } : {}),
    expected_value_type: item.expected_value_type,
    required: true,
    rationale_key: RATIONALE_KEYS[owner_rule_id],
    policy_rule_id: owner_rule_id
  };
}

export function selectQuestions(candidates: readonly QuestionCandidate[]): ClarificationQuestion[] {
  return [...candidates].sort(compareCandidates).slice(0, MAX_QUESTIONS_PER_ROUND).map(projectQuestion);
}
