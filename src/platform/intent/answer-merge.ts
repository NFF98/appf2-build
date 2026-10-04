import { evaluateClarificationPolicy, type ClarificationPolicyEvaluation } from "./clarification-policy.js";
import {
  IntentContractError,
  POLICY_ITEM_COLLECTIONS,
  internalInvariant,
  policyItemsOf,
  type IndexedPolicyItem,
  type PolicyVisibleItem,
  type StructuredIntentEnvelope
} from "./intent-contract.js";
import { policyStateOf, requireTrustedState, type TrustedIntentState } from "./intent-state.js";
import { acceptPendingProposal, confirmUserExplicit, toUnresolved } from "./item-transitions.js";
import type { JsonValue } from "./json-value.js";
import { matchedRules } from "./policy-rules.js";
import type { ClarificationQuestion } from "./question-projection.js";
import {
  invalidRequest,
  rejectUnexpectedFields,
  requireArray,
  requireJsonRecord,
  requireNonEmptyString,
  requirePositiveInteger
} from "./request-boundary.js";
import { commitTrustedMerge } from "./trusted-merge.js";
import { valueFitsItem, valueMatchesType } from "./value-shape.js";

export const ASSUMPTION_DECISIONS = ["ACCEPT", "EDIT", "REJECT"] as const;
export type AssumptionDecisionKind = (typeof ASSUMPTION_DECISIONS)[number];

export type ClarificationAnswer = { readonly question_id: string; readonly value: JsonValue };
export type AssumptionDecision = {
  readonly assumption_id: string;
  readonly decision: AssumptionDecisionKind;
  readonly edited_value: JsonValue | null;
};
export type AnswerSubmission = {
  readonly answers: readonly ClarificationAnswer[];
  readonly assumption_decisions: readonly AssumptionDecision[];
  readonly intent_version: number;
};

function parseAnswer(value: unknown, path: string): ClarificationAnswer {
  const record = requireJsonRecord(value, path);
  rejectUnexpectedFields(record, ["question_id", "value"], [], path);
  return { question_id: requireNonEmptyString(record.question_id, `${path}.question_id`), value: record.value as JsonValue };
}

function parseDecision(value: unknown, path: string): AssumptionDecision {
  const record = requireJsonRecord(value, path);
  rejectUnexpectedFields(record, ["assumption_id", "decision"], ["edited_value"], path);
  const decision = record.decision;
  if (typeof decision !== "string" || !(ASSUMPTION_DECISIONS as readonly string[]).includes(decision)) {
    invalidRequest([{ path: `${path}.decision`, reason: "INVALID_ENUM" }]);
  }
  const edited = (record.edited_value ?? null) as JsonValue | null;
  if ((decision === "EDIT") !== (edited !== null)) {
    invalidRequest([{ path: `${path}.edited_value`, reason: "EDITED_VALUE_ONLY_FOR_EDIT" }]);
  }
  return {
    assumption_id: requireNonEmptyString(record.assumption_id, `${path}.assumption_id`),
    decision: decision as AssumptionDecisionKind,
    edited_value: edited
  };
}

/**
 * F01-API-002 request boundary. Only answers / assumption_decisions / intent_version are Client-writable;
 * resolved_value, answered_question_ids, changed_semantic_item_ids, resolved_intent etc. are F01-ERR-001.
 */
export function parseAnswerSubmission(body: unknown): AnswerSubmission {
  const record = requireJsonRecord(structuredClone(requireJsonRecord(body)));
  rejectUnexpectedFields(record, ["answers", "assumption_decisions", "intent_version"], [], "$");
  return {
    answers: requireArray(record.answers, "$.answers").map((entry, index) => parseAnswer(entry, `$.answers[${index}]`)),
    assumption_decisions: requireArray(record.assumption_decisions, "$.assumption_decisions").map((entry, index) =>
      parseDecision(entry, `$.assumption_decisions[${index}]`)
    ),
    intent_version: requirePositiveInteger(record.intent_version, "$.intent_version")
  };
}

function answerInvalid(path: string, reason: string): never {
  throw new IntentContractError("F01-ERR-003", "Clarification answer or assumption decision is not acceptable.", [{ path, reason }]);
}

type MergeContext = {
  readonly evaluation: ClarificationPolicyEvaluation;
  readonly items: ReadonlyMap<string, IndexedPolicyItem>;
  readonly updates: Map<string, PolicyVisibleItem>;
  readonly answered: ClarificationQuestion[];
};

