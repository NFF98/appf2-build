import { assertEnvelope, parseUntrustedAnalysisEnvelope } from "./envelope-validation.js";
import {
  F01_CLARIFICATION_POLICY_VERSION,
  internalInvariant,
  type ClarificationPolicyState,
  type IntentErrorCode,
  type StructuredIntentEnvelope,
  type TrustedStructuredIntentEnvelope
} from "./intent-contract.js";
import { deepFreeze, isJsonValue } from "./json-value.js";

/**
 * Server-owned clarification truth. The sealed Envelope (`intent_record.structured_intent`) is its
 * only durable content: confirmed values live solely in policy-visible item `resolved_value`.
 */
export type TrustedIntentState = {
  readonly envelope: TrustedStructuredIntentEnvelope;
};

/** Only trusted transitions in this module family issue states; copies and hand-built objects never match. */
const issuedStates = new WeakSet<TrustedIntentState>();

/** Validates an Envelope in TRUSTED mode and seals it; `code` is the owner of a validation failure. */
export function issueTrustedState(envelope: StructuredIntentEnvelope, code: IntentErrorCode): TrustedIntentState {
  assertEnvelope(envelope, "TRUSTED", code);
  const state: TrustedIntentState = deepFreeze({ envelope: envelope as TrustedStructuredIntentEnvelope });
  issuedStates.add(state);
  return state;
}

export function isTrustedIntentState(value: unknown): value is TrustedIntentState {
  return typeof value === "object" && value !== null && issuedStates.has(value as TrustedIntentState);
}

export function requireTrustedState(value: unknown): TrustedIntentState {
  if (!isTrustedIntentState(value)) internalInvariant("UNTRUSTED_CLARIFICATION_STATE");
  return value;
}

export function policyStateOf(state: TrustedIntentState): ClarificationPolicyState {
  return state.envelope.analysis_metadata.clarification_policy_state;
}

export function withPolicyState(
  envelope: StructuredIntentEnvelope,
  policyState: ClarificationPolicyState
): StructuredIntentEnvelope {
  return { ...envelope, analysis_metadata: { ...envelope.analysis_metadata, clarification_policy_state: policyState } };
}

/**
 * F01-RQ-005 → F01-DATA-003A entry: validates untrusted Prompt A output (F01-ERR-002 on failure) and
 * attaches a fresh server-owned policy state, so Prompt A can never seed answered / changed IDs.
 */
export function startIntentClarification(untrustedAnalysis: unknown): TrustedIntentState {
  const envelope = parseUntrustedAnalysisEnvelope(untrustedAnalysis);
  const initial: ClarificationPolicyState = {
    policy_version: F01_CLARIFICATION_POLICY_VERSION,
    answered_question_ids: [],
    changed_semantic_item_ids: []
  };
  return issueTrustedState(withPolicyState(envelope, initial), "F01-ERR-002");
}

/**
 * Rehydrates server-persisted `intent_record.structured_intent` from a trusted repository read. Input
 * must never originate from a Client or Prompt A payload; any invariant violation is F01-ERR-014.
 */
export function restoreTrustedIntentState(persistedStructuredIntent: unknown): TrustedIntentState {
  if (!isJsonValue(persistedStructuredIntent)) internalInvariant("PERSISTED_STATE_NOT_JSON");
  const detached = structuredClone(persistedStructuredIntent) as StructuredIntentEnvelope;
  return issueTrustedState(detached, "F01-ERR-014");
}
