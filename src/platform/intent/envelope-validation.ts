import { DependencyGraph } from "./dependency-graph.js";
import {
  F01_CLARIFICATION_POLICY_VERSION,
  IMPACT_LEVELS,
  INTENT_SOURCES,
  IntentContractError,
  MATERIALITY_LEVELS,
  POLICY_ITEM_COLLECTIONS,
  POLICY_RISK_FLAGS,
  QUESTION_TYPES,
  QUESTION_VALUE_TYPE,
  RESOLUTION_STATES,
  SENSITIVITY_LEVELS,
  VALUE_TYPES,
  policyItemsOf,
  type IntentErrorCode,
  type IntentViolation,
  type PolicyItemCollection,
  type PolicyVisibleItem,
  type StructuredIntentEnvelope
} from "./intent-contract.js";
import { findNonJsonPath, isPlainRecord, type JsonValue } from "./json-value.js";
import { distinctCanonicalCount, valueMatchesType } from "./value-shape.js";

/**
 * UNTRUSTED_ANALYSIS = Prompt A output: it may not carry server-owned policy state nor assert
 * User decisions. TRUSTED = server-produced Envelope after answer merge / precedence merge.
 */
export type EnvelopeTrust = "UNTRUSTED_ANALYSIS" | "TRUSTED";

type UnknownRecord = Readonly<Record<string, unknown>>;

const ENVELOPE_FIELDS = [
  "envelope_version",
  "goal",
  "actors",
  "entities",
  "known_inputs",
  "constraints",
  "requested_outputs",
  "candidate_rules",
  "missing_fields",
  "ambiguities",
  "assumptions",
  "capability_hints",
  "analysis_metadata"
] as const;
const OPAQUE_ARRAY_FIELDS = ["actors", "entities", "requested_outputs", "capability_hints"] as const;
const ITEM_REQUIRED_FIELDS = [
  "id",
  "semantic_role",
  "description",
  "source",
  "resolution_state",
  "expected_value_type",
  "question_type",
  "required_for_execution",
  "impact_level",
  "materiality",
  "policy_risk_flags",
  "depends_on_ids",
  "confidence",
  "can_default",
  "alternatives",
  "user_visible",
  "rationale"
] as const;
const ITEM_OPTIONAL_FIELDS = ["source_ref", "proposed_default"] as const;
const KNOWN_INPUT_REQUIRED_FIELDS = ["id", "key", "value", "value_type", "source", "sensitivity"] as const;
const KNOWN_INPUT_OPTIONAL_FIELDS = ["source_ref", "confidence"] as const;
const SOURCE_REF_FIELDS = ["policy_id", "policy_version", "origin_item_id"] as const;
const POLICY_STATE_FIELDS = ["policy_version", "answered_question_ids", "changed_semantic_item_ids"] as const;

class ViolationCollector {
  readonly violations: IntentViolation[] = [];

  add(path: string, reason: string): void {
    this.violations.push({ path, reason });
  }

  get count(): number {
    return this.violations.length;
  }
}

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function checkClosedKeys(
  record: UnknownRecord,
  required: readonly string[],
  optional: readonly string[],
  path: string,
  collector: ViolationCollector
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) collector.add(`${path}.${key}`, "UNKNOWN_FIELD");
  }
  for (const key of required) {
    if (!Object.hasOwn(record, key)) collector.add(`${path}.${key}`, "MISSING_FIELD");
  }
}

function checkEnum(value: unknown, allowed: readonly string[], path: string, collector: ViolationCollector): void {
  if (typeof value !== "string" || !allowed.includes(value)) collector.add(path, "INVALID_ENUM");
}

function checkStringArray(value: unknown, path: string, collector: ViolationCollector, distinct: boolean): void {
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
    collector.add(path, "INVALID_STRING_ARRAY");
  } else if (distinct && new Set(value).size !== value.length) {
    collector.add(path, "DUPLICATE_ENTRY");
  }
}

function checkSourceRef(value: unknown, path: string, collector: ViolationCollector): void {
  if (value === undefined) return;
  if (!isPlainRecord(value)) {
    collector.add(path, "INVALID_SOURCE_REF");
    return;
  }
  checkClosedKeys(value, [], SOURCE_REF_FIELDS, path, collector);
  for (const key of SOURCE_REF_FIELDS) {
    if (value[key] !== undefined && !isNonEmptyString(value[key])) collector.add(`${path}.${key}`, "INVALID_STRING");
  }
}