function planAnswer(context: MergeContext, answer: ClarificationAnswer, path: string): void {
  const question = context.evaluation.questions.find((candidate) => candidate.question_id === answer.question_id);
  if (question === undefined) answerInvalid(`${path}.question_id`, "QUESTION_NOT_ELIGIBLE");
  const targetId = question.semantic_item_ids[0];
  if (context.updates.has(targetId)) answerInvalid(path, "DUPLICATE_TARGET_DECISION");
  const target = context.items.get(targetId)?.item ?? internalInvariant("QUESTION_TARGET_MISSING");
  if (!valueMatchesType(answer.value, question.expected_value_type, question.options)) {
    answerInvalid(`${path}.value`, "ANSWER_TYPE_MISMATCH");
  }
  context.updates.set(targetId, confirmUserExplicit(target, answer.value));
  context.answered.push(question);
}

function planDecision(context: MergeContext, decision: AssumptionDecision, path: string): void {
  const assumption = context.evaluation.visible_assumptions.find((entry) => entry.assumption_id === decision.assumption_id);
  if (assumption?.classification !== "DEFAULT" && assumption?.classification !== "PROPOSAL") {
    answerInvalid(`${path}.assumption_id`, "ASSUMPTION_NOT_DECIDABLE");
  }
  if (context.updates.has(decision.assumption_id)) answerInvalid(path, "DUPLICATE_TARGET_DECISION");
  const item = context.items.get(decision.assumption_id)?.item ?? internalInvariant("ASSUMPTION_TARGET_MISSING");
  if (decision.decision !== "REJECT" && item.policy_risk_flags.length > 0) {
    answerInvalid(`${path}.decision`, "RISK_ITEM_REQUIRES_CLARIFICATION_ANSWER");
  }
  if (decision.decision === "ACCEPT") {
    context.updates.set(item.id, acceptPendingProposal(item));
  } else if (decision.decision === "REJECT") {
    context.updates.set(item.id, toUnresolved(item));
  } else {
    const edited = decision.edited_value as JsonValue;
    if (!valueFitsItem(edited, item)) answerInvalid(`${path}.edited_value`, "ANSWER_TYPE_MISMATCH");
    context.updates.set(item.id, confirmUserExplicit(item, edited));
  }
}

function applyUpdates(envelope: StructuredIntentEnvelope, updates: ReadonlyMap<string, PolicyVisibleItem>): StructuredIntentEnvelope {
  const next: Record<string, unknown> = { ...envelope };
  for (const collection of POLICY_ITEM_COLLECTIONS) {
    next[collection] = envelope[collection].map((item) => updates.get(item.id) ?? item);
  }
  return next as StructuredIntentEnvelope;
}

/** F01-DATA-003A rule 9: an accepted answer must actually discharge the rule that asked it. */
function assertBlockersDischarged(state: TrustedIntentState, answered: readonly ClarificationQuestion[]): void {
  const merged = new Map(policyItemsOf(state.envelope).map((indexed) => [indexed.item.id, indexed]));
  for (const question of answered) {
    const target = merged.get(question.semantic_item_ids[0]) ?? internalInvariant("QUESTION_TARGET_MISSING");
    if (matchedRules(target).includes(question.policy_rule_id)) {
      internalInvariant("ACCEPTED_ANSWER_DID_NOT_RESOLVE_BLOCKER", `$.answers[${question.question_id}]`);
    }
  }
}

/**
 * Trusted F01-RQ-003 answer merge. Target semantic truth (including canonical resolved_value) is
 * updated first, dependent stale proposals are invalidated to fixpoint, and only then are the accepted
 * question IDs added to the server-owned answered set. The previous changed set is consumed here.
 */
export function submitClarificationAnswers(stateInput: TrustedIntentState, body: unknown): TrustedIntentState {
  const state = requireTrustedState(stateInput);
  const submission = parseAnswerSubmission(body);
  const context: MergeContext = {
    evaluation: evaluateClarificationPolicy(state),
    items: new Map(policyItemsOf(state.envelope).map((indexed) => [indexed.item.id, indexed])),
    updates: new Map(),
    answered: []
  };
  submission.answers.forEach((answer, index) => planAnswer(context, answer, `$.answers[${index}]`));
  submission.assumption_decisions.forEach((decision, index) =>
    planDecision(context, decision, `$.assumption_decisions[${index}]`)
  );
  const next = commitTrustedMerge(state, applyUpdates(state.envelope, context.updates), {
    answered_question_ids: [...policyStateOf(state).answered_question_ids, ...context.answered.map((question) => question.question_id)],
    code: "F01-ERR-014"
  });
  assertBlockersDischarged(next, context.answered);
  return next;
}
