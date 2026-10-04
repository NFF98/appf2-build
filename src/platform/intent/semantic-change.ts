import {
  policyItemsOf,
  type KnownInput,
  type PolicyItemCollection,
  type PolicyVisibleItem,
  type StructuredIntentEnvelope
} from "./intent-contract.js";
import { jsonEquals, type JsonValue } from "./json-value.js";

/** F01-DATA-003A rule 3: semantic-policy truth whose change must enter changed_semantic_item_ids. */
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

function fieldsEqual<T extends object>(left: T, right: T, fields: readonly (keyof T)[]): boolean {
  return fields.every((field) =>
    jsonEquals(left[field] as JsonValue | undefined, right[field] as JsonValue | undefined)
  );
}

export function itemSemanticallyChanged(before: PolicyVisibleItem, after: PolicyVisibleItem): boolean {
  return !fieldsEqual(before, after, ITEM_SEMANTIC_FIELDS);
}

function nodeChanged(before: SemanticNode, after: SemanticNode): boolean {
  if (before.kind === "item" && after.kind === "item") {
    return before.collection !== after.collection || itemSemanticallyChanged(before.item, after.item);
  }
  if (before.kind === "input" && after.kind === "input") {
    return !fieldsEqual(before.input, after.input, KNOWN_INPUT_SEMANTIC_FIELDS);
  }
  return true;
}

function nodesOf(envelope: StructuredIntentEnvelope): Map<string, SemanticNode> {
  const nodes = new Map<string, SemanticNode>();
  for (const input of envelope.known_inputs) nodes.set(input.id, { kind: "input", input });
  for (const { collection, item } of policyItemsOf(envelope)) nodes.set(item.id, { kind: "item", collection, item });
  return nodes;
}

/** Stable IDs that were added, removed or semantically changed between two Envelopes. */
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