function checkProvenance(record: UnknownRecord, path: string, trust: EnvelopeTrust, collector: ViolationCollector): void {
  const sourceRef = isPlainRecord(record.source_ref) ? record.source_ref : undefined;
  if (record.source === "NFF_DEFAULT" && !(isNonEmptyString(sourceRef?.policy_id) && isNonEmptyString(sourceRef?.policy_version))) {
    collector.add(`${path}.source_ref`, "NFF_DEFAULT_POLICY_PROVENANCE_REQUIRED");
  }
  if (trust === "UNTRUSTED_ANALYSIS" && record.source === "USER_ACCEPTED_PROPOSAL") {
    collector.add(`${path}.source`, "USER_DECISION_NOT_ASSERTABLE_BY_ANALYSIS");
  }
}

function checkItemFieldTypes(record: UnknownRecord, path: string, collector: ViolationCollector): void {
  if (!isNonEmptyString(record.id)) collector.add(`${path}.id`, "INVALID_ID");
  for (const key of ["semantic_role", "description", "rationale"] as const) {
    if (typeof record[key] !== "string") collector.add(`${path}.${key}`, "INVALID_STRING");
  }
  checkEnum(record.source, INTENT_SOURCES, `${path}.source`, collector);
  checkSourceRef(record.source_ref, `${path}.source_ref`, collector);
  checkEnum(record.resolution_state, RESOLUTION_STATES, `${path}.resolution_state`, collector);
  checkEnum(record.expected_value_type, VALUE_TYPES, `${path}.expected_value_type`, collector);
  checkEnum(record.question_type, QUESTION_TYPES, `${path}.question_type`, collector);
  checkEnum(record.impact_level, IMPACT_LEVELS, `${path}.impact_level`, collector);
  checkEnum(record.materiality, MATERIALITY_LEVELS, `${path}.materiality`, collector);
  for (const key of ["required_for_execution", "can_default", "user_visible"] as const) {
    if (typeof record[key] !== "boolean") collector.add(`${path}.${key}`, "INVALID_BOOLEAN");
  }
  const flags = record.policy_risk_flags;
  if (!Array.isArray(flags) || !flags.every((flag) => POLICY_RISK_FLAGS.includes(flag))) {
    collector.add(`${path}.policy_risk_flags`, "INVALID_RISK_FLAGS");
  }
  checkStringArray(record.depends_on_ids, `${path}.depends_on_ids`, collector, false);
  if (!isFiniteNumber(record.confidence)) collector.add(`${path}.confidence`, "INVALID_NUMBER");
  if (!Array.isArray(record.alternatives)) collector.add(`${path}.alternatives`, "INVALID_ARRAY");
}

function checkResolutionProvenance(item: PolicyVisibleItem, path: string, trust: EnvelopeTrust, collector: ViolationCollector): void {
  const userDecided = item.source === "USER_EXPLICIT" || item.source === "USER_ACCEPTED_PROPOSAL";
  if (userDecided && item.resolution_state !== "CONFIRMED") {
    collector.add(`${path}.resolution_state`, "USER_SOURCE_MUST_BE_CONFIRMED");
  }
  if (item.source === "LLM_PROPOSED" && item.resolution_state === "CONFIRMED") {
    collector.add(`${path}.resolution_state`, "LLM_PROPOSAL_CANNOT_BE_CONFIRMED");
  }
  const pendingDecisionSource = item.source === "LLM_PROPOSED" || item.source === "NFF_DEFAULT";
  if (trust === "UNTRUSTED_ANALYSIS" && pendingDecisionSource && item.resolution_state !== "PROPOSED") {
    collector.add(`${path}.resolution_state`, "PROPOSAL_MUST_BE_PROPOSED_BEFORE_USER_DECISION");
  }
}

