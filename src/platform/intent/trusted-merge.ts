import { DependencyGraph } from "./dependency-graph.js";
import {
  POLICY_ITEM_COLLECTIONS,
  policyItemsOf,
  type ClarificationPolicyState,
  type IntentErrorCode,
  type PolicyVisibleItem,
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
 * depends_on_ids closure intersects the changed set; each invalidated ID joins the changed set and
 * the rule repeats downstream to a fixpoint. Because the closure is recursive, that fixpoint is
 * exactly the PROPOSED subset of the changed IDs' transitive dependents, computed in one O(V+E) walk.
 * Non-PROPOSED items (including CONFIRMED User truth) are traversed but never rewritten.
 */
export function invalidateStaleProposals(
  envelope: StructuredIntentEnvelope,
  changedIds: ReadonlySet<string>
): StaleProposalInvalidation {
  const items = policyItemsOf(envelope).map(({ item }) => item);
  const downstream = new DependencyGraph(items).descendantsOf(changedIds);
  const stale = new Set(
    items.filter((item) => item.resolution_state === "PROPOSED" && downstream.has(item.id)).map((item) => item.id)
  );
  if (stale.size === 0) return { envelope, invalidated_item_ids: [] };
  const rewrite = (item: PolicyVisibleItem) => (stale.has(item.id) ? toUnresolved(item) : item);
  const next: Record<string, unknown> = { ...envelope };
  for (const collection of POLICY_ITEM_COLLECTIONS) next[collection] = envelope[collection].map(rewrite);
  return { envelope: next as StructuredIntentEnvelope, invalidated_item_ids: [...stale].sort() };
}

export type TrustedMergeCommit = {
  readonly answered_question_ids: readonly string[];
  /** Failure owner when the merged Envelope violates F01-DATA-001 (see issueTrustedState). */
  readonly code: IntentErrorCode;
};

/**
 * Shared tail of every trusted merge (answer merge, re-analysis merge): direct semantic change IDs
 * → stale-proposal invalidation to fixpoint → sealed state whose changed set is this evaluation's
 * single-use input. Policy re-evaluation always runs on the returned state, i.e. after invalidation.
 */
export function commitTrustedMerge(
  previous: TrustedIntentState,
  merged: StructuredIntentEnvelope,
  commit: TrustedMergeCommit
): TrustedIntentState {
  const direct = changedSemanticIds(previous.envelope, merged);
  const invalidation = invalidateStaleProposals(merged, direct);
  const policyState: ClarificationPolicyState = {
    policy_version: policyStateOf(previous).policy_version,
    answered_question_ids: [...new Set(commit.answered_question_ids)].sort(),
    changed_semantic_item_ids: [...new Set([...direct, ...invalidation.invalidated_item_ids])].sort()
  };
  return issueTrustedState(withPolicyState(invalidation.envelope, policyState), commit.code);
}
