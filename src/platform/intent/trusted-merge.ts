import { DependencyGraph } from "./dependency-graph.js";
import { assertEnvelope } from "./envelope-validation.js";
import {
  mapPolicyItems,
  policyItemsOf,
  type ClarificationPolicyState,
  type IntentErrorCode,
  type StructuredIntentEnvelope
} from "./intent-contract.js";
import { issueTrustedState, policyStateOf, withPolicyState, type TrustedIntentState } from "./intent-state.js";
import { toUnresolved } from "./item-transitions.js";
import { changedSemanticIds } from "./semantic-change.js";

export type StaleProposalInvalidation = {
  readonly envelope: StructuredIntentEnvelope;
  readonly invalidated_item_ids: readonly string[];
};

/**
 * F01-RQ-003 dependent stale-proposal invalidation. A PROPOSED item is stale when its recursive
 * depends_on_ids closure intersects the changed set; each invalidated ID joins the changed set and the
 * rule repeats until no further PROPOSED item is invalidated. Because staleness is already defined over
 * the recursive closure, that fixpoint equals the PROPOSED subset of the changed IDs' transitive
 * dependents, computed in a single O(V+E) traversal. Non-PROPOSED items (CONFIRMED User / domain /
 * accepted-default truth, UNRESOLVED unknowns) are traversed but never rewritten.
 */
export function invalidateStaleProposals(
  envelope: StructuredIntentEnvelope,
  changedIds: ReadonlySet<string>
): StaleProposalInvalidation {
  const items = policyItemsOf(envelope).map(({ item }) => item);
  const downstream = new DependencyGraph(items).dependentsClosure(changedIds);
  const stale = new Set(
    items.filter((item) => item.resolution_state === "PROPOSED" && downstream.has(item.id)).map((item) => item.id)
  );
  if (stale.size === 0) return { envelope, invalidated_item_ids: [] };
  return {
    envelope: mapPolicyItems(envelope, (item) => (stale.has(item.id) ? toUnresolved(item) : item)),
    invalidated_item_ids: [...stale].sort()
  };
}

export type TrustedMergeCommit = {
  readonly answered_question_ids: readonly string[];
  /** Failure owner when the merged Envelope violates F01-DATA-001 (see issueTrustedState). */
  readonly code: IntentErrorCode;
};

/**
 * Shared tail of every trusted merge: merged Envelope validated before any graph walk → direct semantic
 * change IDs → stale-proposal invalidation to
 * fixpoint → sealed state whose changed set is the single-use input of the next evaluation. The previous
 * changed set is replaced, never carried forward, and policy only ever runs on the returned state.
 */
export function commitTrustedMerge(
  previous: TrustedIntentState,
  merged: StructuredIntentEnvelope,
  commit: TrustedMergeCommit
): TrustedIntentState {
  assertEnvelope(withPolicyState(merged, policyStateOf(previous)), "TRUSTED", commit.code);
  const direct = changedSemanticIds(previous.envelope, merged);
  const invalidation = invalidateStaleProposals(merged, direct);
  const policyState: ClarificationPolicyState = {
    policy_version: policyStateOf(previous).policy_version,
    answered_question_ids: [...new Set(commit.answered_question_ids)].sort(),
    changed_semantic_item_ids: [...new Set([...direct, ...invalidation.invalidated_item_ids])].sort()
  };
  return issueTrustedState(withPolicyState(invalidation.envelope, policyState), commit.code);
}