function checkAnswerShape(item: PolicyVisibleItem, collection: PolicyItemCollection, path: string, collector: ViolationCollector): void {
  if (QUESTION_VALUE_TYPE[item.question_type] !== item.expected_value_type) {
    collector.add(`${path}.question_type`, "QUESTION_VALUE_TYPE_MISMATCH");
  }
  const isChoice = item.question_type === "SINGLE_CHOICE" || item.question_type === "MULTI_CHOICE";
  if ((isChoice || collection === "ambiguities") && distinctCanonicalCount(item.alternatives) < 2) {
    collector.add(`${path}.alternatives`, "AT_LEAST_TWO_DISTINCT_ALTERNATIVES_REQUIRED");
  }
  if (item.can_default && item.proposed_default === undefined) {
    collector.add(`${path}.proposed_default`, "SAFE_DEFAULT_VALUE_REQUIRED");
  }
  if (item.proposed_default !== undefined) {
    const options = isChoice ? item.alternatives : undefined;
    if (!valueMatchesType(item.proposed_default, item.expected_value_type, options)) {
      collector.add(`${path}.proposed_default`, "DEFAULT_VALUE_SHAPE_MISMATCH");
    }
  }
}

function checkMateriality(item: PolicyVisibleItem, path: string, collector: ViolationCollector): void {
  if (item.materiality !== "COSMETIC") return;
  if (item.required_for_execution) collector.add(`${path}.required_for_execution`, "COSMETIC_CANNOT_BE_REQUIRED");
  if (item.policy_risk_flags.length > 0) collector.add(`${path}.policy_risk_flags`, "RISK_ITEM_MUST_BE_MATERIAL");
}

function validateItem(
  value: unknown,
  collection: PolicyItemCollection,
  path: string,
  trust: EnvelopeTrust,
  collector: ViolationCollector
): void {
  if (!isPlainRecord(value)) {
    collector.add(path, "INVALID_ITEM");
    return;
  }
  const before = collector.count;
  checkClosedKeys(value, ITEM_REQUIRED_FIELDS, ITEM_OPTIONAL_FIELDS, path, collector);
  checkItemFieldTypes(value, path, collector);
  if (collector.count !== before) return;
  const item = value as PolicyVisibleItem;
  checkProvenance(value, path, trust, collector);
  checkResolutionProvenance(item, path, trust, collector);
  checkAnswerShape(item, collection, path, collector);
  checkMateriality(item, path, collector);
}

function validateKnownInput(value: unknown, path: string, trust: EnvelopeTrust, collector: ViolationCollector): void {
  if (!isPlainRecord(value)) {
    collector.add(path, "INVALID_KNOWN_INPUT");
    return;
  }
  const before = collector.count;
  checkClosedKeys(value, KNOWN_INPUT_REQUIRED_FIELDS, KNOWN_INPUT_OPTIONAL_FIELDS, path, collector);
  if (!isNonEmptyString(value.id)) collector.add(`${path}.id`, "INVALID_ID");
  if (typeof value.key !== "string") collector.add(`${path}.key`, "INVALID_STRING");
  checkEnum(value.value_type, VALUE_TYPES, `${path}.value_type`, collector);
  checkEnum(value.source, INTENT_SOURCES, `${path}.source`, collector);
  checkEnum(value.sensitivity, SENSITIVITY_LEVELS, `${path}.sensitivity`, collector);
  checkSourceRef(value.source_ref, `${path}.source_ref`, collector);
  if (value.confidence !== undefined && !isFiniteNumber(value.confidence)) collector.add(`${path}.confidence`, "INVALID_NUMBER");
  if (collector.count !== before) return;
  checkProvenance(value, path, trust, collector);
  if (!valueMatchesType(value.value as JsonValue, value.value_type as PolicyVisibleItem["expected_value_type"])) {
    collector.add(`${path}.value`, "VALUE_TYPE_MISMATCH");
  }
}

function validatePolicyState(value: unknown, path: string, collector: ViolationCollector): void {
  if (!isPlainRecord(value)) {
    collector.add(path, "CLARIFICATION_POLICY_STATE_REQUIRED");
    return;
  }
  checkClosedKeys(value, POLICY_STATE_FIELDS, [], path, collector);
  if (value.policy_version !== F01_CLARIFICATION_POLICY_VERSION) {
    collector.add(`${path}.policy_version`, "UNSUPPORTED_POLICY_VERSION");
  }
  checkStringArray(value.answered_question_ids, `${path}.answered_question_ids`, collector, true);
  checkStringArray(value.changed_semantic_item_ids, `${path}.changed_semantic_item_ids`, collector, true);
}

