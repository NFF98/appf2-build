import {
  F01_CLARIFICATION_POLICY_VERSION,
  type ClarificationPolicyState,
  type KnownInput,
  type PolicyItemCollection,
  type PolicyVisibleItem,
  type StructuredIntentEnvelope
} from "../../src/platform/intent/intent-contract.js";
import type { JsonValue } from "../../src/platform/intent/json-value.js";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
export type ItemSpec = Partial<Mutable<PolicyVisibleItem>> & { readonly id: string };
export type EnvelopeSpec = Partial<Record<PolicyItemCollection, readonly PolicyVisibleItem[]>> & {
  readonly known_inputs?: readonly KnownInput[];
};

export const NFF_POLICY_REF = Object.freeze({ policy_id: "nff-default-currency", policy_version: "1.0.0" });

/** MATERIAL, non-risk, optional DOMAIN_KNOWN unknown unless overridden. */
export function item(spec: ItemSpec): PolicyVisibleItem {
  return {
    semantic_role: "business_rule",
    description: `Decide ${spec.id}`,
    source: "DOMAIN_KNOWN",
    resolution_state: "UNRESOLVED",
    expected_value_type: "STRING",
    question_type: "FREE_TEXT",
    required_for_execution: false,
    impact_level: "MEDIUM",
    materiality: "MATERIAL",
    policy_risk_flags: [],
    depends_on_ids: [],
    confidence: 0.8,
    can_default: false,
    alternatives: [],
    user_visible: true,
    rationale: "fixture",
    ...spec
  };
}

export function confirmed(spec: ItemSpec & { readonly resolved_value: JsonValue }): PolicyVisibleItem {
  return item({ source: "USER_EXPLICIT", resolution_state: "CONFIRMED", ...spec });
}

export function llmProposal(spec: ItemSpec & { readonly proposed_default: JsonValue }): PolicyVisibleItem {
  return item({ source: "LLM_PROPOSED", resolution_state: "PROPOSED", can_default: true, ...spec });
}

export function nffDefault(spec: ItemSpec & { readonly proposed_default: JsonValue }): PolicyVisibleItem {
  return item({ source: "NFF_DEFAULT", source_ref: { ...NFF_POLICY_REF }, resolution_state: "PROPOSED", can_default: true, ...spec });
}

export function knownInput(spec: Partial<Mutable<KnownInput>> & { readonly id: string }): KnownInput {
  return { key: spec.id, value: "fact", value_type: "STRING", source: "USER_EXPLICIT", sensitivity: "NORMAL", ...spec };
}

/** Untrusted Prompt A analysis Envelope: never carries clarification_policy_state. */
export function analysis(spec: EnvelopeSpec = {}): StructuredIntentEnvelope {
  return {
    envelope_version: "1.0.0",
    goal: "公司聚餐分帳工具",
    actors: [],
    entities: [],
    known_inputs: spec.known_inputs ?? [],
    constraints: spec.constraints ?? [],
    requested_outputs: [],
    candidate_rules: spec.candidate_rules ?? [],
    missing_fields: spec.missing_fields ?? [],
    ambiguities: spec.ambiguities ?? [],
    assumptions: spec.assumptions ?? [],
    capability_hints: [],
    analysis_metadata: { prompt_version: "prompt-a/1" }
  };
}

/** Shape of a server-persisted `intent_record.structured_intent` read back by the trusted repository. */
export function persisted(spec: EnvelopeSpec, policyState: Partial<ClarificationPolicyState> = {}): StructuredIntentEnvelope {
  const base = analysis(spec);
  return {
    ...base,
    analysis_metadata: {
      ...base.analysis_metadata,
      clarification_policy_state: {
        policy_version: F01_CLARIFICATION_POLICY_VERSION,
        answered_question_ids: [],
        changed_semantic_item_ids: [],
        ...policyState
      }
    }
  };
}

export function findItem(envelope: StructuredIntentEnvelope, id: string): PolicyVisibleItem {
  const all = [
    ...envelope.constraints,
    ...envelope.candidate_rules,
    ...envelope.missing_fields,
    ...envelope.ambiguities,
    ...envelope.assumptions
  ];
  const found = all.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`fixture item ${id} not found`);
  return found;
}

export function answersBody(
  answers: readonly { question_id: string; value: JsonValue }[],
  decisions: readonly { assumption_id: string; decision: "ACCEPT" | "EDIT" | "REJECT"; edited_value?: JsonValue | null }[] = []
): Record<string, unknown> {
  return { answers, assumption_decisions: decisions, intent_version: 1 };
}
