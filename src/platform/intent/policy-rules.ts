import type { ClarificationDecision, IndexedPolicyItem, PolicyVisibleItem } from "./intent-contract.js";

/** F01 §6 precedence: CP-003 > CP-001 > CP-002 > CP-003A > CP-004 > CP-005 > CP-006. */
export const POLICY_RULE_PRECEDENCE = [
  "F01-POL-CP-003",
  "F01-POL-CP-001",
  "F01-POL-CP-002",
  "F01-POL-CP-003A",
  "F01-POL-CP-004",
  "F01-POL-CP-005",
  "F01-POL-CP-006"
] as const;
export type PolicyRuleId = (typeof POLICY_RULE_PRECEDENCE)[number];

const RULE_OUTCOME: Readonly<Record<PolicyRuleId, ClarificationDecision>> = Object.freeze({
  "F01-POL-CP-003": "NEEDS_CLARIFICATION",
  "F01-POL-CP-001": "NEEDS_CLARIFICATION",
  "F01-POL-CP-002": "NEEDS_CLARIFICATION",
  "F01-POL-CP-003A": "NEEDS_CLARIFICATION",
  "F01-POL-CP-004": "READY_WITH_VISIBLE_ASSUMPTIONS",
  "F01-POL-CP-005": "READY",
  "F01-POL-CP-006": "READY"
});

export type ItemPolicyMatch = IndexedPolicyItem & {
  /** Every rule whose locked condition holds, in precedence order; [0] owns the item outcome. */
  readonly matched_rule_ids: readonly PolicyRuleId[];
  readonly owner_rule_id: PolicyRuleId;
  readonly outcome: ClarificationDecision;
};

export function hasSafeDefault(item: PolicyVisibleItem): boolean {
  return item.can_default && item.proposed_default !== undefined;
}

function matchesCp003(item: PolicyVisibleItem): boolean {
  return item.policy_risk_flags.length > 0 && item.source !== "USER_EXPLICIT";
}

function matchesCp001({ collection, item }: IndexedPolicyItem): boolean {
  return (
    collection === "missing_fields" &&
    item.resolution_state !== "CONFIRMED" &&
    item.required_for_execution &&
    !hasSafeDefault(item)
  );
}

function matchesCp002({ collection, item }: IndexedPolicyItem): boolean {
  return (
    collection === "ambiguities" &&
    item.resolution_state !== "CONFIRMED" &&
    item.materiality === "MATERIAL" &&
    item.alternatives.length >= 2 &&
    (item.impact_level === "HIGH" || item.impact_level === "CRITICAL")
  );
}

/** Rules CP-003A..CP-006 only apply when no higher-precedence rule holds. */
function fallbackRule(item: PolicyVisibleItem): PolicyRuleId | null {
  const material = item.materiality === "MATERIAL";
  const pending = item.resolution_state === "UNRESOLVED" || item.resolution_state === "PROPOSED";
  if (material && pending && !item.can_default) return "F01-POL-CP-003A";
  if (material && item.resolution_state === "PROPOSED" && item.can_default) return "F01-POL-CP-004";
  if (!material) return "F01-POL-CP-005";
  if (item.resolution_state === "CONFIRMED") return "F01-POL-CP-006";
  return null;
}

export function matchedRules(indexed: IndexedPolicyItem): PolicyRuleId[] {
  const matched: PolicyRuleId[] = [];
  if (matchesCp003(indexed.item)) matched.push("F01-POL-CP-003");
  if (matchesCp001(indexed)) matched.push("F01-POL-CP-001");
  if (matchesCp002(indexed)) matched.push("F01-POL-CP-002");
  if (matched.length > 0) return matched;
  const fallback = fallbackRule(indexed.item);
  return fallback === null ? [] : [fallback];
}

/**
 * Returns null when an item has no contract-authorized outcome. F01-DATA-001 invariants make this
 * unreachable for every validated Envelope; callers treat null as F01-ERR-014 (corrupted state).
 */
export function matchItem(indexed: IndexedPolicyItem): ItemPolicyMatch | null {
  const matched = matchedRules(indexed);
  const owner = matched[0];
  if (owner === undefined) return null;
  return { ...indexed, matched_rule_ids: matched, owner_rule_id: owner, outcome: RULE_OUTCOME[owner] };
}
