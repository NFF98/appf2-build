import { extractCapabilityRequirements, type CapabilityRequirement } from "./capability-requirements.js";
import {
  internalInvariant,
  policyItemsOf,
  type ImpactLevel,
  type IntentSource,
  type KnownInput,
  type Materiality,
  type PolicyItemCollection,
  type PolicyVisibleItem,
  type RequestedOutputDescriptor,
  type SemanticDescriptor,
  type SourceRef,
  type StructuredIntentEnvelope,
  type ValueType
} from "./intent-contract.js";
import { deepFreeze, type JsonValue } from "./json-value.js";
import { isResolvedIntentAdmission, type ResolvedIntentAdmission } from "./resolved-intent-gate.js";
import { COMPILER_CATALOG_INTENT_CLASSES } from "./semantic-descriptors.js";

export const RESOLVED_INTENT_VERSION = "1.0.0";

export type ResolvedInput = {
  readonly id: string;
  readonly key: string;
  readonly value: JsonValue;
  readonly value_type: ValueType;
  readonly source: IntentSource;
  readonly source_ref?: SourceRef;
  readonly sensitivity: "NORMAL" | "SENSITIVE";
};

export type ResolvedSemanticItem = {
  readonly id: string;
  readonly semantic_role: string;
  readonly value: JsonValue;
  readonly value_type: ValueType;
  readonly source: IntentSource;
  readonly source_ref?: SourceRef;
  readonly impact_level: ImpactLevel;
  readonly materiality: Materiality;
};

export type ResolvedAssumption = {
  readonly id: string;
  readonly semantic_role: string;
  readonly value: JsonValue;
  readonly value_type: ValueType;
  readonly origin_source: "NFF_DEFAULT" | "USER_ACCEPTED_PROPOSAL";
  readonly source_ref?: SourceRef;
};

export type UnresolvedNonMaterialItem = {
  readonly id: string;
  readonly semantic_role: string;
  readonly description: string;
  readonly expected_value_type: ValueType;
  readonly source: IntentSource;
  readonly source_ref?: SourceRef;
};

export type ProvenanceEntry = {
  readonly structured_item_id: string;
  readonly source: IntentSource;
  readonly source_ref?: SourceRef;
};

/** F01-DATA-005 exact durable shape (`intent_record.resolved_intent`). */
export type ResolvedIntent = {
  readonly resolved_intent_version: string;
  readonly intent_id: string;
  readonly goal: JsonValue;
  readonly actors: readonly SemanticDescriptor[];
  readonly entities: readonly SemanticDescriptor[];
  readonly inputs: readonly ResolvedInput[];
  readonly constraints: readonly ResolvedSemanticItem[];
  readonly outputs: readonly RequestedOutputDescriptor[];
  readonly rules: readonly ResolvedSemanticItem[];
  readonly accepted_assumptions: readonly ResolvedAssumption[];
  readonly unresolved_non_material_items: readonly UnresolvedNonMaterialItem[];
  readonly capability_requirements: readonly CapabilityRequirement[];
  readonly provenance_map: Readonly<Record<string, ProvenanceEntry>>;
};

/** Request-scoped DO_NOT_PERSIST values for Prompt B; never durable, never part of ResolvedIntent. */
export type EphemeralResolvedContext = {
  readonly inputs: readonly KnownInput[];
};

export type ResolvedIntentProjection = {
  readonly resolved_intent: ResolvedIntent;
  readonly ephemeral_context: EphemeralResolvedContext;
};

const RULE_COLLECTIONS: ReadonlySet<PolicyItemCollection> = new Set(["candidate_rules", "missing_fields", "ambiguities", "assumptions"]);
const ACCEPTED_ASSUMPTION_SOURCES: ReadonlySet<IntentSource> = new Set(["NFF_DEFAULT", "USER_ACCEPTED_PROPOSAL"]);

const byId = <T extends { readonly id: string }>(entries: readonly T[]): T[] =>
  [...entries].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

