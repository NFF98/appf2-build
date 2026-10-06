import type { JsonValue } from "./json-value.js";

/**
 * Implementation-owned identity of the deterministic F01 Clarification Policy. It travels as the
 * Evidence `policy_version` property, so it must satisfy that Registry token grammar.
 */
export const F01_CLARIFICATION_POLICY_VERSION = "f01-clarification-policy.BS-P1-016";

export const INTENT_SOURCES = [
  "USER_EXPLICIT",
  "DOMAIN_KNOWN",
  "NFF_DEFAULT",
  "LLM_PROPOSED",
  "USER_ACCEPTED_PROPOSAL"
] as const;
export type IntentSource = (typeof INTENT_SOURCES)[number];

export const RESOLUTION_STATES = ["CONFIRMED", "UNRESOLVED", "PROPOSED"] as const;
export type ResolutionState = (typeof RESOLUTION_STATES)[number];

export const VALUE_TYPES = ["NUMBER", "STRING", "BOOLEAN", "ENUM", "LIST", "RECORD"] as const;
export type ValueType = (typeof VALUE_TYPES)[number];

export const QUESTION_TYPES = [
  "FREE_TEXT",
  "NUMBER",
  "BOOLEAN",
  "SINGLE_CHOICE",
  "MULTI_CHOICE",
  "STRUCTURED_FIELDS"
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** F01-DATA-001 fixed question_type → expected_value_type pairing. */
export const QUESTION_VALUE_TYPE: Readonly<Record<QuestionType, ValueType>> = Object.freeze({
  FREE_TEXT: "STRING",
  NUMBER: "NUMBER",
  BOOLEAN: "BOOLEAN",
  SINGLE_CHOICE: "ENUM",
  MULTI_CHOICE: "LIST",
  STRUCTURED_FIELDS: "RECORD"
});

export const MATERIALITY_LEVELS = ["MATERIAL", "COSMETIC"] as const;
export type Materiality = (typeof MATERIALITY_LEVELS)[number];

export const POLICY_RISK_FLAGS = ["MONEY", "PERMISSION", "EXTERNAL_COST", "IRREVERSIBLE"] as const;
export type PolicyRiskFlag = (typeof POLICY_RISK_FLAGS)[number];

export const IMPACT_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type ImpactLevel = (typeof IMPACT_LEVELS)[number];

export const SENSITIVITY_LEVELS = ["NORMAL", "SENSITIVE", "DO_NOT_PERSIST"] as const;
export type Sensitivity = (typeof SENSITIVITY_LEVELS)[number];

export const POLICY_ITEM_COLLECTIONS = [
  "constraints",
  "candidate_rules",
  "missing_fields",
  "ambiguities",
  "assumptions"
] as const;
export type PolicyItemCollection = (typeof POLICY_ITEM_COLLECTIONS)[number];

/** F01-DATA-001: the only sources a PROPOSED item may carry. */
export const PROPOSAL_SOURCES: ReadonlySet<IntentSource> = new Set(["NFF_DEFAULT", "LLM_PROPOSED"]);

/** F01-DATA-001: sources that represent a User decision and must always be CONFIRMED. */
export const USER_DECISION_SOURCES: ReadonlySet<IntentSource> = new Set(["USER_EXPLICIT", "USER_ACCEPTED_PROPOSAL"]);

export type SourceRef = {
  readonly policy_id?: string;
  readonly policy_version?: string;
  readonly origin_item_id?: string;
};

export type PolicyVisibleItem = {
  readonly id: string;
  readonly semantic_role: string;
  readonly description: string;
  readonly source: IntentSource;
  readonly source_ref?: SourceRef;
  readonly resolution_state: ResolutionState;
  /** Sole canonical confirmed value; present iff resolution_state=CONFIRMED. */
  readonly resolved_value?: JsonValue;
  readonly expected_value_type: ValueType;
  readonly question_type: QuestionType;
  readonly required_for_execution: boolean;
  readonly impact_level: ImpactLevel;
  readonly materiality: Materiality;
  readonly policy_risk_flags: readonly PolicyRiskFlag[];
  readonly depends_on_ids: readonly string[];
  readonly confidence: number;
  readonly can_default: boolean;
  /** Pending default / proposal value; present iff resolution_state=PROPOSED. */
  readonly proposed_default?: JsonValue;
  readonly alternatives: readonly JsonValue[];
  readonly user_visible: boolean;
  readonly rationale: string;
};

export type KnownInput = {
  readonly id: string;
  readonly key: string;
  readonly value: JsonValue;
  readonly value_type: ValueType;
  readonly source: IntentSource;
  readonly source_ref?: SourceRef;
  readonly confidence?: number;
  readonly sensitivity: Sensitivity;
};

/**
 * BF-050 value-free durable marker of a DO_NOT_PERSIST KnownInput: same stable semantic `id`, no value and no
 * reversible representation of it. Server-owned; Prompt A and Clients can never assert or modify it.
 */
export type EphemeralInputRequirement = {
  readonly id: string;
  readonly key: string;
  readonly value_type: ValueType;
  readonly source: IntentSource;
  readonly source_ref?: SourceRef;
};

/** F01-DATA-003A server-owned state; never accepted from a Client body or Prompt A output. */
export type ClarificationPolicyState = {
  readonly policy_version: string;
  readonly answered_question_ids: readonly string[];
  readonly changed_semantic_item_ids: readonly string[];
};

export type AnalysisMetadata = {
  readonly [key: string]: JsonValue | ClarificationPolicyState | undefined;
  readonly clarification_policy_state?: ClarificationPolicyState;
};

/** F01-DATA-001A bounded descriptor shared by `actors[]` / `entities[]`. */
export type SemanticDescriptor = {
  readonly id: string;
  readonly semantic_role: string;
  readonly description: string;
  readonly source: IntentSource;
  readonly source_ref?: SourceRef;
};

export type RequestedOutputDescriptor = SemanticDescriptor & {
  readonly output_type: ValueType;
  readonly required: boolean;
};

/** F01-DATA-001A semantic requirement hint; never a Capability selection. */
export type CapabilityHintV1 = {
  readonly hint_id: string;
  readonly semantic_need: string;
  readonly required: boolean;
  readonly impact_level: ImpactLevel;
  readonly input_types: readonly ValueType[];
  readonly output_types: readonly ValueType[];
  readonly interaction_class: string;
  readonly constraint_item_ids: readonly string[];
  readonly source_item_ids: readonly string[];
};

export type StructuredIntentEnvelope = {
  readonly envelope_version: string;
  readonly goal: JsonValue;
  readonly actors: readonly SemanticDescriptor[];
  readonly entities: readonly SemanticDescriptor[];
  readonly known_inputs: readonly KnownInput[];
  readonly constraints: readonly PolicyVisibleItem[];
  readonly requested_outputs: readonly RequestedOutputDescriptor[];
  readonly candidate_rules: readonly PolicyVisibleItem[];
  readonly missing_fields: readonly PolicyVisibleItem[];
  readonly ambiguities: readonly PolicyVisibleItem[];
  readonly assumptions: readonly PolicyVisibleItem[];
  readonly capability_hints: readonly CapabilityHintV1[];
  readonly analysis_metadata: AnalysisMetadata;
  /** BF-050 server-owned markers sorted by `id`; only present on trusted Envelopes that dropped DO_NOT_PERSIST values. */
  readonly ephemeral_input_requirements?: readonly EphemeralInputRequirement[];
};

export type TrustedStructuredIntentEnvelope = StructuredIntentEnvelope & {
  readonly analysis_metadata: AnalysisMetadata & {
    readonly clarification_policy_state: ClarificationPolicyState;
  };
};

export const CLARIFICATION_DECISIONS = [
  "NEEDS_CLARIFICATION",
  "READY_WITH_VISIBLE_ASSUMPTIONS",
  "READY"
] as const;
export type ClarificationDecision = (typeof CLARIFICATION_DECISIONS)[number];

/** F01-ERR-001 INVALID_REQUEST, -002 INTENT_ANALYSIS_SCHEMA_INVALID, -003 CLARIFICATION_ANSWER_INVALID, -014 INTERNAL_INVARIANT. */
export type IntentErrorCode = "F01-ERR-001" | "F01-ERR-002" | "F01-ERR-003" | "F01-ERR-014";

export type IntentViolation = {
  readonly path: string;
  readonly reason: string;
};

export class IntentContractError extends Error {
  readonly code: IntentErrorCode;
  readonly violations: readonly IntentViolation[];

  constructor(code: IntentErrorCode, message: string, violations: readonly IntentViolation[] = []) {
    super(message);
    this.name = "IntentContractError";
    this.code = code;
    this.violations = Object.freeze(violations.map((violation) => Object.freeze({ ...violation })));
  }
}

export function internalInvariant(reason: string, path = "$"): never {
  throw new IntentContractError("F01-ERR-014", `F01 internal invariant violated: ${reason}.`, [{ path, reason }]);
}

export type IndexedPolicyItem = {
  readonly collection: PolicyItemCollection;
  readonly item: PolicyVisibleItem;
};

export function ephemeralRequirementsOf(envelope: StructuredIntentEnvelope): readonly EphemeralInputRequirement[] {
  return envelope.ephemeral_input_requirements ?? [];
}

export function policyItemsOf(envelope: StructuredIntentEnvelope): IndexedPolicyItem[] {
  return POLICY_ITEM_COLLECTIONS.flatMap((collection) => envelope[collection].map((item) => ({ collection, item })));
}

/** Rebuilds the five policy-visible collections through `rewrite`, leaving every other field untouched. */
export function mapPolicyItems(
  envelope: StructuredIntentEnvelope,
  rewrite: (item: PolicyVisibleItem) => PolicyVisibleItem
): StructuredIntentEnvelope {
  return {
    ...envelope,
    constraints: envelope.constraints.map(rewrite),
    candidate_rules: envelope.candidate_rules.map(rewrite),
    missing_fields: envelope.missing_fields.map(rewrite),
    ambiguities: envelope.ambiguities.map(rewrite),
    assumptions: envelope.assumptions.map(rewrite)
  };
}
