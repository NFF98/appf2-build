import { DependencyGraph } from "./dependency-graph.js";
import { internalInvariant, policyItemsOf, type ClarificationDecision } from "./intent-contract.js";
import { policyStateOf, requireTrustedState, type TrustedIntentState } from "./intent-state.js";
import { deepFreeze } from "./json-value.js";
import { POLICY_RULE_PRECEDENCE, matchItem, type ItemPolicyMatch, type PolicyRuleId } from "./policy-rules.js";
import {
  MAX_QUESTIONS_PER_ROUND,
  questionIdFor,
  selectQuestions,
  type ClarificationQuestion,
  type QuestionCandidate
} from "./question-projection.js";
import { projectVisibleAssumptions, type VisibleAssumption } from "./visible-assumptions.js";

/**
 * Deterministic ClarificationPolicyEngine output. `triggered_rule_ids` is policy / API diagnostic truth
 * and deliberately has no product_event counterpart (F01 Evidence source ownership).
 */
export type ClarificationPolicyEvaluation = {
  readonly policy_version: string;
  readonly decision: ClarificationDecision;
  readonly triggered_rule_ids: readonly PolicyRuleId[];
  readonly questions: readonly ClarificationQuestion[];
  readonly visible_assumptions: readonly VisibleAssumption[];
};

function matchAll(state: TrustedIntentState): ItemPolicyMatch[] {
  return policyItemsOf(state.envelope).map(
    (indexed) => matchItem(indexed) ?? internalInvariant("NO_POLICY_OUTCOME", `$.${indexed.collection}[${indexed.item.id}]`)
  );
}

function intersects(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  for (const id of left) {
    if (right.has(id)) return true;
  }
  return false;
}

/**
 * F01-DATA-003A suppression: an answered question stays suppressed unless this evaluation's changed set
 * intersects its re-ask basis (target + recursive depends_on_ids closure).
 */
function eligibleCandidates(
  blockers: readonly ItemPolicyMatch[],
  state: TrustedIntentState,
  graph: DependencyGraph
): QuestionCandidate[] {
  const { answered_question_ids, changed_semantic_item_ids } = policyStateOf(state);
  const answered = new Set(answered_question_ids);
  const changed = new Set(changed_semantic_item_ids);
  const eligible: QuestionCandidate[] = [];
  for (const match of blockers) {
    const questionId = questionIdFor(match.owner_rule_id, [match.item.id]);
    const alreadyAsked = answered.has(questionId);
    if (alreadyAsked && !intersects(graph.reaskBasis([match.item.id]), changed)) continue;
    eligible.push({
      match,
      question_id: questionId,
      already_asked: alreadyAsked,
      downstream_unknowns_resolved: graph.unresolvedDescendantCount(match.item.id)
    });
  }
  return eligible;
}

/** F01 §6 totality rules; any state outside them is F01-ERR-014, never an implementation fallback. */
function decide(
  matches: readonly ItemPolicyMatch[],
  blockers: readonly ItemPolicyMatch[],
  eligible: readonly QuestionCandidate[]
): ClarificationDecision {
  if (blockers.length > 0) {
    if (eligible.length === 0) internalInvariant("SUPPRESSED_BLOCKER_UNRESOLVED", "$.questions");
    return "NEEDS_CLARIFICATION";
  }
  if (matches.some((match) => match.owner_rule_id === "F01-POL-CP-004")) return "READY_WITH_VISIBLE_ASSUMPTIONS";
  if (matches.some(({ item }) => item.materiality === "MATERIAL" && item.resolution_state !== "CONFIRMED")) {
    internalInvariant("READY_WITH_UNRESOLVED_MATERIAL_TRUTH");
  }
  return "READY";
}

function triggeredRules(matches: readonly ItemPolicyMatch[]): PolicyRuleId[] {
  const triggered = new Set(matches.flatMap((match) => match.matched_rule_ids));
  return POLICY_RULE_PRECEDENCE.filter((ruleId) => triggered.has(ruleId));
}

/** Pure function of the sealed server-owned state: Envelope + clarification_policy_state + policy version. */
export function evaluateClarificationPolicy(stateInput: TrustedIntentState): ClarificationPolicyEvaluation {
  const state = requireTrustedState(stateInput);
  const matches = matchAll(state);
  const graph = new DependencyGraph(matches.map(({ item }) => item));
  const blockers = matches.filter((match) => match.outcome === "NEEDS_CLARIFICATION");
  const eligible = eligibleCandidates(blockers, state, graph);
  const decision = decide(matches, blockers, eligible);
  const questions = decision === "NEEDS_CLARIFICATION" ? selectQuestions(eligible) : [];
  if (decision === "NEEDS_CLARIFICATION" && (questions.length < 1 || questions.length > MAX_QUESTIONS_PER_ROUND)) {
    internalInvariant("CLARIFICATION_QUESTION_COUNT", "$.questions");
  }
  return deepFreeze({
    policy_version: policyStateOf(state).policy_version,
    decision,
    triggered_rule_ids: triggeredRules(matches),
    questions,
    visible_assumptions: projectVisibleAssumptions(matches)
  });
}