function validateAnalysisMetadata(value: unknown, trust: EnvelopeTrust, collector: ViolationCollector): void {
  const path = "$.analysis_metadata";
  if (!isPlainRecord(value)) {
    collector.add(path, "INVALID_ANALYSIS_METADATA");
    return;
  }
  const statePath = `${path}.clarification_policy_state`;
  if (trust === "UNTRUSTED_ANALYSIS") {
    if (Object.hasOwn(value, "clarification_policy_state")) collector.add(statePath, "SERVER_OWNED_POLICY_STATE");
    return;
  }
  validatePolicyState(value.clarification_policy_state, statePath, collector);
}

function checkDependencyGraph(envelope: StructuredIntentEnvelope, collector: ViolationCollector): void {
  const items = policyItemsOf(envelope);
  const knownIds = new Set<string>();
  const register = (id: string, path: string) => {
    if (knownIds.has(id)) collector.add(path, "DUPLICATE_SEMANTIC_ID");
    knownIds.add(id);
  };
  envelope.known_inputs.forEach((input, index) => register(input.id, `$.known_inputs[${index}].id`));
  items.forEach(({ collection, item }) => register(item.id, `$.${collection}[${item.id}].id`));
  for (const { collection, item } of items) {
    for (const dependency of item.depends_on_ids) {
      const path = `$.${collection}[${item.id}].depends_on_ids`;
      if (dependency === item.id) collector.add(path, "SELF_DEPENDENCY");
      else if (!knownIds.has(dependency)) collector.add(path, "UNKNOWN_DEPENDENCY");
    }
  }
  if (collector.count > 0) return;
  for (const id of new DependencyGraph(items.map(({ item }) => item)).cyclicItemIds()) {
    collector.add(`$.depends_on_ids[${id}]`, "DEPENDENCY_CYCLE");
  }
}

function validateCollections(record: UnknownRecord, trust: EnvelopeTrust, collector: ViolationCollector): void {
  if (typeof record.envelope_version !== "string" || record.envelope_version.length === 0) {
    collector.add("$.envelope_version", "INVALID_STRING");
  }
  for (const key of OPAQUE_ARRAY_FIELDS) {
    if (!Array.isArray(record[key])) collector.add(`$.${key}`, "INVALID_ARRAY");
  }
  if (!Array.isArray(record.known_inputs)) collector.add("$.known_inputs", "INVALID_ARRAY");
  else record.known_inputs.forEach((input, index) => validateKnownInput(input, `$.known_inputs[${index}]`, trust, collector));
  for (const collection of POLICY_ITEM_COLLECTIONS) {
    const items = record[collection];
    if (!Array.isArray(items)) collector.add(`$.${collection}`, "INVALID_ARRAY");
    else items.forEach((item, index) => validateItem(item, collection, `$.${collection}[${index}]`, trust, collector));
  }
  validateAnalysisMetadata(record.analysis_metadata, trust, collector);
}

export function collectEnvelopeViolations(input: unknown, trust: EnvelopeTrust): IntentViolation[] {
  const collector = new ViolationCollector();
  const nonJsonPath = findNonJsonPath(input);
  if (nonJsonPath !== null) {
    collector.add(nonJsonPath, "NON_JSON_VALUE");
    return collector.violations;
  }
  if (!isPlainRecord(input)) {
    collector.add("$", "INVALID_ENVELOPE");
    return collector.violations;
  }
  checkClosedKeys(input, ENVELOPE_FIELDS, [], "$", collector);
  if (collector.count > 0) return collector.violations;
  validateCollections(input, trust, collector);
  if (collector.count > 0) return collector.violations;
  checkDependencyGraph(input as StructuredIntentEnvelope, collector);
  return collector.violations;
}

export function assertEnvelope(input: unknown, trust: EnvelopeTrust, code: IntentErrorCode): void {
  const violations = collectEnvelopeViolations(input, trust);
  if (violations.length > 0) {
    throw new IntentContractError(code, "Structured Intent Envelope failed F01 shape/invariant validation.", violations);
  }
}

/**
 * Trust boundary for Prompt A output. Invalid analysis is F01-ERR-002 INTENT_ANALYSIS_SCHEMA_INVALID;
 * the accepted Envelope is a detached copy so later caller mutation cannot alter policy input.
 */
export function parseUntrustedAnalysisEnvelope(input: unknown): StructuredIntentEnvelope {
  assertEnvelope(input, "UNTRUSTED_ANALYSIS", "F01-ERR-002");
  return structuredClone(input) as StructuredIntentEnvelope;
}
