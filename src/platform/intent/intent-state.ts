import { assertEnvelope, parseUntrustedAnalysisEnvelope } from "./envelope-validation.js";
import {
  F01_CLARIFICATION_POLICY_VERSION,
  IntentContractError,
  QUESTION_VALUE_TYPE,
  internalInvariant,
  policyItemsOf,
  type ClarificationPolicyState,
  type IntentErrorCode,
  type StructuredIntentEnvelope,
  type TrustedStructuredIntentEnvelope
} from "./intent-contract.js";
import { deepFreeze, findNonJsonPath, isPlainRecord, type JsonValue } from "./json-value.js";
import { valueMatchesType } from "./value-shape.js";

/**
 * Server-owned clarification truth. `user_explicit_values` holds validated User answer / EDIT values
 * keyed by the USER_EXPLICIT policy-visible item they resolved; it is never Client- or LLM-writable.
 */
export type TrustedIntentState = {
  readonly envelope: TrustedStructuredIntentEnvelope;
  readonly user_explicit_values: Readonly<Record<string, JsonValue>>;
};

/** Issuance stays inside the intent module's trusted transitions; copies or hand-built objects never match. */
const issuedStates = new WeakSet<TrustedIntentState>();

function checkUserExplicitValues(
  envelope: StructuredIntentEnvelope,
  values: Readonly<Record<string, JsonValue>>,
  code: IntentErrorCode
): void {
  const items = new Map(policyItemsOf(envelope).map(({ item }) => [item.id, item]));
  for (const [itemId, value] of Object.entries(values)) {
    const item = items.get(itemId);
    const isChoice = item?.question_type === "SINGLE_CHOICE" || item?.question_type === "MULTI_CHOICE";
    const valid =
      item !== undefined &&
      item.source === "USER_EXPLICIT" &&
      valueMatchesType(value, QUESTION_VALUE_TYPE[item.question_type], isChoice ? item.alternatives : undefined);
    if (!valid) {
      throw new IntentContractError(code, "User explicit value is not bound to a matching USER_EXPLICIT item.", [
        { path: `$.user_explicit_values[${JSON.stringify(itemId)}]`, reason: "USER_VALUE_BINDING_INVALID" }
      ]);
    }
  }
}

/**
 * Validates a server-produced Envelope in TRUSTED mode and seals it. `code` names who owns a
 * failure: F01-ERR-014 for pure server transitions, F01-ERR-002 when untrusted analysis caused it.
 */
export function issueTrustedState(
  envelope: StructuredIntentEnvelope,
  userExplicitValues: Readonly<Record<string, JsonValue>>,
  code: IntentErrorCode
): TrustedIntentState {
  assertEnvelope(envelope, "TRUSTED", code);
  if (findNonJsonPath(userExplicitValues, "$.user_explicit_values") !== null) {
    internalInvariant("USER_VALUES_NOT_JSON", "$.user_explicit_values");
  }
  checkUserExplicitValues(envelope, userExplicitValues, code);
  const state = deepFreeze({
    envelope: envelope as TrustedStructuredIntentEnvelope,
    user_explicit_values: { ...userExplicitValues }
  });
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
  return {
    ...envelope,
    analysis_metadata: { ...envelope.analysis_metadata, clarification_policy_state: policyState }
  };
}

/**
 * F01-RQ-005 → F01-DATA-003A entry: validates untrusted Prompt A output (F01-ERR-002 on failure)
 * and attaches a fresh server-owned policy state. Prompt A can never seed answered/changed IDs.
 */
export function startIntentClarification(untrustedAnalysis: unknown): TrustedIntentState {
  const envelope = parseUntrustedAnalysisEnvelope(untrustedAnalysis);
  const initial: ClarificationPolicyState = {
    policy_version: F01_CLARIFICATION_POLICY_VERSION,
    answered_question_ids: [],
    changed_semantic_item_ids: []
  };
  return issueTrustedState(withPolicyState(envelope, initial), {}, "F01-ERR-002");
}

/**
 * Rehydrates server-persisted clarification truth (e.g. a trusted intent_record repository read).
 * Input must never originate from Client or Prompt A payloads; violations are F01-ERR-014.
 */
export function restoreTrustedIntentState(persisted: {
  readonly envelope: unknown;
  readonly user_explicit_values: unknown;
}): TrustedIntentState {
  const values = persisted.user_explicit_values;
  if (!isPlainRecord(values) || findNonJsonPath(values) !== null || findNonJsonPath(persisted.envelope) !== null) {
    internalInvariant("PERSISTED_STATE_NOT_JSON", "$");
  }
  const detached = structuredClone(persisted) as {
    readonly envelope: StructuredIntentEnvelope;
    readonly user_explicit_values: Readonly<Record<string, JsonValue>>;
  };
  return issueTrustedState(detached.envelope, detached.user_explicit_values, "F01-ERR-014");
}
