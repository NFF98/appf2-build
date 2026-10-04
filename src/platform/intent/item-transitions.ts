import { internalInvariant, type IntentSource, type PolicyVisibleItem, type ResolutionState } from "./intent-contract.js";
import type { JsonValue } from "./json-value.js";

type MutableItem = { -readonly [K in keyof PolicyVisibleItem]: PolicyVisibleItem[K] };

type Settlement = {
  readonly resolution_state: ResolutionState;
  readonly source?: IntentSource;
  readonly resolved_value?: JsonValue;
};

/**
 * Every F01-RQ-003 transition ends with can_default=false and no proposed_default; resolved_value exists
 * only after a CONFIRMED settlement. id / source_ref / question shape / dependencies are preserved.
 */
function settle(item: PolicyVisibleItem, settlement: Settlement): PolicyVisibleItem {
  const next: MutableItem = { ...item, ...settlement, can_default: false };
  delete next.proposed_default;
  if (settlement.resolved_value === undefined) delete next.resolved_value;
  return next;
}

/** Clarification answer / assumption EDIT → USER_EXPLICIT + CONFIRMED + resolved_value=validated value. */
export function confirmUserExplicit(item: PolicyVisibleItem, validatedValue: JsonValue): PolicyVisibleItem {
  return settle(item, { source: "USER_EXPLICIT", resolution_state: "CONFIRMED", resolved_value: validatedValue });
}

/**
 * ACCEPT moves proposed_default into resolved_value. LLM_PROPOSED becomes USER_ACCEPTED_PROPOSAL;
 * NFF_DEFAULT keeps its source. Origin / policy source_ref is preserved either way.
 */
export function acceptPendingProposal(item: PolicyVisibleItem): PolicyVisibleItem {
  if (item.resolution_state !== "PROPOSED" || item.proposed_default === undefined) {
    internalInvariant("ACCEPT_TARGET_NOT_PENDING_PROPOSAL", `$.items[${item.id}]`);
  }
  const source: IntentSource = item.source === "LLM_PROPOSED" ? "USER_ACCEPTED_PROPOSAL" : item.source;
  return settle(item, { source, resolution_state: "CONFIRMED", resolved_value: item.proposed_default });
}

/** REJECT and stale dependent invalidation → UNRESOLVED with both values cleared; source provenance kept. */
export function toUnresolved(item: PolicyVisibleItem): PolicyVisibleItem {
  return settle(item, { resolution_state: "UNRESOLVED" });
}
