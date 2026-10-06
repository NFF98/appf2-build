import { createHash } from "node:crypto";

import {
  internalInvariant,
  type CapabilityHintV1,
  type ImpactLevel,
  type ValueType
} from "./intent-contract.js";
import { canonicalJson, type JsonValue } from "./json-value.js";

export type RequirementConstraint = {
  readonly semantic_item_id: string;
  readonly value: JsonValue;
  readonly value_type: ValueType;
};

/** F01-RQ-004 deterministic requirement handed to F04 coverage; never a Capability selection. */
export type CapabilityRequirement = {
  readonly requirement_id: string;
  readonly semantic_need: string;
  readonly required: boolean;
  readonly impact_level: ImpactLevel;
  readonly input_types: readonly ValueType[];
  readonly output_types: readonly ValueType[];
  readonly interaction_class: string;
  readonly constraints: readonly RequirementConstraint[];
};

export type ExtractorConstraintSource = {
  readonly id: string;
  readonly value: JsonValue;
  readonly value_type: ValueType;
};

/**
 * F01-RQ-004A canonical extractor input. `traceable_item_ids` is this round's still-valid resolved truth
 * (durable resolved items plus request-scoped ephemeral inputs); `constraints` is ResolvedIntent.constraints[].
 */
export type ExtractorInput = {
  readonly hints: readonly CapabilityHintV1[];
  readonly constraints: readonly ExtractorConstraintSource[];
  readonly traceable_item_ids: ReadonlySet<string>;
  readonly intent_classes: ReadonlySet<string>;
};

const sortedTokens = (tokens: readonly ValueType[]): ValueType[] => [...new Set(tokens)].sort();

function requirementIdOf(tuple: Omit<CapabilityRequirement, "requirement_id">): { id: string; canonical: string } {
  const canonical = canonicalJson(tuple as unknown as JsonValue);
  return { id: `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`, canonical };
}

function resolveConstraints(
  hint: CapabilityHintV1,
  constraintsById: ReadonlyMap<string, ExtractorConstraintSource>
): RequirementConstraint[] {
  return hint.constraint_item_ids
    .map((id) => {
      const item = constraintsById.get(id) ?? internalInvariant("REQUIREMENT_CONSTRAINT_NOT_RESOLVED", `$.capability_hints[${hint.hint_id}]`);
      return { semantic_item_id: item.id, value: item.value, value_type: item.value_type };
    })
    .sort((left, right) => (left.semantic_item_id < right.semantic_item_id ? -1 : 1));
}

function assertTraceable(hint: CapabilityHintV1, input: ExtractorInput): void {
  for (const id of hint.source_item_ids) {
    if (!input.traceable_item_ids.has(id)) internalInvariant("REQUIREMENT_SOURCE_NOT_RESOLVED", `$.capability_hints[${hint.hint_id}]`);
  }
  if (!input.intent_classes.has(hint.interaction_class)) {
    internalInvariant("UNKNOWN_INTERACTION_CLASS", `$.capability_hints[${hint.hint_id}]`);
  }
}

/**
 * Deterministic CapabilityRequirementExtractor: never calls the ModelGateway, never selects a Capability, and
 * derives `requirement_id` from the canonical semantic tuple (hint_id excluded). Identical tuples dedupe; an ID
 * mapped to two different tuples, an unresolved source or an unresolvable constraint fails closed as F01-ERR-014.
 */
export function extractCapabilityRequirements(input: ExtractorInput): CapabilityRequirement[] {
  const constraintsById = new Map(input.constraints.map((item) => [item.id, item]));
  const byId = new Map<string, { requirement: CapabilityRequirement; canonical: string }>();
  for (const hint of input.hints) {
    assertTraceable(hint, input);
    const tuple = {
      semantic_need: hint.semantic_need,
      required: hint.required,
      impact_level: hint.impact_level,
      input_types: sortedTokens(hint.input_types),
      output_types: sortedTokens(hint.output_types),
      interaction_class: hint.interaction_class,
      constraints: resolveConstraints(hint, constraintsById)
    };
    const { id, canonical } = requirementIdOf(tuple);
    const existing = byId.get(id);
    if (existing !== undefined && existing.canonical !== canonical) internalInvariant("REQUIREMENT_ID_COLLISION", `$.capability_hints[${hint.hint_id}]`);
    if (existing === undefined) byId.set(id, { requirement: { requirement_id: id, ...tuple }, canonical });
  }
  return [...byId.values()]
    .map((entry) => entry.requirement)
    .sort((left, right) => (left.requirement_id < right.requirement_id ? -1 : 1));
}