const withSourceRef = (ref: SourceRef | undefined): { readonly source_ref?: SourceRef } => (ref === undefined ? {} : { source_ref: ref });

function semanticItem(item: PolicyVisibleItem): ResolvedSemanticItem {
  return {
    id: item.id,
    semantic_role: item.semantic_role,
    value: item.resolved_value ?? internalInvariant("CONFIRMED_ITEM_WITHOUT_VALUE", `$.items[${item.id}]`),
    value_type: item.expected_value_type,
    source: item.source,
    ...withSourceRef(item.source_ref),
    impact_level: item.impact_level,
    materiality: item.materiality
  };
}

function acceptedAssumption(item: PolicyVisibleItem): ResolvedAssumption {
  return {
    id: item.id,
    semantic_role: item.semantic_role,
    value: item.resolved_value ?? internalInvariant("CONFIRMED_ITEM_WITHOUT_VALUE", `$.items[${item.id}]`),
    value_type: item.expected_value_type,
    origin_source: item.source as ResolvedAssumption["origin_source"],
    ...withSourceRef(item.source_ref)
  };
}

function unresolvedNonMaterial(item: PolicyVisibleItem): UnresolvedNonMaterialItem {
  return {
    id: item.id,
    semantic_role: item.semantic_role,
    description: item.description,
    expected_value_type: item.expected_value_type,
    source: item.source,
    ...withSourceRef(item.source_ref)
  };
}

function resolvedInput(input: KnownInput): ResolvedInput {
  return {
    id: input.id,
    key: input.key,
    value: input.value,
    value_type: input.value_type,
    source: input.source,
    ...withSourceRef(input.source_ref),
    sensitivity: input.sensitivity as ResolvedInput["sensitivity"]
  };
}

type ItemProjection = {
  readonly constraints: ResolvedSemanticItem[];
  readonly rules: ResolvedSemanticItem[];
  readonly accepted: ResolvedAssumption[];
  readonly unresolved: UnresolvedNonMaterialItem[];
  readonly provenance: Map<string, ProvenanceEntry>;
};

/**
 * Only CONFIRMED truth (canonical resolved_value) reaches constraints[] / rules[]; accepted NFF_DEFAULT /
 * USER_ACCEPTED_PROPOSAL truth is additionally listed as an accepted assumption; unresolved COSMETIC items are
 * unresolved_non_material_items only. PROPOSED / UNRESOLVED MATERIAL items never reach this point (gate).
 */
function projectPolicyItems(envelope: StructuredIntentEnvelope): ItemProjection {
  const out: ItemProjection = { constraints: [], rules: [], accepted: [], unresolved: [], provenance: new Map() };
  for (const { collection, item } of policyItemsOf(envelope)) {
    if (item.resolution_state !== "CONFIRMED") {
      if (item.materiality !== "COSMETIC") internalInvariant("UNRESOLVED_MATERIAL_TRUTH_AT_PROJECTION", `$.${collection}[${item.id}]`);
      out.unresolved.push(unresolvedNonMaterial(item));
    } else {
      (collection === "constraints" ? out.constraints : RULE_COLLECTIONS.has(collection) ? out.rules : internalInvariant("UNKNOWN_COLLECTION")).push(semanticItem(item));
      if (ACCEPTED_ASSUMPTION_SOURCES.has(item.source)) out.accepted.push(acceptedAssumption(item));
    }
    out.provenance.set(item.id, { structured_item_id: item.id, source: item.source, ...withSourceRef(item.source_ref) });
  }
  return out;
}

function provenanceOf(entries: readonly (SemanticDescriptor | KnownInput)[], into: Map<string, ProvenanceEntry>): void {
  for (const entry of entries) {
    if (into.has(entry.id)) internalInvariant("DUPLICATE_PROVENANCE_ID", `$.provenance_map[${entry.id}]`);
    into.set(entry.id, { structured_item_id: entry.id, source: entry.source, ...withSourceRef(entry.source_ref) });
  }
}

