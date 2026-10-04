import { parseUntrustedAnalysisEnvelope } from "./envelope-validation.js";
import {
  POLICY_ITEM_COLLECTIONS,
  policyItemsOf,
  type KnownInput,
  type PolicyVisibleItem,
  type StructuredIntentEnvelope
} from "./intent-contract.js";
import { policyStateOf, requireTrustedState, type TrustedIntentState } from "./intent-state.js";
import { commitTrustedMerge } from "./trusted-merge.js";

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
 * but USER_EXPLICIT facts, accepted proposals and accepted defaults (with their resolved_value) always
 * keep the trusted version. Invalid incoming analysis — including analysis that orphans preserved User
 * truth — is F01-ERR-002. Stale dependent proposals are invalidated before the next policy evaluation.
 */
export function mergeReanalysis(stateInput: TrustedIntentState, untrustedAnalysis: unknown): TrustedIntentState {
  const state = requireTrustedState(stateInput);
  const incoming = parseUntrustedAnalysisEnvelope(untrustedAnalysis);
  return commitTrustedMerge(state, applySourcePrecedence(state.envelope, incoming), {
    answered_question_ids: policyStateOf(state).answered_question_ids,
    code: "F01-ERR-002"
  });
}
