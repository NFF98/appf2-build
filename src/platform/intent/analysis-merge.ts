import { evaluateClarificationPolicy, type ClarificationPolicyEvaluation } from "./clarification-policy.js";
import { parseUntrustedAnalysisEnvelope } from "./envelope-validation.js";
import {
  POLICY_ITEM_COLLECTIONS,
  ephemeralRequirementsOf,
  policyItemsOf,
  type IndexedPolicyItem,
  type KnownInput,
  type PolicyItemCollection,
  type PolicyVisibleItem,
  type StructuredIntentEnvelope
} from "./intent-contract.js";
import { policyStateOf, requireTrustedState, type TrustedIntentState } from "./intent-state.js";
import { commitTrustedMerge } from "./trusted-merge.js";

export type ReanalysisMergeResult = {
  readonly state: TrustedIntentState;
  readonly evaluation: ClarificationPolicyEvaluation;
};

/**
 * Source precedence for one stable ID present in both the trusted state and fresh Prompt A output.
 * User-decided truth (USER_EXPLICIT, USER_ACCEPTED_PROPOSAL, accepted NFF_DEFAULT and its resolved_value)
 * is never replaced by analysis. A DOMAIN_KNOWN item is analysis-owned upstream truth, so a fresh
 * CONFIRMED DOMAIN_KNOWN fact under the same stable ID refreshes it; analysis can never retract a trusted
 * fact to UNRESOLVED or replace it with another source. Otherwise only pending trusted analysis
 * (UNRESOLVED / PROPOSED) may be refreshed by a pending incoming item.
 */
function refreshableBy(trusted: PolicyVisibleItem, incoming: PolicyVisibleItem): boolean {
  if (trusted.source === "DOMAIN_KNOWN" && incoming.source === "DOMAIN_KNOWN" && incoming.resolution_state === "CONFIRMED") {
    return true;
  }
  return trusted.resolution_state !== "CONFIRMED" && incoming.resolution_state !== "CONFIRMED";
}

function mergeItems(trusted: StructuredIntentEnvelope, incoming: StructuredIntentEnvelope): Record<PolicyItemCollection, PolicyVisibleItem[]> {
  const incomingById = new Map(policyItemsOf(incoming).map((indexed) => [indexed.item.id, indexed]));
  const placed: IndexedPolicyItem[] = [];
  const consumed = new Set<string>();
  for (const current of policyItemsOf(trusted)) {
    const fresh = incomingById.get(current.item.id);
    placed.push(fresh !== undefined && refreshableBy(current.item, fresh.item) ? fresh : current);
    consumed.add(current.item.id);
  }
  for (const fresh of incomingById.values()) {
    if (!consumed.has(fresh.item.id)) placed.push(fresh);
  }
  const byCollection = Object.fromEntries(POLICY_ITEM_COLLECTIONS.map((collection) => [collection, [] as PolicyVisibleItem[]]));
  for (const { collection, item } of placed) byCollection[collection]!.push(item);
  return byCollection as Record<PolicyItemCollection, PolicyVisibleItem[]>;
}

/**
 * KnownInput IDs are stable semantic facts (F01-DATA-002). A trusted DOMAIN_KNOWN fact is refreshed in
 * place by a fresh DOMAIN_KNOWN fact under the same ID; any other trusted fact (User truth included) keeps
 * its trusted value and provenance. Analysis may add facts under new IDs.
 */
function mergeKnownInputs(trusted: readonly KnownInput[], incoming: readonly KnownInput[]): KnownInput[] {
  const incomingById = new Map(incoming.map((input) => [input.id, input]));
  const merged = trusted.map((current) => {
    const fresh = incomingById.get(current.id);
    incomingById.delete(current.id);
    return fresh !== undefined && current.source === "DOMAIN_KNOWN" && fresh.source === "DOMAIN_KNOWN" ? fresh : current;
  });
  return [...merged, ...incomingById.values()];
}

/**
 * Trusted items or inputs omitted by the new analysis are retained: Prompt A output cannot delete
 * server-trusted truth or a pending blocker. Server-owned BF-050 DO_NOT_PERSIST markers are trusted facts
 * too: they are kept and an incoming KnownInput under a marker ID never replaces the marker.
 */
function applySourcePrecedence(trusted: StructuredIntentEnvelope, incoming: StructuredIntentEnvelope): StructuredIntentEnvelope {
  const markers = ephemeralRequirementsOf(trusted);
  const markerIds = new Set(markers.map((marker) => marker.id));
  return {
    ...incoming,
    known_inputs: mergeKnownInputs(trusted.known_inputs, incoming.known_inputs.filter((input) => !markerIds.has(input.id))),
    ...mergeItems(trusted, incoming),
    ...(markers.length === 0 ? {} : { ephemeral_input_requirements: markers })
  };
}

/**
 * Re-analysis merge. Fresh Prompt A output is validated as untrusted analysis (F01-ERR-002), merged under
 * source precedence, re-validated against the post-merge canonical truth (where its depends_on_ids may
 * resolve to trusted IDs and must stay acyclic), and dependent stale proposals
 * are invalidated before the policy is re-run. Server-owned answered IDs carry over unchanged.
 */
export function mergeReanalysis(stateInput: TrustedIntentState, untrustedAnalysis: unknown): ReanalysisMergeResult {
  const state = requireTrustedState(stateInput);
  const incoming = parseUntrustedAnalysisEnvelope(untrustedAnalysis, "DEFERRED_TO_MERGE");
  const next = commitTrustedMerge(state, applySourcePrecedence(state.envelope, incoming), {
    answered_question_ids: policyStateOf(state).answered_question_ids,
    code: "F01-ERR-002"
  });
  return { state: next, evaluation: evaluateClarificationPolicy(next) };
}
