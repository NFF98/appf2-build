import { expect } from "vitest";

import {
  F01_CLARIFICATION_POLICY_VERSION,
  IntentContractError,
  type ClarificationPolicyState,
  type IntentErrorCode,
  type KnownInput,
  type PolicyItemCollection,
  type PolicyVisibleItem
} from "../../src/platform/intent/intent-contract.js";
import { restoreTrustedIntentState, type TrustedIntentState } from "../../src/platform/intent/intent-state.js";
import type { JsonValue } from "../../src/platform/intent/json-value.js";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
export type ItemOverrides = Partial<Mutable<PolicyVisibleItem>>;

export const NFF_POLICY_REF = Object.freeze({ policy_id: "nff.default.split", policy_version: "2026.10" });

/** Drops keys explicitly overridden with undefined so fixtures stay plain JSON. */
function definedOnly<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

/** Neutral confirmed MATERIAL domain fact; each test overrides only the axes it exercises. */
export function item(id: string, overrides: ItemOverrides = {}): PolicyVisibleItem {
  return definedOnly({
    id,
    semantic_role: "business_rule",
    description: `Decide ${id}`,
    source: "DOMAIN_KNOWN",
    resolution_state: "CONFIRMED",
    resolved_value: "known",
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
    user_visible: false,
    rationale: "fixture",
    ...overrides
  });
}

/** MATERIAL item with no usable decision yet: UNRESOLVED carries neither value. */
export function unresolved(id: string, overrides: ItemOverrides = {}): PolicyVisibleItem {
  return item(id, { resolution_state: "UNRESOLVED", resolved_value: undefined, ...overrides });
}

export function userExplicit(id: string, value: JsonValue, overrides: ItemOverrides = {}): PolicyVisibleItem {
  return item(id, { source: "USER_EXPLICIT", resolved_value: value, ...overrides });
}

export function llmProposal(id: string, value: JsonValue, overrides: ItemOverrides = {}): PolicyVisibleItem {
  return item(id, {
    source: "LLM_PROPOSED",
    resolution_state: "PROPOSED",
    resolved_value: undefined,
    can_default: true,
    proposed_default: value,
    ...overrides
  });
}

export function nffDefault(id: string, value: JsonValue, overrides: ItemOverrides = {}): PolicyVisibleItem {
  return item(id, {
    source: "NFF_DEFAULT",
    source_ref: { ...NFF_POLICY_REF },
    resolution_state: "PROPOSED",
    resolved_value: undefined,
    can_default: true,
    proposed_default: value,
    ...overrides
  });
}

export function requiredMissing(id: string, overrides: ItemOverrides = {}): PolicyVisibleItem {
  return unresolved(id, {
    required_for_execution: true,
    expected_value_type: "NUMBER",
    question_type: "NUMBER",
    ...overrides
  });
}

export function choiceAmbiguity(id: string, alternatives: readonly JsonValue[], overrides: ItemOverrides = {}): PolicyVisibleItem {
  return unresolved(id, {
    expected_value_type: "ENUM",
    question_type: "SINGLE_CHOICE",
    impact_level: "HIGH",
    alternatives,
    ...overrides
  });
}

export function knownInput(id: string, value: JsonValue, overrides: Partial<Mutable<KnownInput>> = {}): KnownInput {
  return {
    id,
    key: id,
    value,
    value_type: typeof value === "number" ? "NUMBER" : "STRING",
    source: "USER_EXPLICIT",
    sensitivity: "NORMAL",
    ...overrides
  };
}

export type EnvelopeParts = Partial<Record<PolicyItemCollection, readonly PolicyVisibleItem[]>> & {
  readonly known_inputs?: readonly KnownInput[];
  readonly analysis_metadata?: Readonly<Record<string, JsonValue>>;
};

/** Untrusted Prompt A shaped output (no server-owned clarification_policy_state). */
export function analysis(parts: EnvelopeParts = {}): Record<string, unknown> {
  return {
    envelope_version: "1.0.0",
    goal: "company dinner bill splitter",
    actors: ["organizer"],
    entities: ["bill"],
    known_inputs: parts.known_inputs ?? [],
    constraints: parts.constraints ?? [],
    requested_outputs: ["per_person_amount"],
    candidate_rules: parts.candidate_rules ?? [],
    missing_fields: parts.missing_fields ?? [],
    ambiguities: parts.ambiguities ?? [],
    assumptions: parts.assumptions ?? [],
    capability_hints: [],
    analysis_metadata: parts.analysis_metadata ?? { prompt_version: "prompt-a/fixture" }
  };
}

/** Server-persisted `intent_record.structured_intent` (the Envelope incl. policy state), unsealed. */
export function persistedEnvelope(parts: EnvelopeParts, policyState: Partial<ClarificationPolicyState> = {}): Record<string, unknown> {
  const envelope = analysis(parts);
  return {
    ...envelope,
    analysis_metadata: {
      ...(envelope.analysis_metadata as Record<string, JsonValue>),
      clarification_policy_state: {
        policy_version: F01_CLARIFICATION_POLICY_VERSION,
        answered_question_ids: [],
        changed_semantic_item_ids: [],
        ...policyState
      }
    }
  };
}

/** Server-persisted clarification truth rehydrated through the trusted repository path. */
export function persistedState(parts: EnvelopeParts, policyState: Partial<ClarificationPolicyState> = {}): TrustedIntentState {
  return restoreTrustedIntentState(persistedEnvelope(parts, policyState));
}

export function expectIntentError(action: () => unknown, code: IntentErrorCode, reason?: string): IntentContractError {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(IntentContractError);
  const error = caught as IntentContractError;
  expect(error.code).toBe(code);
  if (reason !== undefined) {
    expect(error.violations.map((violation) => violation.reason)).toContain(reason);
  }
  return error;
}
