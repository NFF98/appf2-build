import { evaluateClarificationPolicy, type ClarificationPolicyEvaluation } from "./clarification-policy.js";
import {
  IntentContractError,
  POLICY_ITEM_COLLECTIONS,
  internalInvariant,
  policyItemsOf,
  type ClarificationPolicyState,
  type IndexedPolicyItem,
  type PolicyVisibleItem,
  type StructuredIntentEnvelope
} from "./intent-contract.js";
import { issueTrustedState, policyStateOf, requireTrustedState, withPolicyState, type TrustedIntentState } from "./intent-state.js";
import { jsonEquals, type JsonValue } from "./json-value.js";
import { matchedRules } from "./policy-rules.js";
import type { ClarificationQuestion } from "./question-projection.js";
import {
  rejectUnexpectedFields,
  requireArray,
  requireJsonRecord,
  requireNonEmptyString,
  requirePositiveInteger,
  invalidRequest
} from "./request-boundary.js";
import { itemSemanticallyChanged } from "./semantic-change.js";
import { valueMatchesType } from "./value-shape.js";

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
 * answered_question_ids, changed_semantic_item_ids, resolved_intent and similar fields are F01-ERR-001.
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

type PlannedUpdate = { readonly item: PolicyVisibleItem; readonly userValue?: JsonValue };

function choiceOptions(item: PolicyVisibleItem): readonly JsonValue[] | undefined {
  return item.question_type === "SINGLE_CHOICE" || item.question_type === "MULTI_CHOICE" ? item.alternatives : undefined;
}

type MutableItem = { -readonly [K in keyof PolicyVisibleItem]: PolicyVisibleItem[K] };

/** Stale default/proposal invalidation (F01-RQ-003): the value can no longer be offered as a default. */
function withoutDefault(item: PolicyVisibleItem): MutableItem {
  const copy: MutableItem = { ...item, can_default: false };
  delete copy.proposed_default;
  return copy;
}

/** Answer / EDIT merge: USER_EXPLICIT + CONFIRMED; the superseded default/proposal is invalidated. */
function asUserExplicit(item: PolicyVisibleItem): PolicyVisibleItem {
  return { ...withoutDefault(item), source: "USER_EXPLICIT", resolution_state: "CONFIRMED" };
}

/** REJECT: the original default/proposal may not reach Resolved Intent; the item becomes UNRESOLVED truth. */
function rejectProposal(item: PolicyVisibleItem): PolicyVisibleItem {
  return { ...withoutDefault(item), resolution_state: "UNRESOLVED" };
}

function acceptProposal(item: PolicyVisibleItem): PolicyVisibleItem {
  return item.source === "LLM_PROPOSED"
    ? { ...item, source: "USER_ACCEPTED_PROPOSAL", resolution_state: "CONFIRMED" }
    : { ...item, resolution_state: "CONFIRMED" };
}

type MergeContext = {
  readonly evaluation: ClarificationPolicyEvaluation;
  readonly items: ReadonlyMap<string, IndexedPolicyItem>;
  readonly updates: Map<string, PlannedUpdate>;
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
  context.updates.set(targetId, { item: asUserExplicit(target), userValue: answer.value });
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
    context.updates.set(item.id, { item: acceptProposal(item) });
  } else if (decision.decision === "REJECT") {
    context.updates.set(item.id, { item: rejectProposal(item) });
  } else {
    const edited = decision.edited_value as JsonValue;
    if (!valueMatchesType(edited, item.expected_value_type, choiceOptions(item))) {
      answerInvalid(`${path}.edited_value`, "ANSWER_TYPE_MISMATCH");
    }
    context.updates.set(item.id, { item: asUserExplicit(item), userValue: edited });
  }
}

function applyUpdates(envelope: StructuredIntentEnvelope, updates: ReadonlyMap<string, PlannedUpdate>): StructuredIntentEnvelope {
  const next: Record<string, unknown> = { ...envelope };
  for (const collection of POLICY_ITEM_COLLECTIONS) {
    next[collection] = envelope[collection].map((item) => updates.get(item.id)?.item ?? item);
  }
  return next as StructuredIntentEnvelope;
}

/** F01-DATA-003A rule 9: an accepted answer must actually discharge the rule that asked it. */
function assertBlockersDischarged(context: MergeContext): void {
  for (const question of context.answered) {
    const targetId = question.semantic_item_ids[0];
    const collection = context.items.get(targetId)!.collection;
    const updated = context.updates.get(targetId)!.item;
    if (matchedRules({ collection, item: updated }).includes(question.policy_rule_id)) {
      internalInvariant("ACCEPTED_ANSWER_DID_NOT_RESOLVE_BLOCKER", `$.answers[${question.question_id}]`);
    }
  }
}

function changedIds(context: MergeContext, previousValues: Readonly<Record<string, JsonValue>>): string[] {
  const changed: string[] = [];
  for (const [id, update] of context.updates) {
    const before = context.items.get(id)!.item;
    const valueChanged = update.userValue !== undefined && !jsonEquals(previousValues[id], update.userValue);
    if (valueChanged || itemSemanticallyChanged(before, update.item)) changed.push(id);
  }
  return changed.sort();
}

/**
 * Trusted F01-RQ-003 answer merge. Semantic truth is updated first; only then are the accepted
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
  const mergedEnvelope = applyUpdates(state.envelope, context.updates);
  assertBlockersDischarged(context);
  const userValues: Record<string, JsonValue> = { ...state.user_explicit_values };
  for (const [id, update] of context.updates) {
    if (update.userValue !== undefined) userValues[id] = update.userValue;
  }
  const previous = policyStateOf(state);
  const policyState: ClarificationPolicyState = {
    policy_version: previous.policy_version,
    answered_question_ids: [...new Set([...previous.answered_question_ids, ...context.answered.map((q) => q.question_id)])].sort(),
    changed_semantic_item_ids: changedIds(context, state.user_explicit_values)
  };
  return issueTrustedState(withPolicyState(mergedEnvelope, policyState), userValues, "F01-ERR-014");
}