function sortedRecord<T>(entries: ReadonlyMap<string, T>): Record<string, T> {
  return Object.fromEntries([...entries.keys()].sort().map((key) => [key, entries.get(key) as T]));
}

/**
 * F01-DATA-005 deterministic projection from a gate-issued READY admission. DO_NOT_PERSIST KnownInputs only
 * travel in the request-scoped EphemeralResolvedContext; capability_requirements come solely from the
 * F01-RQ-004A extractor; every durable resolved item has exactly one provenance entry; all ID-bearing arrays
 * and provenance keys are canonically sorted so the same semantic truth is byte-stable.
 */
export function projectResolvedIntent(admission: ResolvedIntentAdmission, intentId: string): ResolvedIntentProjection {
  if (!isResolvedIntentAdmission(admission)) internalInvariant("RESOLVED_INTENT_REQUIRES_GATE_ADMISSION");
  const envelope = admission.state.envelope;
  const durableInputs = envelope.known_inputs.filter((input) => input.sensitivity !== "DO_NOT_PERSIST");
  const ephemeralInputs = envelope.known_inputs.filter((input) => input.sensitivity === "DO_NOT_PERSIST");
  const items = projectPolicyItems(envelope);
  const provenance = new Map(items.provenance);
  provenanceOf([...envelope.actors, ...envelope.entities, ...envelope.requested_outputs, ...durableInputs], provenance);
  const constraints = byId(items.constraints);
  const capabilityRequirements = extractCapabilityRequirements({
    hints: envelope.capability_hints,
    constraints: constraints.map((item) => ({ id: item.id, value: item.value, value_type: item.value_type })),
    traceable_item_ids: new Set([...provenance.keys(), ...ephemeralInputs.map((input) => input.id)]),
    intent_classes: COMPILER_CATALOG_INTENT_CLASSES
  });
  const resolved: ResolvedIntent = {
    resolved_intent_version: RESOLVED_INTENT_VERSION,
    intent_id: intentId,
    goal: envelope.goal,
    actors: byId(envelope.actors),
    entities: byId(envelope.entities),
    inputs: byId(durableInputs.map(resolvedInput)),
    constraints,
    outputs: byId(envelope.requested_outputs),
    rules: byId(items.rules),
    accepted_assumptions: byId(items.accepted),
    unresolved_non_material_items: byId(items.unresolved),
    capability_requirements: capabilityRequirements,
    provenance_map: sortedRecord(provenance)
  };
  return deepFreeze({ resolved_intent: structuredClone(resolved), ephemeral_context: { inputs: byId(ephemeralInputs) } });
}

function referencedIds(envelope: StructuredIntentEnvelope): Set<string> {
  const ids = new Set<string>();
  for (const { item } of policyItemsOf(envelope)) item.depends_on_ids.forEach((id) => ids.add(id));
  for (const hint of envelope.capability_hints) hint.source_item_ids.forEach((id) => ids.add(id));
  return ids;
}

/**
 * Durable `intent_record.structured_intent` projection: DO_NOT_PERSIST KnownInputs never become durable. When
 * remaining durable truth still references such an input the durable record could not be restored without it,
 * so the write fails closed instead of persisting the value or silently rewriting semantic references.
 */
export function toDurableStructuredIntent(envelope: StructuredIntentEnvelope): StructuredIntentEnvelope {
  const ephemeralIds = new Set(envelope.known_inputs.filter((input) => input.sensitivity === "DO_NOT_PERSIST").map((input) => input.id));
  if (ephemeralIds.size === 0) return envelope;
  for (const id of referencedIds(envelope)) {
    if (ephemeralIds.has(id)) internalInvariant("DO_NOT_PERSIST_INPUT_REFERENCED_BY_DURABLE_TRUTH", `$.known_inputs[${id}]`);
  }
  return { ...envelope, known_inputs: envelope.known_inputs.filter((input) => !ephemeralIds.has(input.id)) };
}
