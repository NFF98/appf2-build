import {
  policyItemsOf,
  type KnownInput,
  type PolicyItemCollection,
  type PolicyVisibleItem,
  type StructuredIntentEnvelope
} from "./intent-contract.js";
import { jsonEquals, type JsonValue } from "./json-value.js";

/** F01-DATA-003A rule 3: semantic-policy truth whose change must enter changed_semantic_item_ids[]. */
const ITEM_SEMANTIC_FIELDS = [
  "description",
  "source",
  "source_ref",
  "resolution_state",
  "resolved_value",
  "expected_value_type",
  "question_type",
  "required_for_execution",
  "impact_level",
  "materiality",
  "policy_risk_flags",
  "depends_on_ids",
  "can_default",
  "proposed_default",
  "alternatives"
] as const satisfies readonly (keyof PolicyVisibleItem)[];
const KNOWN_INPUT_SEMANTIC_FIELDS = ["value", "source", "source_ref"] as const satisfies readonly (keyof KnownInput)[];

type SemanticNode =
  | { readonly kind: "item"; readonly collection: PolicyItemCollection; readonly item: PolicyVisibleItem }
  | { readonly kind: "input"; readonly input: KnownInput };

function sameFields<T extends object>(left: T, right: T, fields: readonly (keyof T)[]): boolean {
  return fields.every((field) => jsonEquals(left[field] as JsonValue | undefined, right[field] as JsonValue | undefined));
}

function nodeChanged(before: SemanticNode, after: SemanticNode): boolean {
  if (before.kind === "item" && after.kind === "item") {
    return before.collection !== after.collection || !sameFields(before.item, after.item, ITEM_SEMANTIC_FIELDS);
  }
  if (before.kind === "input" && after.kind === "input") {
    return !sameFields(before.input, after.input, KNOWN_INPUT_SEMANTIC_FIELDS);
  }
  return true;
}

function nodesOf(envelope: StructuredIntentEnvelope): Map<string, SemanticNode> {
  const nodes = new Map<string, SemanticNode>();
  for (const input of envelope.known_inputs) nodes.set(input.id, { kind: "input", input });
  for (const { collection, item } of policyItemsOf(envelope)) nodes.set(item.id, { kind: "item", collection, item });
  return nodes;
}

/**
 * Stable IDs added, removed or semantically changed between two Envelopes. Fields outside the rule-3
 * list (semantic_role, confidence, user_visible, rationale, key, value_type, sensitivity) are treated as
 * non-semantic presentation/analysis metadata.
 */
export function changedSemanticIds(before: StructuredIntentEnvelope, after: StructuredIntentEnvelope): Set<string> {
  const previous = nodesOf(before);
  const next = nodesOf(after);
  const changed = new Set<string>();
  for (const [id, node] of next) {
    const prior = previous.get(id);
    if (prior === undefined || nodeChanged(prior, node)) changed.add(id);
  }
  for (const id of previous.keys()) {
    if (!next.has(id)) changed.add(id);
  }
  return changed;
}
