import { parseUntrustedAnalysisEnvelope } from "./envelope-validation.js";
import {
  POLICY_ITEM_COLLECTIONS,
  policyItemsOf,
  type ClarificationPolicyState,
  type KnownInput,
  type PolicyVisibleItem,
  type StructuredIntentEnvelope
} from "./intent-contract.js";
import { issueTrustedState, policyStateOf, requireTrustedState, withPolicyState, type TrustedIntentState } from "./intent-state.js";
import { changedSemanticIds } from "./semantic-change.js";

/** Truth that exists only because the User decided it; re-analysis can never replace it. */
export function isUserDecidedItem(item: PolicyVisibleItem): boolean {
  return (
    item.source === "USER_EXPLICIT" ||
    item.source === "USER_ACCEPTED_PROPOSAL" ||
    (item.source === "NFF_DEFAULT" && item.resolution_state === "CONFIRMED")
  );
}

function isUserDecidedInput(input: KnownInput): boolean {
  return input.source === "USER_EXPLICIT" || input.source === "USER_ACCEPTED_PROPOSAL";
}

function applySourcePrecedence(trusted: StructuredIntentEnvelope, incoming: StructuredIntentEnvelope): StructuredIntentEnvelope {
  const preservedItems = policyItemsOf(trusted).filter(({ item }) => isUserDecidedItem(item));
  const preservedInputs = trusted.known_inputs.filter(isUserDecidedInput);
  const preservedIds = new Set([...preservedItems.map(({ item }) => item.id), ...preservedInputs.map((input) => input.id)]);
  const merged: Record<string, unknown> = {
    ...incoming,
    known_inputs: [...incoming.known_inputs.filter((input) => !preservedIds.has(input.id)), ...preservedInputs]
  };
  for (const collection of POLICY_ITEM_COLLECTIONS) {
    merged[collection] = [
      ...incoming[collection].filter((item) => !preservedIds.has(item.id)),
      ...preservedItems.filter((entry) => entry.collection === collection).map(({ item }) => item)
    ];
  }
  return merged as StructuredIntentEnvelope;
}

/**
 * Re-analysis merge with F01 source precedence: Prompt A output may refresh LLM / default / domain truth,
 * but USER_EXPLICIT facts, accepted proposals and accepted defaults always keep the trusted version.
 * Invalid incoming analysis — including analysis that orphans preserved User truth — is F01-ERR-002.
 */
export function mergeReanalysis(stateInput: TrustedIntentState, untrustedAnalysis: unknown): TrustedIntentState {
  const state = requireTrustedState(stateInput);
  const incoming = parseUntrustedAnalysisEnvelope(untrustedAnalysis);
  const merged = applySourcePrecedence(state.envelope, incoming);
  const previous = policyStateOf(state);
  const policyState: ClarificationPolicyState = {
    policy_version: previous.policy_version,
    answered_question_ids: previous.answered_question_ids,
    changed_semantic_item_ids: changedSemanticIds(state.envelope, merged)
  };
  return issueTrustedState(withPolicyState(merged, policyState), state.user_explicit_values, "F01-ERR-002");
}
