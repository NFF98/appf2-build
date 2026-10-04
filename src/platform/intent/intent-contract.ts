import type { JsonValue } from "./json-value.js";

/** Implementation-owned identity of the deterministic BS-P1-016 F01 Clarification Policy. */
export const F01_CLARIFICATION_POLICY_VERSION = "f01-clarification-policy/BS-P1-016";

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

/** F01-DATA-001: the only sources allowed on a PROPOSED item. */
export const PROPOSAL_SOURCES: ReadonlySet<IntentSource> = new Set(["NFF_DEFAULT", "LLM_PROPOSED"]);

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
  /** The only canonical confirmed value of this item; present iff resolution_state=CONFIRMED. */
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
  /** Pending default/proposal value; present iff resolution_state=PROPOSED. */
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

/** F01-DATA-003A server-owned state; never accepted from Client or Prompt A output. */
export type ClarificationPolicyState = {
  readonly policy_version: string;
  readonly answered_question_ids: readonly string[];
  readonly changed_semantic_item_ids: readonly string[];
};

export type AnalysisMetadata = {
  readonly [key: string]: JsonValue | ClarificationPolicyState | undefined;
  readonly clarification_policy_state?: ClarificationPolicyState;
};

export type StructuredIntentEnvelope = {
  readonly envelope_version: string;
  readonly goal: JsonValue;
  readonly actors: readonly JsonValue[];
  readonly entities: readonly JsonValue[];
  readonly known_inputs: readonly KnownInput[];
  readonly constraints: readonly PolicyVisibleItem[];
  readonly requested_outputs: readonly JsonValue[];
  readonly candidate_rules: readonly PolicyVisibleItem[];
  readonly missing_fields: readonly PolicyVisibleItem[];
  readonly ambiguities: readonly PolicyVisibleItem[];
  readonly assumptions: readonly PolicyVisibleItem[];
  readonly capability_hints: readonly JsonValue[];
  readonly analysis_metadata: AnalysisMetadata;
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
  throw new IntentContractError("F01-ERR-014", `F01 internal invariant violated: ${reason}.`, [
    { path, reason }
  ]);
}

export type IndexedPolicyItem = {
  readonly collection: PolicyItemCollection;
  readonly item: PolicyVisibleItem;
};

export function policyItemsOf(envelope: StructuredIntentEnvelope): IndexedPolicyItem[] {
  return POLICY_ITEM_COLLECTIONS.flatMap((collection) =>
    envelope[collection].map((item) => ({ collection, item }))
  );
}
